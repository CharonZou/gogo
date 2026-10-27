/**
 * 用户层 Run Summary：把原始 Tool Call 收敛成可理解的操作摘要。
 * 技术细节（绝对路径 / 原始命令）默认不进入此层。
 *
 * 聚合策略（仅影响摘要 UI，不改原始 tool 顺序与明细）：
 * 1. 连续相同 label+对象 压缩
 * 2. 最近 WINDOW 条内，同 normalized label + 主要对象可再合并（不要求原始连续）
 * 3. 不跨不同文件；不跨 error / 非 error 错误合并
 *
 * `activity_id` / `activity_label` 仅为 optional UI metadata：有则优先，无则 heuristic。
 */

import { isToolRunning } from '../../lib/chat-normalize.js'
import { t } from '../../lib/i18n.js'
import { resolveEffectiveToolName, resolveToolKey } from '../../lib/tool-display.js'
import {
  fileEditActionFromToolKind,
  fileEditStatsFromTool,
  isFileEditStatToolKind,
} from '../file-diff-util.js'

export type SemanticStepStatus = 'done' | 'active' | 'pending' | 'error'

/** 展示层短窗口：在此条数内允许非连续同对象合并 */
export const SEMANTIC_SUMMARY_WINDOW = 4

export type SemanticFileChange = {
  /** write | replace | delete */
  action: string
  /** 新增行数 */
  added: number
  /** 删除行数 */
  removed: number
}

export type SemanticRunStep = {
  id: string
  label: string
  status: SemanticStepStatus
  /** 聚合次数；1 或不设表示单项。UI 以「N 次」弱化展示，不拼进 label */
  count?: number
  /**
   * 预留：后端若提供 activity_id，可用于跨 tool 聚合。
   * 当前仅透传，不参与前端臆造阶段。
   */
  activityId?: string
  /** 主要对象（文件名等），仅用于展示层聚合，不跨文件合并 */
  objectKey?: string
  /** 文件写入/修改行数详情（展示在步骤右侧） */
  fileChange?: SemanticFileChange
}

function toolArgs(tool: unknown): Record<string, unknown> {
  const raw = (tool as { input?: unknown })?.input
  if (raw == null) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t || t === '{}' || t === '[]') return {}
    try {
      const p = JSON.parse(t)
      return typeof p === 'object' && p != null && !Array.isArray(p) ? (p as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

function basenameHint(raw: unknown): string {
  const s = String(raw || '').trim().replace(/\\/g, '/')
  if (!s) return ''
  const parts = s.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

function toolActivityMeta(tool: unknown): { activityId?: string; activityLabel?: string } {
  const t = tool as {
    activity_id?: unknown
    activityId?: unknown
    activity_label?: unknown
    activityLabel?: unknown
  }
  const activityId = String(t.activity_id || t.activityId || '').trim() || undefined
  const activityLabel = String(t.activity_label || t.activityLabel || '').trim() || undefined
  return { activityId, activityLabel }
}

function primaryFileObject(args: Record<string, unknown>): string {
  return basenameHint(args.path || args.file || args.file_path || args.target_file || args.filepath)
}

/** 命令是否像验证/检查类（展示用，非语义阶段推断） */
function looksLikeVerifyCommand(command: unknown): boolean {
  const c = String(command || '').trim().toLowerCase()
  if (!c) return false
  return /\b(test|lint|vitest|jest|pytest|mocha|cypress|playwright|typecheck|tsc\b|eslint|prettier|check|verify|build|ci)\b/.test(
    c,
  )
}

function semanticLabelAndObject(tool: unknown): { label: string; objectKey: string } {
  const { activityLabel } = toolActivityMeta(tool)
  const args = toolArgs(tool)
  const file = primaryFileObject(args)

  if (activityLabel) {
    return { label: activityLabel, objectKey: file }
  }

  const name = resolveEffectiveToolName(tool)
  const key = String(resolveToolKey(name) || name || 'tool').toLowerCase()

  if (key === 'read' || key === 'read_file' || key.includes('read')) {
    return file
      ? { label: t('chatUi.stepCheckFile', { file }), objectKey: file }
      : { label: t('chatUi.stepReadFiles'), objectKey: '' }
  }
  if (key === 'write' || key === 'write_file' || key === 'create_file' || key === 'write_to_file') {
    return file
      ? { label: t('chatUi.stepWriteFile', { file }), objectKey: file }
      : { label: t('chatUi.stepWriteFileGeneric'), objectKey: '' }
  }
  if (
    key === 'apply_patch' ||
    key === 'edit' ||
    key === 'str_replace' ||
    key === 'search_replace' ||
    key === 'replace' ||
    key === 'replace_in_file'
  ) {
    return file
      ? { label: t('chatUi.stepModifyFile', { file }), objectKey: file }
      : { label: t('chatUi.stepModifyCode'), objectKey: '' }
  }
  if (key === 'delete' || key === 'delete_file') {
    return file
      ? { label: t('chatUi.stepDeleteFile', { file }), objectKey: file }
      : { label: t('chatUi.stepDeleteFileGeneric'), objectKey: '' }
  }
  if (key === 'grep' || key === 'rg' || key === 'search' || key === 'search_code_index' || key.includes('grep')) {
    return { label: t('chatUi.stepSearchCode'), objectKey: '' }
  }
  if (key === 'glob' || key === 'list_dir' || key === 'ls') {
    return { label: t('chatUi.stepExploreProject'), objectKey: '' }
  }
  if (key === 'bash' || key === 'shell' || key === 'terminal' || key === 'execute_command') {
    const verify = looksLikeVerifyCommand(args.command)
    return {
      label: verify ? t('chatUi.stepVerifyCommand') : t('chatUi.stepRunCommand'),
      objectKey: '',
    }
  }
  if (key === 'web_search' || key === 'browser' || key === 'fetch') {
    return { label: t('chatUi.stepReadExternal'), objectKey: '' }
  }
  if (key === 'plan') return { label: t('chatUi.stepMakePlan'), objectKey: '' }
  if (key === 'subagent' || key === 'task' || key === 'worker') {
    return { label: t('chatUi.stepDispatchSubtask'), objectKey: '' }
  }
  if (key === 'todo' || key === 'todo_write') {
    return { label: t('chatUi.stepUpdateTodos'), objectKey: '' }
  }

  // 无信息量 fallback：按 name/args 尽量具体，禁止「处理当前步骤」
  if (
    key.includes('result') ||
    key.includes('output') ||
    key.includes('analy') ||
    key.includes('inspect') ||
    key.includes('summar')
  ) {
    return { label: t('chatUi.stepAnalyzeResult'), objectKey: file }
  }
  if (key.includes('status') || key.includes('progress') || key.includes('report')) {
    return { label: t('chatUi.stepUpdateStatus'), objectKey: file }
  }
  if (key.includes('process') || key.includes('handle') || key.includes('parse')) {
    return { label: t('chatUi.stepAnalyzeOutput'), objectKey: file }
  }
  if (args.command || key.includes('shell') || key.includes('bash')) {
    return { label: t('chatUi.stepProcessCommandResult'), objectKey: '' }
  }
  if (file) {
    return { label: t('chatUi.stepCheckFile', { file }), objectKey: file }
  }
  return { label: t('chatUi.stepContinueTask'), objectKey: '' }
}

function toolStatus(tool: unknown): SemanticStepStatus {
  const st = String((tool as { status?: string })?.status || '').toLowerCase()
  if (st === 'error' || st === 'failed') return 'error'
  if (isToolRunning(tool)) return 'active'
  if (st === 'pending' || st === 'queued') return 'pending'
  return 'done'
}

function statusRank(status: SemanticStepStatus): number {
  if (status === 'error') return 4
  if (status === 'active') return 3
  if (status === 'pending') return 2
  return 1
}

/** error 只与 error 合并；active/done/pending 可互通（取更高 status） */
function canMergeStatuses(a: SemanticStepStatus, b: SemanticStepStatus): boolean {
  if (a === 'error' || b === 'error') return a === 'error' && b === 'error'
  return true
}

function mergeIdentity(step: Pick<SemanticRunStep, 'label' | 'activityId' | 'objectKey'>): string {
  if (step.activityId) return `activity:${step.activityId}`
  const obj = String(step.objectKey || '').trim()
  return `label:${step.label}|obj:${obj}`
}

function resolveFileChange(tool: unknown): SemanticFileChange | undefined {
  const name = resolveEffectiveToolName(tool)
  const key = String(resolveToolKey(name) || name || '').toLowerCase()
  if (!isFileEditStatToolKind(key) && key !== 'apply_patch' && key !== 'edit' && key !== 'search_replace') {
    return undefined
  }
  const action = fileEditActionFromToolKind(key) || 'replace'
  if (action === 'delete') {
    return { action: 'delete', added: 0, removed: 0 }
  }
  const stats = fileEditStatsFromTool(tool)
  if (!stats) return undefined
  return { action, added: stats.added || 0, removed: stats.removed || 0 }
}

function mergeFileChange(
  a?: SemanticFileChange,
  b?: SemanticFileChange,
): SemanticFileChange | undefined {
  if (!a) return b
  if (!b) return a
  const action =
    a.action === 'write' && b.action === 'write'
      ? 'write'
      : a.action === 'delete' && b.action === 'delete'
        ? 'delete'
        : 'replace'
  return {
    action,
    added: (a.added || 0) + (b.added || 0),
    removed: (a.removed || 0) + (b.removed || 0),
  }
}

/**
 * 步骤右侧文件变更文案。
 * - 写入：写入 N 行
 * - 修改：新增 A 行 · 删除 R 行（有则显示）
 * - 删除：已删除
 */
export function formatSemanticFileChange(change?: SemanticFileChange): string {
  if (!change) return ''
  const act = String(change.action || '').toLowerCase()
  if (act === 'delete') return t('chatUi.fileChangeDeleted')
  const added = Math.max(0, Number(change.added) || 0)
  const removed = Math.max(0, Number(change.removed) || 0)
  if (act === 'write') {
    if (added > 0 && removed > 0) return t('chatUi.fileChangeWriteBoth', { added, removed })
    if (added > 0) return t('chatUi.fileChangeWriteAdded', { added })
    if (removed > 0) return t('chatUi.fileChangeRemoved', { removed })
    return ''
  }
  const parts: string[] = []
  if (added > 0) parts.push(t('chatUi.fileChangeAdded', { added }))
  if (removed > 0) parts.push(t('chatUi.fileChangeRemoved', { removed }))
  return parts.join(' · ')
}

function absorbStep(target: SemanticRunStep, incoming: SemanticRunStep): void {
  target.count = (target.count || 1) + (incoming.count || 1)
  target.fileChange = mergeFileChange(target.fileChange, incoming.fileChange)
  if (statusRank(incoming.status) >= statusRank(target.status)) {
    target.status = incoming.status
    target.id = incoming.id
  }
}

/** 合并连续相同展示项 */
function compressConsecutive(raw: SemanticRunStep[]): SemanticRunStep[] {
  const merged: SemanticRunStep[] = []
  for (const step of raw) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      mergeIdentity(prev) === mergeIdentity(step) &&
      canMergeStatuses(prev.status, step.status)
    ) {
      absorbStep(prev, step)
      continue
    }
    merged.push({ ...step, count: step.count || 1 })
  }
  return merged
}

/**
 * 短窗口聚合：在最近 windowSize 条内，同 label+对象可合并（不要求连续）。
 * 合并到窗口内已有项的位置，不改原始 tool 明细。
 */
export function aggregateSummaryWindow(
  steps: SemanticRunStep[],
  windowSize = SEMANTIC_SUMMARY_WINDOW,
): SemanticRunStep[] {
  const size = Math.max(1, Math.floor(windowSize) || SEMANTIC_SUMMARY_WINDOW)
  const out: SemanticRunStep[] = []
  for (const step of steps) {
    const identity = mergeIdentity(step)
    const from = Math.max(0, out.length - size)
    let hit = -1
    for (let i = out.length - 1; i >= from; i--) {
      const cand = out[i]
      if (mergeIdentity(cand) === identity && canMergeStatuses(cand.status, step.status)) {
        hit = i
        break
      }
    }
    if (hit >= 0) {
      absorbStep(out[hit], step)
      continue
    }
    out.push({ ...step, count: step.count || 1 })
  }
  return out
}

/** 合并连续相同展示项，再做短窗口聚合；保留最近若干条。 */
export function buildSemanticRunSteps(tools: unknown[], maxSteps = 12): SemanticRunStep[] {
  const list = Array.isArray(tools) ? tools : []
  const raw: SemanticRunStep[] = []
  for (let i = 0; i < list.length; i++) {
    const tool = list[i]
    if (!tool) continue
    const id = String(
      (tool as { id?: string; toolCallId?: string; tool_call_id?: string }).id ||
        (tool as { toolCallId?: string }).toolCallId ||
        (tool as { tool_call_id?: string }).tool_call_id ||
        `t-${i}`,
    )
    const { activityId } = toolActivityMeta(tool)
    const { label, objectKey } = semanticLabelAndObject(tool)
    const fileChange = resolveFileChange(tool)
    raw.push({
      id,
      label,
      status: toolStatus(tool),
      count: 1,
      objectKey: objectKey || undefined,
      ...(fileChange ? { fileChange } : {}),
      ...(activityId ? { activityId } : {}),
    })
  }

  const merged = aggregateSummaryWindow(compressConsecutive(raw), SEMANTIC_SUMMARY_WINDOW)

  if (merged.length <= maxSteps) return merged
  return merged.slice(merged.length - maxSteps)
}

export function formatRunSummaryMeta(opts: {
  durationLabel?: string
  toolCount: number
  stepCount?: number
}): string {
  const parts: string[] = []
  if (opts.durationLabel) parts.push(opts.durationLabel)
  if (opts.toolCount > 0) parts.push(`${opts.toolCount} ${opts.toolCount === 1 ? 'tool' : 'tools'}`)
  return parts.join(' · ')
}
