import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react'
import { useT } from '../lib/useI18n'
import { api } from '../../lib/tauri-api.js'
import { MarkdownDocumentView, isMarkdownDocumentPath } from './MarkdownDocumentView'
import { CodeEditor } from './CodeEditor.js'
import type { ContextUsageSnapshot } from '../lib/context-usage.js'
import type { CollabTaskSnapshot, TokenTotals } from '../chat-types.js'
import AgentAvatar from './AgentAvatar.js'
import type { AgentAvatarAgent } from '../lib/agent-avatar.js'
import { ContextOccupancyPanel } from './ContextOccupancyPanel.js'
import {
  ArtifactContextMenuPortal,
  type ArtifactContextMenuState,
} from './ArtifactContextMenuPortal.js'
import {
  chatArtifactDisplayLabel,
  type ChatArtifact,
} from '../lib/chat-artifact.js'
import {
  artifactTimestampMs,
  formatCompactCount,
  formatDutyRoundClock,
  formatInfoRailTime,
  inferEmployeeTaskKind,
  infoRailScopeLabel,
  proactiveBusySessionHint,
  shortenTaskId,
  type InfoRailScope,
} from '../lib/info-rail-format.js'
import {
  AgentCapabilityTabs,
  type AgentCapabilityPatch,
} from './AgentCapabilityTabs.js'
import { PlatformRunTable } from './PlatformRunTable.js'
import { SessionDebugPane } from './SessionDebugPane.js'
import {
  normalizePlatformRunEntries,
  type PlatformRunEntry,
} from '../../lib/right-stage/platform-feedback.js'
import { parseProactiveSessionKey } from '../lib/session-list/workspace-groups.js'
import {
  boardTaskId,
  listSessionBoardTasks,
  pickBoardTask,
  resolveOverlayLiveTask,
  taskSourceLabel,
  type EmployeeBoardTask,
} from '../lib/employee-current-task.js'

/** 普通对话：Agent / 产物 / 调试 / 平台 / 文件 / 更改；员工对话：员工(岗位) / 任务 / 产物 / 运行 / 调试 / 平台 */
export type InfoRailTab = 'artifacts' | 'context' | 'agent' | 'task' | 'run' | 'employee' | 'platform' | 'debug' | 'files' | 'changes'

export type EmployeeRailInfo = {
  agentCode: string
  roleName: string
  department?: string
  status?: string
  responsibilities?: string[]
  workspacePath?: string
  modelName?: string
  autonomyLabel?: string
  thinkModeLabel?: string
  knowledgeVaultIds?: string[]
}

/** @deprecated prefer ChatArtifact */
export type ArtifactListItem = {
  id: string
  label: string
  kind?: string
}

type Props = {
  tab: InfoRailTab
  isEmployeeSession?: boolean
  sessionTitle: string
  isRunning: boolean
  contextUsage: ContextUsageSnapshot | null
  tokenTotals: TokenTotals | null
  agentLabel: string
  modelLabel: string
  agentCode?: string
  agentDescription?: string
  agent?: AgentAvatarAgent | null
  skillCount?: number
  toolCount?: number
  skillNames?: string[]
  /** null = 全部工具；[] = 未连接 */
  toolNames?: string[] | null
  /** null = 全部 MCP；[] = 未连接 */
  mcpServers?: string[] | null
  knowledgeVaultIds?: string[]
  onPatchCapabilities?: (patch: AgentCapabilityPatch) => Promise<void>
  capabilityBusy?: boolean
  modelName?: string
  artifacts?: ChatArtifact[]
  recentArtifacts?: ChatArtifact[]
  artifactFocusId?: string
  platformEntries?: PlatformRunEntry[]
  recentPlatformEntries?: PlatformRunEntry[]
  platformFocusEntryId?: string
  onOpenArtifact?: (item: ChatArtifact) => void
  onRevealArtifact?: (item: ChatArtifact) => void
  onTabChange?: (tab: InfoRailTab) => void
  onSwitchAgent?: () => void
  /** 打开当前 Agent 编辑器；保存后由 ChatApp 刷新列表 */
  onEditAgent?: () => void
  onManualCompact?: () => void
  manualCompactDisabled?: boolean
  onClose?: () => void
  /** 资产沉淀：记录过程 / 沉淀经验 / 反思（侧栏上下文下方） */
  onAssetQuickAction?: (kind: 'episode' | 'craft' | 'journal') => void
  assetQuickBusy?: boolean
  /** 员工会话：岗位详情 */
  employeeInfo?: EmployeeRailInfo | null
  /** 当前会话 key（解析 taskId / kind） */
  sessionKey?: string
  /** 协作侧栏里已有的主任务快照（优先于 work-board 轮询） */
  liveTask?: CollabTaskSnapshot | null
  /** 运维观测已开启时展示调试 Tab */
  obsEnabled?: boolean
  /** 当前会话 LangGraph thread_id */
  threadId?: string
  /** 工作区根路径（文件树 tab 用） */
  workspaceRoot?: string
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="react-chat-info-rail-row">
      <span className="react-chat-info-rail-row-label">{label}</span>
      <span
        className="react-chat-info-rail-row-value"
        title={title || value}
      >
        {value}
      </span>
    </div>
  )
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="react-chat-info-rail-empty">{children}</div>
}

function AssetQuickActions({
  onAction,
  busy = false,
}: {
  onAction: (kind: 'episode' | 'craft' | 'journal') => void
  busy?: boolean
}) {
  const t = useT()
  return (
    <section className="react-chat-asset-quick" aria-label={t('chatShell.infoRailAssetAria')}>
      <div className="react-chat-asset-quick-label">{t('chatShell.infoRailAssetAria')}</div>
      <div className="react-chat-asset-quick-actions">
        <button
          type="button"
          className="react-chat-asset-quick-btn"
          disabled={busy}
          title={t('chatShell.assetRecordTitle')}
          onClick={() => onAction('episode')}
        >
          {t('chatShell.assetRecordLabel')}
        </button>
        <button
          type="button"
          className="react-chat-asset-quick-btn"
          disabled={busy}
          title={t('chatShell.assetCraftTitle')}
          onClick={() => onAction('craft')}
        >
          {t('chatShell.assetCraftLabel')}
        </button>
        <button
          type="button"
          className="react-chat-asset-quick-btn"
          disabled={busy}
          title={t('chatShell.assetJournalTitle')}
          onClick={() => onAction('journal')}
        >
          {t('chatShell.assetJournalLabel')}
        </button>
      </div>
      <a className="react-chat-asset-quick-link" href="#/assets" title={t('chatShell.assetOpenCenterTitle')}>
        {t('chatShell.assetOpenCenterLabel')}
      </a>
    </section>
  )
}

function typeGlyph(type?: string): string {
  const t = String(type || '').toLowerCase()
  if (t === 'image') return '🖼'
  if (t === 'video') return '🎬'
  if (t === 'url') return '🔗'
  if (t === 'html') return '🌐'
  if (t === 'text') return '📝'
  return '📄'
}

function ArtifactList({
  items,
  focusArtifactId = '',
  recentIds = new Set<string>(),
  latestId = '',
  onOpenArtifact,
  onRevealArtifact: _onRevealArtifact,
  onMenu,
}: {
  items: ChatArtifact[]
  focusArtifactId?: string
  recentIds?: Set<string>
  latestId?: string
  onOpenArtifact?: (item: ChatArtifact) => void
  onRevealArtifact?: (item: ChatArtifact) => void
  onMenu: (menu: ArtifactContextMenuState) => void
}) {
  const t = useT()
  return (
    <ul className="react-chat-info-rail-artifact-list">
      {items.map((it) => {
        const label = chatArtifactDisplayLabel(it)
        const meta = it.url && !it.path ? it.url : it.path || it.type
        const active = focusArtifactId && focusArtifactId === it.id
        const timeStr = formatInfoRailTime(it.updatedAt || it.createdAt)
        const isLatest = latestId && latestId === it.id
        const isTurn = recentIds.has(it.id)
        const scope: InfoRailScope = isLatest ? 'latest' : isTurn ? 'turn' : 'existing'
        const titleParts = [meta, timeStr ? t('chatShell.artifactTimeMeta', { time: timeStr }) : '', infoRailScopeLabel(scope)].filter(Boolean)
        return (
          <li key={it.id} className={`react-chat-info-rail-artifact-item${active ? ' is-active' : ''}`}>
            <button
              type="button"
              className="react-chat-info-rail-artifact-btn"
              title={titleParts.join(' · ')}
              onClick={() => onOpenArtifact?.(it)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onMenu({ item: it, x: e.clientX, y: e.clientY })
              }}
            >
              <span className="react-chat-info-rail-artifact-glyph" aria-hidden>
                {typeGlyph(it.type)}
              </span>
              <span className="react-chat-info-rail-artifact-main">
                <span className="react-chat-info-rail-artifact-label">{label}</span>
                <span className="react-chat-info-rail-artifact-meta">
                  {timeStr ? (
                    <span className="react-chat-info-rail-artifact-time">{timeStr}</span>
                  ) : (
                    <span className="react-chat-info-rail-artifact-time is-empty">—</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function partitionArtifacts(items: ChatArtifact[], recentItems: ChatArtifact[], focusArtifactId: string) {
  const all = items.filter((it) => it.type !== 'platform')
  const recent = recentItems.filter((it) => it.type !== 'platform')
  const recentIds = new Set(recent.map((it) => it.id))

  let latestId = String(focusArtifactId || '').trim()
  if (!latestId && all.length) {
    let bestMs = -1
    for (const it of all) {
      const ms = artifactTimestampMs(it)
      if (ms >= bestMs) {
        bestMs = ms
        latestId = it.id
      }
    }
    if (bestMs <= 0) latestId = all[all.length - 1]?.id || ''
  }

  // 最新产物单独置顶展示后，就不再重复出现在「当前轮次 / 已有产物」分区
  const existing = all.filter((it) => it.id !== latestId && !recentIds.has(it.id))
  const turnItems = recent.filter((it) => it.id !== latestId)
  const latestItem = latestId ? all.find((it) => it.id === latestId) || null : null

  return { all, recentIds, existing, turnItems, latestItem, latestId }
}

function ArtifactsPane({
  items,
  recentItems = [],
  focusArtifactId = '',
  onOpenArtifact,
  onRevealArtifact,
}: {
  items: ChatArtifact[]
  recentItems?: ChatArtifact[]
  focusArtifactId?: string
  onOpenArtifact?: (item: ChatArtifact) => void
  onRevealArtifact?: (item: ChatArtifact) => void
}) {
  const t = useT()
  const [menu, setMenu] = useState<ArtifactContextMenuState | null>(null)

  if (!items.length) {
    return <EmptyHint>{t('chatShell.artifactsEmptyHint')}</EmptyHint>
  }

  const openUrl = (item: ChatArtifact) => {
    const url = String(item.url || '').trim()
    if (!url) return
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      /* ignore */
    }
  }

  const { all, recentIds, existing, turnItems, latestItem, latestId } = partitionArtifacts(
    items,
    recentItems,
    focusArtifactId,
  )

  const renderList = (listItems: ChatArtifact[]) => (
    <ArtifactList
      items={listItems}
      focusArtifactId={focusArtifactId}
      recentIds={recentIds}
      latestId={latestId}
      onOpenArtifact={onOpenArtifact}
      onRevealArtifact={onRevealArtifact}
      onMenu={setMenu}
    />
  )

  return (
    <>
      {latestItem ? (
        <>
          <div className="react-chat-info-rail-subsection-label">{t('chatShell.artifactsLatest')}</div>
          {renderList([latestItem])}
        </>
      ) : null}
      {turnItems.length > 0 ? (
        <>
          <div className="react-chat-info-rail-subsection-label">{t('chatShell.artifactsCurrentTurn')}</div>
          {renderList(turnItems)}
        </>
      ) : null}
      {existing.length > 0 ? (
        <>
          <div className="react-chat-info-rail-subsection-label">{t('chatShell.artifactsExisting')}</div>
          {renderList(existing)}
        </>
      ) : null}
      {!latestItem && turnItems.length === 0 && existing.length === 0 && all.length > 0
        ? renderList(all)
        : null}
      <ArtifactContextMenuPortal
        menu={menu}
        onClose={() => setMenu(null)}
        onOpen={onOpenArtifact}
        onReveal={onRevealArtifact}
        onOpenUrl={openUrl}
      />
    </>
  )
}

function AgentPane({
  agentLabel,
  modelLabel,
  modelName,
  agentCode,
  agentDescription,
  agent,
  skillNames,
  toolNames,
  mcpServers = null,
  knowledgeVaultIds = [],
  onSwitchAgent,
  onEditAgent,
  onPatchCapabilities,
  capabilityBusy = false,
  contextUsage = null,
  tokenTotals = null,
  onManualCompact,
  manualCompactDisabled = false,
  onAssetQuickAction,
  assetQuickBusy = false,
}: {
  agentLabel: string
  modelLabel: string
  modelName?: string
  agentCode?: string
  agentDescription?: string
  agent?: AgentAvatarAgent | null
  skillNames: string[]
  toolNames?: string[] | null
  mcpServers?: string[] | null
  knowledgeVaultIds?: string[]
  onSwitchAgent?: () => void
  onEditAgent?: () => void
  onPatchCapabilities?: (patch: AgentCapabilityPatch) => Promise<void>
  capabilityBusy?: boolean
  contextUsage?: ContextUsageSnapshot | null
  tokenTotals?: TokenTotals | null
  onManualCompact?: () => void
  manualCompactDisabled?: boolean
  onAssetQuickAction?: (kind: 'episode' | 'craft' | 'journal') => void
  assetQuickBusy?: boolean
}) {
  const t = useT()
  const displayName = String(agentLabel || '').trim() || t('chatShell.noAgentSelected')
  const bio = String(agentDescription || '').trim()
  const code = String(agentCode || '').trim()
  const tokenizerModel = String(modelName || modelLabel || '').trim()

  return (
    <div className="react-chat-agent-pane">
      <header className="react-chat-agent-profile">
        <div
          className={`react-chat-agent-profile-top${onEditAgent ? ' is-editable' : ''}`}
          role={onEditAgent ? 'button' : undefined}
          tabIndex={onEditAgent ? 0 : undefined}
          title={onEditAgent ? t('chatShell.clickEditAgent') : undefined}
          onClick={onEditAgent}
          onKeyDown={
            onEditAgent
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onEditAgent()
                  }
                }
              : undefined
          }
        >
          <div className="react-chat-agent-profile-portrait">
            <AgentAvatar
              agent={agent}
              agentCode={code || undefined}
              size={44}
              className="react-chat-agent-profile-avatar"
              title={onEditAgent ? t('chatShell.clickEditAgent') : displayName}
            />
            <span className="react-chat-agent-profile-live is-online" title={t('chatShell.statusOnline')} aria-hidden />
          </div>
          <div className="react-chat-agent-profile-main">
            <div className="react-chat-agent-profile-name-row">
              <h2 className="react-chat-agent-profile-name" title={displayName}>
                {displayName}
              </h2>
              {onSwitchAgent ? (
                <button
                  type="button"
                  className="react-chat-agent-switch"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSwitchAgent()
                  }}
                  aria-label={t('chatShell.switchAgentLabel')}
                  title={t('chatShell.switchAgentLabel')}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M3.5 5.5h7.2M8.2 3l2.5 2.5L8.2 8M12.5 10.5H5.3M7.8 8l-2.5 2.5L7.8 13"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
            {modelLabel ? (
              <div className="react-chat-agent-profile-meta" title={modelLabel}>
                {modelLabel}
              </div>
            ) : null}
          </div>
        </div>
        {bio ? (
          <p
            className={`react-chat-agent-profile-bio${onEditAgent ? ' is-editable' : ''}`}
            title={onEditAgent ? t('chatShell.clickEditAgent') : bio}
            role={onEditAgent ? 'button' : undefined}
            tabIndex={onEditAgent ? 0 : undefined}
            onClick={onEditAgent}
            onKeyDown={
              onEditAgent
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onEditAgent()
                    }
                  }
                : undefined
            }
          >
            {bio}
          </p>
        ) : null}
      </header>

      <AgentCapabilityTabs
        skillNames={skillNames}
        toolNames={toolNames}
        mcpServers={mcpServers}
        knowledgeVaultIds={knowledgeVaultIds}
        modelName={tokenizerModel}
        editable={Boolean(onPatchCapabilities && code)}
        busy={capabilityBusy}
        onPatch={onPatchCapabilities}
      />

      <section className="react-chat-agent-context" aria-label={t('chatShell.contextOccupancyAria')}>
        <ContextOccupancyPanel
          usage={contextUsage}
          tokenTotals={tokenTotals}
          onManualCompact={onManualCompact}
          manualCompactDisabled={manualCompactDisabled}
        />
      </section>

      {onAssetQuickAction ? (
        <AssetQuickActions onAction={onAssetQuickAction} busy={assetQuickBusy} />
      ) : null}
    </div>
  )
}

function taskStatusZhMap(t: (key: string) => string): Record<string, string> {
  return {
    executing: t('chatShell.statusExecuting'),
    in_progress: t('chatShell.statusExecuting'),
    running: t('chatShell.statusExecuting'),
    active: t('chatShell.statusExecuting'),
    pending: t('chatShell.statusPendingStart'),
    proposed: t('chatShell.statusPendingStart'),
    todo: t('chatShell.statusPendingStart'),
    paused: t('chatShell.statusPaused'),
    pending_approval: t('chatShell.statusPendingApproval'),
    req_confirm: t('chatShell.statusPendingApproval'),
    waiting_user: t('chatShell.statusWaitingUser'),
    completed: t('chatShell.statusCompleted'),
    done: t('chatShell.statusCompleted'),
    success: t('chatShell.statusCompleted'),
    reviewed: t('chatShell.statusCompleted'),
    failed: t('chatShell.statusFailedZh'),
    error: t('chatShell.statusFailedZh'),
    timed_out: t('chatShell.statusTimedOut'),
    cancelled: t('chatShell.statusCancelledZh'),
    canceled: t('chatShell.statusCancelledZh'),
    rejected: t('chatShell.statusRejectedZh'),
  }
}

function normalizeTaskStatus(raw: string | undefined | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function taskStatusLabel(t: (key: string) => string, raw: string | undefined | null): string {
  const s = normalizeTaskStatus(raw)
  if (!s) return t('chatShell.statusUnknownZh')
  return taskStatusZhMap(t)[s] || s
}

function taskStatusTone(raw: string | undefined | null): string {
  const s = normalizeTaskStatus(raw)
  if (/execut|progress|running|active/.test(s)) return 'progress'
  if (/complete|done|success|reviewed/.test(s)) return 'completed'
  if (/fail|error|timed|reject/.test(s)) return 'failed'
  if (/pending_approval|confirm|waiting/.test(s)) return 'pending'
  if (/cancel/.test(s)) return 'cancelled'
  if (/pause/.test(s)) return 'paused'
  return 'pending'
}

function coerceProgress(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  if (n <= 1) return Math.round(n * 100)
  return Math.min(100, Math.round(n))
}

function roleStatusLabel(
  t: (key: string) => string,
  roleBusy: boolean,
  isRunning: boolean,
  busyOnOtherSession: boolean,
): string {
  if (isRunning) return t('chatShell.statusExecuting')
  if (roleBusy && busyOnOtherSession) return t('chatShell.roleStatusDuty')
  if (roleBusy) return t('chatShell.roleStatusBusy')
  return t('chatShell.statusIdleZh')
}

function TaskPane({
  sessionTitle,
  isRunning,
  tokenTotals,
  agentCode,
  sessionKey,
  liveTask = null,
}: {
  sessionTitle: string
  isRunning: boolean
  tokenTotals: TokenTotals | null
  agentCode?: string
  sessionKey?: string
  liveTask?: CollabTaskSnapshot | null
}) {
  const t = useT()
  const parsed = useMemo(
    () => parseProactiveSessionKey(sessionKey),
    [sessionKey],
  )
  // 只对 proactive:* 会话 / 明确员工 agentCode 拉 busy·work-board；跳过 main 等普通智能体
  const code = String(parsed.agentCode || '').trim() || (
    String(sessionKey || '').trim().startsWith('proactive:')
      ? String(agentCode || '').trim()
      : ''
  )
  /** 会话可关联多任务：手动 focus；默认跟最近活跃 */
  const hintTaskId = String(parsed.taskId || '').trim()
  const [focusTaskId, setFocusTaskId] = useState('')
  const [boardTasks, setBoardTasks] = useState<EmployeeBoardTask[]>([])
  const [boardTask, setBoardTask] = useState<EmployeeBoardTask | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [boardCount, setBoardCount] = useState(0)
  const [showTechDetails, setShowTechDetails] = useState(false)
  const [roleMissing, setRoleMissing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [roleBusy, setRoleBusy] = useState(false)
  const [busySessionKey, setBusySessionKey] = useState('')
  const [busyRoundId, setBusyRoundId] = useState('')

  useEffect(() => {
    setFocusTaskId('')
  }, [sessionKey])

  useEffect(() => {
    setRoleMissing(false)
  }, [code])

  const sessionTaskList = useMemo(() => {
    const liveHint = String(liveTask?.taskId || '').trim()
    return listSessionBoardTasks(
      boardTasks,
      String(sessionKey || ''),
      [hintTaskId, focusTaskId, liveHint].filter(Boolean),
      10,
    )
  }, [boardTasks, sessionKey, hintTaskId, focusTaskId, liveTask?.taskId])

  const preferredTaskId = String(focusTaskId || hintTaskId || '').trim()
  const pinnedLive = useMemo(
    () =>
      resolveOverlayLiveTask(
        String(boardTaskId(boardTask) || preferredTaskId),
        liveTask,
      ),
    [boardTask, preferredTaskId, liveTask],
  )

  useEffect(() => {
    if (!code || roleMissing) {
      setBoardTask(null)
      setBoardTasks([])
      setRoleBusy(false)
      setBusySessionKey('')
      setBusyRoundId('')
      setPendingApprovals(0)
      setBoardCount(0)
      return
    }
    let cancelled = false
    let busyTimer: ReturnType<typeof setInterval> | null = null
    let boardTimer: ReturnType<typeof setInterval> | null = null

    const isRoleNotFound = (err: unknown) => {
      const e = err as { status?: number; message?: string } | null
      if (Number(e?.status) === 404) return true
      return /role\s+['"]?[\w.-]+['"]?\s+not found/i.test(String(e?.message || err || ''))
    }

    const applyBusy = (busyRes: any) => {
      setRoleBusy(Boolean(busyRes?.busy || busyRes?.is_busy))
      setBusySessionKey(String(busyRes?.current_session_key || '').trim())
      setBusyRoundId(String(busyRes?.current_round_id || '').trim())
      return busyRes
    }

    const applyBoard = (boardRes: any, busySessionHint: string) => {
      const tasks = Array.isArray(boardRes?.tasks)
        ? (boardRes.tasks as EmployeeBoardTask[])
        : []
      setBoardTasks(tasks)
      setBoardCount(tasks.filter((t) => t && !t.is_subtask && !t.subtask_id).length)
      setPendingApprovals(
        Array.isArray(boardRes?.pending_approvals)
          ? boardRes.pending_approvals.length
          : Number(boardRes?.counts?.pending_approvals || 0) || 0,
      )
      const liveHint = String(liveTask?.taskId || '').trim()
      const listed = listSessionBoardTasks(
        tasks,
        String(sessionKey || ''),
        [hintTaskId, focusTaskId, liveHint].filter(Boolean),
        10,
      )
      // 新对话/无关联任务时置空：当前任务卡片显示空态，不把岗位其他任务顶上来
      setBoardTask(
        listed.scoped
          ? pickBoardTask(
              listed.items,
              hintTaskId,
              busySessionHint,
              focusTaskId,
            )
          : null,
      )
    }

    const loadBusy = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const { api } = await import('../../lib/tauri-api.js')
        const busyRes = await api.proactiveRoleBusy(code)
        if (cancelled || !busyRes) return
        if (busyRes.missing) {
          setRoleMissing(true)
          return
        }
        applyBusy(busyRes)
      } catch (err) {
        if (isRoleNotFound(err)) {
          setRoleMissing(true)
          return
        }
        /* ignore transient */
      }
    }

    const loadBoard = async (silent: boolean) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (!silent) setLoading(true)
      try {
        const { api } = await import('../../lib/tauri-api.js')
        const [busyRes, boardRes] = await Promise.all([
          api.proactiveRoleBusy(code).catch((err: unknown) => {
            if (isRoleNotFound(err)) throw err
            return null
          }),
          api.proactiveRoleWorkBoard(code, 80).catch((err: unknown) => {
            if (isRoleNotFound(err)) throw err
            return null
          }),
        ])
        if (cancelled) return
        if (busyRes?.missing || boardRes?.missing) {
          setRoleMissing(true)
          setBoardTask(null)
          setBoardTasks([])
          return
        }
        const hint = String(applyBusy(busyRes)?.current_session_key || '').trim()
        if (boardRes) applyBoard(boardRes, hint)
      } catch (err) {
        if (isRoleNotFound(err)) {
          setRoleMissing(true)
          if (!cancelled) {
            setBoardTask(null)
            setBoardTasks([])
          }
          return
        }
        if (!cancelled) {
          setBoardTask(null)
          setBoardTasks([])
        }
      } finally {
        if (!cancelled && !silent) setLoading(false)
      }
    }

    const clearTimers = () => {
      if (busyTimer) {
        clearInterval(busyTimer)
        busyTimer = null
      }
      if (boardTimer) {
        clearInterval(boardTimer)
        boardTimer = null
      }
    }

    const startTimers = () => {
      clearTimers()
      // 员工任务看板 SSOT：对话执行中加快刷新，便于 tasks.progress/state 尽快反映到侧栏
      const busyMs = isRunning ? 8_000 : 20_000
      const boardMs = isRunning ? 10_000 : 25_000
      busyTimer = setInterval(() => {
        void loadBusy()
      }, busyMs)
      boardTimer = setInterval(() => {
        void loadBoard(true)
      }, boardMs)
    }

    void loadBoard(false)
    startTimers()

    const onVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'hidden') {
        clearTimers()
        return
      }
      void loadBusy()
      startTimers()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      cancelled = true
      clearTimers()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [code, hintTaskId, focusTaskId, isRunning, sessionKey, liveTask?.taskId, roleMissing])

  const focusedId = boardTaskId(boardTask)
  const title =
    String(pinnedLive?.name || boardTask?.name || sessionTitle || '').trim() ||
    (parsed.kind === 'chat' ? t('chatShell.freeChatTitle') : t('chatShell.unnamedTaskTitle'))
  const taskKind = inferEmployeeTaskKind(title, parsed.kind)
  const statusRaw =
    String(pinnedLive?.status || boardTask?.status || '').trim() ||
    (isRunning ? 'executing' : parsed.kind === 'chat' ? 'idle' : 'pending')
  const statusZh =
    statusRaw === 'idle' ? t('chatShell.statusIdleZh') : taskStatusLabel(t, statusRaw)
  const tone = statusRaw === 'idle' ? 'idle' : taskStatusTone(statusRaw)
  const taskDone = /complete|done|success|reviewed/i.test(statusRaw)
  const currentSk = String(sessionKey || '').trim()
  const busyOnOtherSession = Boolean(
    roleBusy && busySessionKey && busySessionKey !== currentSk,
  )
  const busyHint = proactiveBusySessionHint(busySessionKey, currentSk)
  const roundClock = formatDutyRoundClock(busyRoundId || boardTask?.round_id)
  const progress =
    coerceProgress(pinnedLive?.progress) ??
    coerceProgress(boardTask?.progress) ??
    (isRunning
      ? null
      : taskDone
        ? 100
        : null)
  const desc = String(
    boardTask?.description || boardTask?.plan_goal || pinnedLive?.planGoal || '',
  ).trim()
  const summary = String(boardTask?.summary || boardTask?.result || '').trim()
  const taskId = String(focusedId || preferredTaskId || pinnedLive?.taskId || '').trim()
  const working = isRunning || (!taskDone && tone === 'progress')
  const roleStatus = roleStatusLabel(t, roleBusy, isRunning, busyOnOtherSession)
  const tokenTotal = Number(tokenTotals?.total || 0)
  const hasStats = boardCount > 0 || pendingApprovals > 0 || tokenTotal > 0
  const hasTechDetails = Boolean(taskId || busyRoundId)
  const sourceLabel =
    String(boardTask?.source_zh || '').trim() ||
    taskSourceLabel(boardTask?.source || boardTask?.source_channel)
  const roleName = String(boardTask?.assigned_role || '').trim()
  const assignee = String(boardTask?.assigned_to || '').trim()
  const raisedBy = String(boardTask?.raised_by || '').trim()
  const updatedLabel = formatInfoRailTime(boardTask?.updated_at || pinnedLive?.updatedAt)
  const startedLabel = formatInfoRailTime(boardTask?.started_at)
  const completedLabel = formatInfoRailTime(boardTask?.completed_at)
  const risk = String(boardTask?.risk_level || '').trim()
  const relatedTasks = sessionTaskList.items
  const showRelatedList = relatedTasks.length > 1
  const relatedHead = sessionTaskList.scoped ? t('chatShell.sessionTasksHead') : t('chatShell.roleTasksHead')
  const pct =
    progress != null ? progress : taskDone ? 100 : working ? 8 : 0
  const buffering = working && !taskDone && pct < 100
  const failed = tone === 'failed'
  const cancelled = /cancel/.test(statusRaw)
  const progBarClass = [
    'tl-progbar',
    'tl-progbar--card',
    buffering ? 'is-live' : '',
    taskDone ? 'is-done' : '',
    failed ? 'is-failed' : '',
    cancelled ? 'is-muted' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const pctLabel =
    progress != null
      ? `${progress}%`
      : working
        ? t('chatShell.inProgressLabel')
        : loading
          ? '…'
          : '—'

  // 会话无关联任务（新对话）：显示空态，不把岗位其他任务顶上来
  const noAssociatedTask = !boardTask && !pinnedLive && !busyRoundId && !isRunning

  if (noAssociatedTask) {
    return (
      <div className="react-chat-current-task-pane">
        <section className="react-chat-current-task-card react-chat-current-task-card--empty" aria-label={t('chatShell.currentTaskAria')}>
          <div className="react-chat-current-task-kicker">
            <span>{taskKind}</span>
            <span className="react-chat-current-task-badge task-status-idle">{t('chatShell.statusIdleZh')}</span>
          </div>
          <h2 className="react-chat-current-task-title" title={title}>
            {title}
          </h2>
          <p className="react-chat-current-task-empty" role="status">
            {loading ? t('chatShell.loading') : t('chatShell.noLinkedTask')}
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="react-chat-current-task-pane">
      <section
        className={`react-chat-current-task-card${working ? ' is-working' : ''}`}
        aria-label={t('chatShell.currentTaskAria')}
      >
        <div className="react-chat-current-task-kicker">
          <span>{taskKind}</span>
          <span
            className={`react-chat-current-task-badge task-status-${tone}`}
          >
            {working && tone === 'progress' ? t('chatShell.statusExecuting') : statusZh}
          </span>
        </div>
        <h2 className="react-chat-current-task-title" title={title}>
          {title}
        </h2>
        {desc && desc !== title ? (
          <p className="react-chat-current-task-desc" title={desc}>
            {desc.length > 220 ? `${desc.slice(0, 220)}…` : desc}
          </p>
        ) : null}

        <div className="react-chat-current-task-progress-block">
          <div
            className={progBarClass}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
            aria-label={t('chatShell.taskProgressAria', { pct: pctLabel })}
          >
            <div className="tl-progbar__track">
              <div
                className={`tl-progbar__fill${buffering ? ' is-buffering' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tl-progbar__pct">{pctLabel}</span>
          </div>
        </div>

        {summary && summary !== desc && summary !== title ? (
          <p className="react-chat-current-task-summary" title={summary}>
            {summary.length > 200 ? `${summary.slice(0, 200)}…` : summary}
          </p>
        ) : null}
      </section>

      {showRelatedList ? (
        <section className="react-chat-session-task-list" aria-label={relatedHead}>
          <div className="react-chat-session-task-list-head">
            {relatedHead}
            <span className="react-chat-session-task-list-count">{relatedTasks.length}</span>
          </div>
          <ul className="react-chat-session-task-list-body">
            {relatedTasks.map((task, idx) => {
              const id = boardTaskId(task)
              const name = String(task.name || '').trim() || t('chatShell.unnamedShort')
              const st = taskStatusLabel(t, task.status)
              const active = Boolean(id && id === focusedId)
              return (
                <li key={id || `session-task-${idx}`}>
                  <button
                    type="button"
                    className={`react-chat-session-task-item${active ? ' is-active' : ''}`}
                    title={id || name}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      if (id) setFocusTaskId(id)
                    }}
                  >
                    <span className="react-chat-session-task-item-name">{name}</span>
                    <span className="react-chat-session-task-item-status">{st}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {busyHint ? (
        <div className="react-chat-current-task-notice" role="status">
          {busyHint}
          {roundClock ? ` · ${roundClock}` : ''}
        </div>
      ) : null}

      {hasStats ? (
        <section className="react-chat-current-task-stats" aria-label={t('chatShell.workOverviewAria')}>
          {boardCount > 0 ? (
            <span className="react-chat-current-task-stat">
              <strong>{boardCount}</strong> {t('chatShell.workItemsLabel')}
            </span>
          ) : null}
          {pendingApprovals > 0 ? (
            <span className="react-chat-current-task-stat react-chat-current-task-stat--warn">
              <strong>{pendingApprovals}</strong> {t('chatShell.pendingApprovalsLabel')}
            </span>
          ) : null}
          {tokenTotal > 0 ? (
            <span className="react-chat-current-task-stat">
              <strong>{formatCompactCount(tokenTotal)}</strong> Token
            </span>
          ) : null}
        </section>
      ) : null}

      <section className="react-chat-current-task-meta" aria-label={t('chatShell.rowTaskStatus')}>
        <Row label={t('chatShell.rowRoleStatus')} value={roleStatus} />
        <Row label={t('chatShell.rowTaskStatus')} value={statusZh} />
        {updatedLabel ? <Row label={t('chatShell.rowLastUpdate')} value={updatedLabel} /> : null}
        {startedLabel ? <Row label={t('chatShell.rowStarted')} value={startedLabel} /> : null}
        {completedLabel ? <Row label={t('chatShell.rowCompletedAt')} value={completedLabel} /> : null}
        {roleName ? <Row label={t('chatShell.rowAssignedRole')} value={roleName} /> : null}
        {assignee && assignee !== roleName ? (
          <Row label={t('chatShell.rowAssignee')} value={assignee} />
        ) : null}
        {raisedBy ? <Row label={t('chatShell.rowRaisedBy')} value={raisedBy} /> : null}
        {sourceLabel ? <Row label={t('chatShell.rowSourceLabel')} value={sourceLabel} /> : null}
        {risk ? <Row label={t('chatShell.rowRisk')} value={risk} /> : null}
        {roundClock && !busyHint ? <Row label={t('chatShell.rowDutyTime')} value={roundClock} /> : null}
      </section>

      {hasTechDetails ? (
        <div className="react-chat-current-task-tech">
          <button
            type="button"
            className="react-chat-current-task-tech-toggle"
            aria-expanded={showTechDetails}
            onClick={() => setShowTechDetails((v) => !v)}
          >
            {showTechDetails ? t('chatShell.techDetailsHide') : t('chatShell.techDetailsShow')}
          </button>
          {showTechDetails ? (
            <div className="react-chat-current-task-tech-body">
              {taskId ? (
                <Row label={t('chatShell.rowTaskId')} value={shortenTaskId(taskId)} title={taskId} />
              ) : null}
              {busyRoundId ? (
                <Row label={t('chatShell.rowRoundId')} value={shortenTaskId(busyRoundId)} title={busyRoundId} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function autonomyZhMap(t: (key: string) => string): Record<string, string> {
  return {
    full_auto: t('chatShell.autonomyFullAuto'),
    approval_for_risky: t('chatShell.autonomyRiskyApproval'),
    approval_for_all: t('chatShell.autonomyAllApproval'),
  }
}

function EmployeePane({
  employeeInfo,
  sessionTitle: _sessionTitle,
  isRunning,
  agentLabel,
  modelLabel,
  agentCode,
  agentDescription,
  agent,
  skillNames,
  toolNames,
  mcpServers,
  knowledgeVaultIds,
  onPatchCapabilities,
  capabilityBusy,
  modelName,
  contextUsage,
  tokenTotals,
  onManualCompact,
  manualCompactDisabled,
  onEditAgent,
  onAssetQuickAction,
  assetQuickBusy = false,
}: {
  employeeInfo?: EmployeeRailInfo | null
  sessionTitle: string
  isRunning: boolean
  agentLabel: string
  modelLabel: string
  agentCode?: string
  agentDescription?: string
  agent?: AgentAvatarAgent | null
  skillNames: string[]
  toolNames?: string[] | null
  mcpServers?: string[] | null
  knowledgeVaultIds?: string[]
  onPatchCapabilities?: (patch: AgentCapabilityPatch) => Promise<void>
  capabilityBusy?: boolean
  modelName?: string
  contextUsage?: ContextUsageSnapshot | null
  tokenTotals?: TokenTotals | null
  onManualCompact?: () => void
  manualCompactDisabled?: boolean
  onEditAgent?: () => void
  onAssetQuickAction?: (kind: 'episode' | 'craft' | 'journal') => void
  assetQuickBusy?: boolean
}) {
  const t = useT()
  const [dutyExpanded, setDutyExpanded] = useState(false)
  const code = String(employeeInfo?.agentCode || agentCode || '').trim()
  const roleName = String(employeeInfo?.roleName || '').trim() || t('chatShell.unnamedJobTitle')
  const employeeName = String(agentLabel || '').trim() || code || t('chatShell.groupEmployees')
  const department = String(employeeInfo?.department || '').trim()
  const bio = String(agentDescription || '').trim()
  const responsibilities = (employeeInfo?.responsibilities || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  const workspacePath = String(employeeInfo?.workspacePath || '').trim()
  const roleModel = String(employeeInfo?.modelName || '').trim()
  const thinkLabel = String(employeeInfo?.thinkModeLabel || '').trim()
  const autonomyRaw = String(employeeInfo?.autonomyLabel || '').trim()
  const autonomy = autonomyZhMap(t)[autonomyRaw] || autonomyRaw
  const kbIds = Array.isArray(employeeInfo?.knowledgeVaultIds)
    ? employeeInfo!.knowledgeVaultIds!
    : knowledgeVaultIds || []
  const briefDuties = responsibilities.slice(0, 2)
  const hasMoreDuties = responsibilities.length > 2
  const hasExtraMeta = Boolean(autonomy || thinkLabel || workspacePath)
  const anyTruncated = briefDuties.some((r) => r.length > 48)
  const showDutyToggle = hasMoreDuties || hasExtraMeta || anyTruncated

  return (
    <div className="react-chat-agent-pane react-chat-employee-pane">
      <header className="react-chat-agent-profile">
        <div
          className={`react-chat-agent-profile-top${onEditAgent ? ' is-editable' : ''}`}
          role={onEditAgent ? 'button' : undefined}
          tabIndex={onEditAgent ? 0 : undefined}
          title={onEditAgent ? t('chatShell.clickEditBoundAgent') : undefined}
          onClick={onEditAgent}
          onKeyDown={
            onEditAgent
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onEditAgent()
                  }
                }
              : undefined
          }
        >
          <div className="react-chat-agent-profile-portrait">
            <AgentAvatar
              agent={agent}
              agentCode={code || undefined}
              size={44}
              className="react-chat-agent-profile-avatar"
              title={employeeName}
            />
            <span
              className={`react-chat-agent-profile-live${isRunning ? ' is-online' : ' is-online'}`}
              title={isRunning ? t('chatShell.statusExecuting') : t('chatShell.statusOnline')}
              aria-hidden
            />
          </div>
          <div className="react-chat-agent-profile-main">
            <div className="react-chat-agent-profile-name-row">
              <h2 className="react-chat-agent-profile-name" title={employeeName}>
                {employeeName}
              </h2>
            </div>
            <div className="react-chat-agent-profile-meta" title={roleName}>
              {department ? `${department} · ` : ''}
              {roleName}
            </div>
          </div>
        </div>
        {bio ? (
          <p className="react-chat-agent-profile-bio" title={bio}>
            {bio}
          </p>
        ) : null}
      </header>

      {(responsibilities.length || hasExtraMeta) ? (
        <section className="react-chat-employee-meta" aria-label={t('chatShell.dutiesAria')}>
          {responsibilities.length ? (
            <div className="react-chat-employee-responsibilities">
              <div className="react-chat-info-rail-row-label">{t('chatShell.dutiesLabel')}</div>
              <ul>
                {(dutyExpanded ? responsibilities : briefDuties).map((r) => (
                  <li key={r} title={r}>
                    {dutyExpanded || r.length <= 48 ? r : `${r.slice(0, 48)}…`}
                  </li>
                ))}
              </ul>
              {!dutyExpanded && hasMoreDuties ? (
                <div className="react-chat-employee-duty-more">
                  {t('chatShell.moreDuties', { count: responsibilities.length - briefDuties.length })}
                </div>
              ) : null}
            </div>
          ) : null}
          {dutyExpanded && hasExtraMeta ? (
            <div className="react-chat-employee-extra-meta">
              {autonomy ? <Row label={t('chatShell.rowAutonomy')} value={autonomy} /> : null}
              {thinkLabel ? <Row label={t('chatShell.rowThinkMode')} value={thinkLabel} /> : null}
              {workspacePath ? <Row label={t('chatShell.rowWorkspacePath')} value={workspacePath} /> : null}
            </div>
          ) : null}
          {showDutyToggle ? (
            <button
              type="button"
              className="react-chat-info-rail-action react-chat-employee-duty-toggle"
              onClick={() => setDutyExpanded((v) => !v)}
            >
              {dutyExpanded ? t('chatShell.dutyDetailsHide') : t('chatShell.dutyDetailsShow')}
            </button>
          ) : null}
        </section>
      ) : null}

      <AgentCapabilityTabs
        skillNames={skillNames}
        toolNames={toolNames}
        mcpServers={mcpServers}
        knowledgeVaultIds={kbIds}
        modelName={String(modelName || roleModel || modelLabel || '').trim()}
        editable={Boolean(onPatchCapabilities && code)}
        busy={capabilityBusy}
        onPatch={onPatchCapabilities}
      />

      <section className="react-chat-agent-context" aria-label={t('chatShell.contextOccupancyAria')}>
        <ContextOccupancyPanel
          usage={contextUsage || null}
          tokenTotals={tokenTotals || null}
          onManualCompact={onManualCompact}
          manualCompactDisabled={manualCompactDisabled}
        />
      </section>

      {onAssetQuickAction ? (
        <AssetQuickActions onAction={onAssetQuickAction} busy={assetQuickBusy} />
      ) : null}
    </div>
  )
}

function RunPane({ isRunning }: { isRunning: boolean }) {
  const t = useT()
  return (
    <>
      <Row label={t('chatShell.rowRunStatus')} value={isRunning ? 'Running' : t('chatShell.runFinished')} />
      <EmptyHint>{t('chatShell.runPaneHint')}</EmptyHint>
    </>
  )
}

// ── 文件树 + 文件预览 Pane ──
type FileEntry = { name: string; path: string; is_dir: boolean }

function FileTreePane({ workspaceRoot, threadId, filetreeCollapsed }: { workspaceRoot: string; threadId?: string; filetreeCollapsed: boolean }) {
  const t = useT()
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']))
  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({ '.': [] })
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>('')

  // 文件预览状态
  const [openFiles, setOpenFiles] = useState<{ path: string; name: string }[]>([])
  const [activePath, setActivePath] = useState<string>('')
  const [fileContent, setFileContent] = useState<string>('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  /** false = Markdown 预览模式（只读），true = 文本编辑器模式（可编辑源码） */
  const [sourceMode, setSourceMode] = useState(false)
  // Markdown Editor 内部的编辑模式（预览模式=false，编辑模式=true）
  const [mdEditMode, setMdEditMode] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  // 左右分栏宽度比例（左栏占比，0.3 ~ 0.8）
  const [splitRatio, setSplitRatio] = useState(0.65)
  const splitDragRef = useRef<{ startX: number; startRatio: number } | null>(null)
  // 标签页右键菜单
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  // 文件路径右键菜单
  const [pathMenu, setPathMenu] = useState<{ x: number; y: number } | null>(null)
  // *.md 默认视图模式（持久化）
  // *.md 默认视图模式（持久化）
  const [mdDefaultView, setMdDefaultView] = useState<'markdown' | 'text'>(() => {
    try {
      return (localStorage.getItem('gogo.mdDefaultView') as 'markdown' | 'text') || 'markdown'
    } catch { return 'markdown' }
  })
  const setMdDefault = (v: 'markdown' | 'text') => {
    setMdDefaultView(v)
    try { localStorage.setItem('gogo.mdDefaultView', v) } catch {}
  }

  // ── 编辑状态（仅在 sourceMode = true 时有意义） ──
  const [editingContent, setEditingContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  /** 进入文本编辑器模式：把当前文件内容加载到编辑缓冲区 */
  const enterEditMode = () => {
    setEditingContent(fileContent)
    setIsDirty(false)
    setMdEditMode(true)
  }

  /** 切回 Markdown 预览模式：有未保存修改时弹确认 */
  const exitEditMode = () => {
    if (isDirty && !confirm(t('chatShell.unsavedBackToPreviewConfirm'))) {
      return
    }
    setEditingContent('')
    setIsDirty(false)
    setMdEditMode(false)
  }

  /** 保存编辑内容到工作区文件 */
  const saveEdit = async () => {
    if (!activePath || saving) return
    setSaving(true)
    try {
      await api.writeWorkspaceFile(workspaceRoot, activePath, editingContent, threadId)
      setFileContent(editingContent)
      setIsDirty(false)
    } catch (e: any) {
      console.warn('[FileTree] save failed', e)
      alert(t('chatShell.saveFailedMsg', { msg: e?.message || e }))
    } finally {
      setSaving(false)
    }
  }

  const loadDir = async (dirPath: string) => {
    if (!workspaceRoot) return
    setLoading((prev) => new Set(prev).add(dirPath))
    setError('')
    try {
      const resp = await api.browseWorkspace(workspaceRoot, dirPath, threadId)
      const items: FileEntry[] = (Array.isArray(resp) ? resp : (resp?.entries || [])).map(
        (e: any) => ({
          name: String(e.name || ''),
          path: String(e.path || ''),
          is_dir: !!(e.is_dir || e.isDir || e.type === 'dir'),
        }),
      )
      items.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setDirs((prev) => ({ ...prev, [dirPath]: items }))
    } catch (e: any) {
      console.warn('[FileTree] browse failed', e)
      setError(String(e?.message || e))
      setDirs((prev) => ({ ...prev, [dirPath]: [] }))
    } finally {
      setLoading((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }

  useEffect(() => {
    if (workspaceRoot) loadDir('.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot])

  const toggle = (entry: FileEntry) => {
    if (!entry.is_dir) {
      openFile(entry)
      return
    }
    const key = entry.path || entry.name
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else {
        next.add(key)
        if (!dirs[key]) loadDir(key)
      }
      return next
    })
  }

  const openFile = async (entry: FileEntry) => {
    const path = entry.path || entry.name
    setActivePath(path)
    setViewMenuOpen(false)
    // 默认所有文件都用文本编辑器模式打开（可编辑 + 右侧文件树）
    // md 文件可以通过下拉菜单切到 Markdown 预览模式
    const isMd = isMarkdownDocumentPath(path)
    const startInPreview = isMd && mdDefaultView === 'markdown'
    setSourceMode(!startInPreview)
    setEditingContent('')
    setIsDirty(false)
    setSaving(false)
    setFileError('')
    setFileLoading(true)
    // 如果已经打开过这个文件，加到 tabs
    setOpenFiles((prev) => prev.some((f) => f.path === path) ? prev : [...prev, { path, name: entry.name }])
    try {
      const resp = await api.readWorkspaceFile(workspaceRoot, path, threadId)
      console.log('[FileTree] read', workspaceRoot, path, '->', resp)
      const content = typeof resp === 'string' ? resp : String(resp?.content ?? '')
      setFileContent(content)
      // 编辑模式下把内容加载到编辑缓冲区
      if (!startInPreview) {
        setEditingContent(content)
      }
    } catch (e: any) {
      console.warn('[FileTree] read failed', e)
      setFileError(String(e?.message || e))
      setFileContent('')
    } finally {
      setFileLoading(false)
    }
  }

  const closeFile = (path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path))
    if (activePath === path) {
      const remaining = openFiles.filter((f) => f.path !== path)
      if (remaining.length > 0) {
        setActivePath(remaining[remaining.length - 1].path)
      } else {
        setActivePath('')
        setFileContent('')
      }
    }
  }

  // 分隔条拖动
  const onSplitMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    splitDragRef.current = { startX: e.clientX, startRatio: splitRatio }
    const onMouseMove = (ev: MouseEvent) => {
      if (!splitDragRef.current) return
      const containerWidth = (e.currentTarget.parentElement as HTMLElement)?.clientWidth || 400
      const delta = ev.clientX - splitDragRef.current.startX
      const newRatio = splitDragRef.current.startRatio + delta / containerWidth
      setSplitRatio(Math.max(0.3, Math.min(0.8, newRatio)))
    }
    const onMouseUp = () => {
      splitDragRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // 根据文件后缀获取对应图标
  const getFileIcon = (name: string, isDir: boolean): string => {
    if (isDir) return '📁'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    switch (ext) {
      case 'py': return '🐍'
      case 'js': case 'jsx': case 'mjs': return '📜'
      case 'ts': case 'tsx': return '🔷'
      case 'json': return '{}'
      case 'md': case 'markdown': return '📝'
      case 'html': case 'htm': return '🌐'
      case 'css': case 'scss': case 'less': return '🎨'
      case 'go': return '🐹'
      case 'rs': return '🦀'
      case 'java': return '☕'
      case 'c': case 'h': case 'cpp': case 'hpp': return '⚙️'
      case 'sh': case 'bash': case 'zsh': return '🖥️'
      case 'sql': return '🗃️'
      case 'yaml': case 'yml': return '⚙️'
      case 'toml': return '⚙️'
      case 'ini': case 'cfg': case 'conf': case 'env': return '⚙️'
      case 'xml': return '📰'
      case 'lock': return '🔒'
      case 'gitignore': case 'gitattributes': return '🌿'
      default: return '📄'
    }
  }

  const renderEntries = (dirPath: string, depth: number): ReactNode => {
    const entries = dirs[dirPath] || []
    return entries.map((entry) => {
      const key = entry.path || entry.name
      const isOpen = expanded.has(key)
      const isLoading = loading.has(key)
      const isActive = activePath === key
      return (
        <div key={key}>
          <div
            className={`react-chat-info-rail-file-row${isActive ? ' is-active' : ''}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => toggle(entry)}
          >
            <span className="react-chat-info-rail-file-caret">
              {entry.is_dir ? (isOpen ? '▾' : '▸') : ''}
            </span>
            <span className="react-chat-info-rail-file-icon">
              {getFileIcon(entry.name, entry.is_dir)}
            </span>
            <span className="react-chat-info-rail-file-name">
              {entry.name}
              {isLoading ? ' …' : ''}
            </span>
          </div>
          {entry.is_dir && isOpen && renderEntries(key, depth + 1)}
        </div>
      )
    })
  }

  if (!workspaceRoot) return <EmptyHint>{t('chatShell.workspaceRootUnset')}</EmptyHint>
  if (error) return <EmptyHint>{t('chatShell.loadFailedMsg', { msg: error })}</EmptyHint>

  const currentFile = openFiles.find((f) => f.path === activePath)
  const isMarkdown = currentFile && isMarkdownDocumentPath(currentFile.path)

  // 没打开任何文件：全宽文件树
  if (openFiles.length === 0) {
    return (
      <div className="react-chat-info-rail-file-tree">
        {renderEntries('.', 0)}
      </div>
    )
  }

  return (
    <div className="react-chat-info-rail-filesplit">
      {/* 文件内容预览 */}
      <div className="react-chat-info-rail-filepreview" style={{ width: `${splitRatio * 100}%` }}>
        {/* 文件路径 */}
        {currentFile && (
          <div
            className="react-chat-info-rail-filepath"
            onContextMenu={(e) => {
              e.preventDefault()
              setPathMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            {currentFile.path}
            {/* 路径右键菜单 */}
            {pathMenu && (
              <>
                <div className="react-chat-info-rail-tabmenu-mask" onClick={() => setPathMenu(null)} />
                <div
                  className="react-chat-info-rail-tabmenu"
                  style={{ left: pathMenu.x, top: pathMenu.y }}
                >
                  <div
                    className="react-chat-info-rail-tabmenu-item"
                    onClick={() => {
                      navigator.clipboard.writeText(`${workspaceRoot}\\${currentFile.path}`)
                      setPathMenu(null)
                    }}
                  >
                    {t('chatShell.copyAbsolutePath')}
                  </div>
                  <div
                    className="react-chat-info-rail-tabmenu-item"
                    onClick={() => {
                      navigator.clipboard.writeText(currentFile.path)
                      setPathMenu(null)
                    }}
                  >
                    {t('chatShell.copyRelativePath')}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {/* 文件标签栏 */}
        <div className="react-chat-info-rail-filetabs">
          {openFiles.map((f) => (
            <div
              key={f.path}
              className={`react-chat-info-rail-filetab${f.path === activePath ? ' is-active' : ''}`}
              onClick={() => setActivePath(f.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                setTabMenu({ x: e.clientX, y: e.clientY, path: f.path })
              }}
            >
              <span>{f.name}</span>
              <button
                type="button"
                className="react-chat-info-rail-filetab-x"
                onClick={(e) => { e.stopPropagation(); closeFile(f.path) }}
              >
                ×
              </button>
            </div>
          ))}
          {/* 右键菜单 */}
          {tabMenu && (
            <>
              <div className="react-chat-info-rail-tabmenu-mask" onClick={() => setTabMenu(null)} />
              <div
                className="react-chat-info-rail-tabmenu"
                style={{ left: tabMenu.x, top: tabMenu.y }}
              >
                <div
                  className="react-chat-info-rail-tabmenu-item"
                  onClick={() => { closeFile(tabMenu.path); setTabMenu(null) }}
                >
                  {t('chatShell.closeTabLabel')}
                </div>
                <div
                  className="react-chat-info-rail-tabmenu-item"
                  onClick={() => {
                    setOpenFiles((prev) => prev.filter((f) => f.path === tabMenu.path))
                    setActivePath(tabMenu.path)
                    setTabMenu(null)
                  }}
                >
                  {t('chatShell.closeOtherTabs')}
                </div>
              </div>
            </>
          )}
        </div>
        {/* 面包屑 + 视图切换 */}
        {currentFile && (
          <div className="react-chat-info-rail-filecrumb">
            <span className="react-chat-info-rail-filecrumb-path">{currentFile.path}</span>
            {isMarkdown && (
              <div className="react-chat-info-rail-crumb-right">
              <div className="react-chat-info-rail-viewdropdown" onClick={() => setViewMenuOpen(!viewMenuOpen)}>
                <span>{sourceMode ? t('chatShell.textEditorLabel') : 'Markdown Editor'}</span>
                <span className="react-chat-info-rail-viewdropdown-arrow">▾</span>
                {viewMenuOpen && (
                  <div className="react-chat-info-rail-viewmenu" onClick={(e) => e.stopPropagation()}>
                    <div
                      className={`react-chat-info-rail-viewitem${!sourceMode ? ' is-active' : ''}`}
                      onClick={() => { setSourceMode(false); setViewMenuOpen(false); }}
                    >
                      {!sourceMode && <span className="react-chat-info-rail-viewcheck">✓</span>}
                      <span>Markdown Editor</span>
                    </div>
                    <div
                      className={`react-chat-info-rail-viewitem${sourceMode ? ' is-active' : ''}`}
                      onClick={() => {
                        setEditingContent(fileContent)
                        setIsDirty(false)
                        setSourceMode(true)
                        setViewMenuOpen(false)
                      }}
                    >
                      {sourceMode && <span className="react-chat-info-rail-viewcheck">✓</span>}
                      <span>{t('chatShell.textEditorLabel')}</span>
                    </div>
                    <div className="react-chat-info-rail-viewitem react-chat-info-rail-viewitem-submenu">
                      <span>{t('chatShell.setMdDefaultLabel')}</span>
                      <span className="react-chat-info-rail-viewitem-arrow">›</span>
                      <div className="react-chat-info-rail-viewmenu react-chat-info-rail-viewmenu-sub">
                        <div
                          className={`react-chat-info-rail-viewitem${mdDefaultView === 'text' ? ' is-active' : ''}`}
                          onClick={() => { setMdDefault('text'); setViewMenuOpen(false); }}
                        >
                          {mdDefaultView === 'text' && <span className="react-chat-info-rail-viewcheck">✓</span>}
                          <span>{t('chatShell.textEditorLabel')}</span>
                        </div>
                        <div
                          className={`react-chat-info-rail-viewitem${mdDefaultView === 'markdown' ? ' is-active' : ''}`}
                          onClick={() => { setMdDefault('markdown'); setViewMenuOpen(false); }}
                        >
                          {mdDefaultView === 'markdown' && <span className="react-chat-info-rail-viewcheck">✓</span>}
                          <span>Markdown Editor</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {isMarkdown && !sourceMode && (
                <div className="react-chat-info-rail-lockbtns">
                  <button
                    type="button"
                    className={`react-chat-info-rail-lockbtn ${!mdEditMode ? 'is-active' : ''}`}
                    onClick={exitEditMode}
                    title={t('chatShell.previewReadonlyTitle')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`react-chat-info-rail-lockbtn ${mdEditMode ? 'is-active' : ''}`}
                    onClick={enterEditMode}
                    title={t('chatShell.switchToEditMode')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                  </button>
                </div>
              )}
              </div>
            )}
            {sourceMode && (
              <div className="react-chat-info-rail-lockbtns">
                <button
                  type="button"
                  className="react-chat-info-rail-savebtn"
                  onClick={saveEdit}
                  disabled={saving || !isDirty}
                  title={isDirty ? t('chatShell.saveChangesTitle') : t('chatShell.noChangesTitle')}
                >
                  {saving ? t('chatShell.savingLabel') : t('chatShell.saveLabel')}
                </button>
              </div>
            )}
          </div>
        )}
        {/* 内容区 */}
        <div className="react-chat-info-rail-filecontent">
          {fileLoading ? (
            <EmptyHint>{t('chatShell.loading')}</EmptyHint>
          ) : fileError ? (
            <EmptyHint>{t('chatShell.readFailedMsg', { msg: fileError })}</EmptyHint>
          ) : isMarkdown && !sourceMode ? (
            /* Markdown Editor 模式 */
            mdEditMode ? (
              /* Markdown 编辑模式 */
              <textarea
                className="react-chat-info-rail-mdedit"
                value={editingContent}
                onChange={(e) => {
                  setEditingContent(e.target.value)
                  setIsDirty(true)
                }}
              />
            ) : (
              /* Markdown 预览模式（只读） */
              <MarkdownDocumentView text={fileContent} />
            )
          ) : (
            /* 文本编辑器模式（CodeMirror 编辑器，带行号、高亮、虚拟滚动） */
            <CodeEditor
              value={editingContent}
              fileName={activePath?.split('/').pop() || ''}
              onChange={(value) => {
                setEditingContent(value)
                setIsDirty(true)
              }}
            />
          )}
        </div>
      </div>
      {/* 可拖动分隔条 */}
      {!filetreeCollapsed && openFiles.length > 0 && (
        <div className="react-chat-info-rail-splitdivider" onMouseDown={onSplitMouseDown} />
      )}
      {/* 右侧文件树 */}
      {!filetreeCollapsed && openFiles.length > 0 && (
        <div className="react-chat-info-rail-filetree" style={{ width: `${(1 - splitRatio) * 100}%` }}>
          {renderEntries('.', 0)}
        </div>
      )}
    </div>
  )
}

// ── 更改（Git Changes）Pane ──
function ChangesPane() {
  const t = useT()
  return <EmptyHint>{t('chatShell.noChangedFiles')}</EmptyHint>
}

function tabTitle(t: (key: string) => string, tab: InfoRailTab, isEmployee: boolean): string {
  if (tab === 'artifacts') return t('chatShell.tabArtifacts')
  if (tab === 'platform') return t('chatShell.tabPlatform')
  if (tab === 'debug') return t('chatShell.tabDebug')
  if (tab === 'context') return t('chatShell.tabContext')
  if (tab === 'agent') return 'Agent'
  if (tab === 'employee') return t('chatShell.employeeLabel')
  if (tab === 'task') return isEmployee ? t('chatShell.tabTask') : t('chatShell.tabArtifacts')
  if (tab === 'run') return t('chatShell.tabRun')
  if (tab === 'files') return t('chatShell.tabFiles')
  if (tab === 'changes') return t('chatShell.tabChanges')
  return t('chatShell.tabDetails')
}

function ChatWorkspaceInfoRailInner({
  tab,
  isEmployeeSession = false,
  sessionTitle,
  isRunning,
  contextUsage,
  tokenTotals,
  agentLabel,
  modelLabel,
  agentCode,
  agentDescription,
  agent,
  skillCount: _skillCount = 0,
  toolCount: _toolCount = 0,
  skillNames = [],
  toolNames = null,
  mcpServers = null,
  knowledgeVaultIds = [],
  onPatchCapabilities,
  capabilityBusy = false,
  modelName,
  artifacts = [],
  recentArtifacts = [],
  artifactFocusId = '',
  platformEntries = [],
  recentPlatformEntries = [],
  platformFocusEntryId = '',
  onOpenArtifact,
  onRevealArtifact,
  onTabChange,
  onSwitchAgent,
  onEditAgent,
  onManualCompact,
  manualCompactDisabled,
  onClose,
  onAssetQuickAction,
  assetQuickBusy = false,
  employeeInfo = null,
  sessionKey = '',
  liveTask = null,
  obsEnabled = false,
  threadId = '',
  workspaceRoot = '',
}: Props) {
  const t = useT()
  // 普通对话：旧 context / 员工专用 tab 归到 Agent，避免切会话后仍停在 task 触发 proactive 轮询
  const effectiveTab: InfoRailTab = !isEmployeeSession
    ? tab === 'context' || tab === 'employee' || tab === 'task' || tab === 'run'
      ? 'agent'
      : tab
    : tab === 'context'
      ? 'task'
      : tab
  // 员工：岗位（员工 tab）最左、任务紧挨其右；平台一律置后
  const tabs: InfoRailTab[] = isEmployeeSession
    ? [
        'employee',
        'task',
        'artifacts',
        'run',
        ...(obsEnabled ? (['debug'] as InfoRailTab[]) : []),
        'platform',
      ]
    : [
        'agent',
        'artifacts',
        'files',
        'changes',
        ...(obsEnabled ? (['debug'] as InfoRailTab[]) : []),
        'platform',
      ]

  // 可关闭标签页：visibleTabs 为当前显示的 tab 集合，+ 按钮可加回被关闭的 tab
  // 默认只显示核心三个：Agent / 产物 / 平台；文件和更改默认隐藏，点 + 加回
  const defaultVisibleTabs = useMemo<InfoRailTab[]>(
    () => tabs.filter((t) => t === 'agent' || t === 'artifacts' || t === 'platform' || t === 'employee' || t === 'task' || t === 'run'),
    [tabs]
  )
  const [visibleTabs, setVisibleTabs] = useState<InfoRailTab[]>(defaultVisibleTabs)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  // 文件树面板是否收起
  const [filetreeCollapsed, setFiletreeCollapsed] = useState(false)
  // 全部展开模式（聊天框变成浮窗，文件侧栏占满中间区域）
  const [fullExpandMode, setFullExpandMode] = useState(false)

  // 全部展开模式时，给 body 加上类，控制文件侧栏展开
  useEffect(() => {
    if (fullExpandMode) {
      document.body.classList.add('is-full-expand-mode')
    } else {
      document.body.classList.remove('is-full-expand-mode')
      // 确保聊天框恢复正常显示
      const chatBox = document.querySelector('.react-chat-conversation-col') as HTMLElement | null
      if (chatBox) {
        chatBox.style.display = ''
      }
    }
  }, [fullExpandMode])

  // 切换普通/员工模式或 obsEnabled 变化时，重置可见 tab 为默认集合
  useEffect(() => {
    setVisibleTabs(defaultVisibleTabs)
    setAddMenuOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployeeSession, obsEnabled])

  const closeTab = (t: InfoRailTab) => {
    setVisibleTabs((prev) => {
      const idx = prev.indexOf(t)
      const next = prev.filter((x) => x !== t)
      if (effectiveTab === t) {
        if (next.length === 0) {
          onClose?.()
        } else {
          const fallback = next[Math.min(idx, next.length - 1)]
          onTabChange?.(fallback)
        }
      }
      return next
    })
  }

  const addTab = (t: InfoRailTab) => {
    setVisibleTabs((prev) => (prev.includes(t) ? prev : [...prev, t]))
    setAddMenuOpen(false)
    onTabChange?.(t)
  }

  const hiddenTabs = tabs.filter((t) => !visibleTabs.includes(t))

  // ── 拖拽调整面板宽度 ──
  const [panelWidth, setPanelWidth] = useState<number | undefined>(undefined)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const MIN_PANEL_WIDTH = visibleTabs.length * 52 + 60
  const MAX_PANEL_WIDTH = 800

  const onDragStart = (e: ReactMouseEvent) => {
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startWidth: panelWidth ?? 420,
    }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = dragRef.current.startX - ev.clientX
      let newWidth = dragRef.current.startWidth + dx
      newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newWidth))
      setPanelWidth(newWidth)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  let body: ReactNode = null
  if (effectiveTab === 'artifacts')
    body = (
      <ArtifactsPane
        items={artifacts}
        recentItems={recentArtifacts}
        focusArtifactId={artifactFocusId}
        onOpenArtifact={onOpenArtifact}
        onRevealArtifact={onRevealArtifact}
      />
    )
  else if (effectiveTab === 'platform')
    body = (
      <PlatformRunTable
        entries={normalizePlatformRunEntries(platformEntries)}
        recentEntries={normalizePlatformRunEntries(recentPlatformEntries)}
        focusEntryId={platformFocusEntryId}
        emptyText={t('chatShell.platformEmptyText')}
      />
    )
  else if (effectiveTab === 'debug' && obsEnabled)
    body = <SessionDebugPane threadId={threadId} isRunning={isRunning} />
  else if (effectiveTab === 'agent')
    body = (
      <AgentPane
        agentLabel={agentLabel}
        modelLabel={modelLabel}
        modelName={modelName}
        agentCode={agentCode}
        agentDescription={agentDescription}
        agent={agent}
        skillNames={skillNames}
        toolNames={toolNames}
        mcpServers={mcpServers}
        knowledgeVaultIds={knowledgeVaultIds}
        onSwitchAgent={onSwitchAgent}
        onEditAgent={onEditAgent}
        onPatchCapabilities={onPatchCapabilities}
        capabilityBusy={capabilityBusy}
        contextUsage={contextUsage}
        tokenTotals={tokenTotals}
        onManualCompact={onManualCompact}
        manualCompactDisabled={manualCompactDisabled}
        onAssetQuickAction={onAssetQuickAction}
        assetQuickBusy={assetQuickBusy}
      />
    )
  else if (effectiveTab === 'employee')
    body = (
      <EmployeePane
        employeeInfo={employeeInfo}
        sessionTitle={sessionTitle}
        isRunning={isRunning}
        agentLabel={agentLabel}
        modelLabel={modelLabel}
        agentCode={agentCode}
        agentDescription={agentDescription}
        agent={agent}
        skillNames={skillNames}
        toolNames={toolNames}
        mcpServers={mcpServers}
        knowledgeVaultIds={knowledgeVaultIds}
        onPatchCapabilities={onPatchCapabilities}
        capabilityBusy={capabilityBusy}
        modelName={modelName}
        contextUsage={contextUsage}
        tokenTotals={tokenTotals}
        onManualCompact={onManualCompact}
        manualCompactDisabled={manualCompactDisabled}
        onEditAgent={onEditAgent}
        onAssetQuickAction={onAssetQuickAction}
        assetQuickBusy={assetQuickBusy}
      />
    )
  else if (effectiveTab === 'task')
    body = (
      <TaskPane
        key={String(sessionKey || agentCode || employeeInfo?.agentCode || 'task-pane')}
        sessionTitle={sessionTitle}
        isRunning={isRunning}
        tokenTotals={tokenTotals}
        agentCode={agentCode || employeeInfo?.agentCode}
        sessionKey={sessionKey}
        liveTask={liveTask}
      />
    )
  else if (effectiveTab === 'run') body = <RunPane isRunning={isRunning} />
  else if (effectiveTab === 'files') body = <FileTreePane workspaceRoot={workspaceRoot} threadId={threadId || undefined} filetreeCollapsed={filetreeCollapsed} />
  else if (effectiveTab === 'changes') body = <ChangesPane />

  return (
    <aside
      className={`react-chat-info-rail${isEmployeeSession ? ' is-employee' : ' is-conversation'}${fullExpandMode ? ' is-full-expand' : ''}`}
      role="complementary"
      aria-label={tabTitle(t, effectiveTab, isEmployeeSession)}
      style={panelWidth ? { width: `${panelWidth}px`, minWidth: `${MIN_PANEL_WIDTH}px` } : undefined}
    >
      <div
        className="react-chat-info-rail-resizer"
        onMouseDown={onDragStart}
        title={t('chatShell.dragResizeWidth')}
      />
      <header className="react-chat-info-rail-header">
        <div className="react-chat-info-rail-tabs" role="tablist">
          {visibleTabs.map((tabId) => (
            <div
              key={tabId}
              role="tab"
              aria-selected={effectiveTab === tabId}
              className={`react-chat-info-rail-tab${effectiveTab === tabId ? ' is-active' : ''}`}
              onClick={() => onTabChange?.(tabId)}
            >
              <span className="react-chat-info-rail-tab-label">{tabTitle(t, tabId, isEmployeeSession)}</span>
              <button
                type="button"
                className="react-chat-info-rail-tab-x"
                onClick={(e) => { e.stopPropagation(); closeTab(tabId) }}
                aria-label={t('chatShell.closeTabAria', { name: tabTitle(t, tabId, isEmployeeSession) })}
              >
                ×
              </button>
            </div>
          ))}
          <div className="react-chat-info-rail-add-wrap">
            <button
              type="button"
              className="react-chat-info-rail-add"
              onClick={() => setAddMenuOpen((v) => !v)}
              aria-label={t('chatShell.addPanelAria')}
            >
              +
            </button>
            {addMenuOpen && (
              <div className="react-chat-info-rail-add-menu" role="menu">
                {hiddenTabs.length === 0 ? (
                  <div className="react-chat-info-rail-add-empty">{t('chatShell.noAddablePanels')}</div>
                ) : (
                  hiddenTabs.map((tabId) => (
                    <button key={tabId} type="button" role="menuitem" onClick={() => addTab(tabId)}>
                      {tabTitle(t, tabId, isEmployeeSession)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        {onClose ? (
          <button type="button" className="react-chat-info-rail-close" onClick={() => {
            setFullExpandMode(false)
            onClose()
          }} aria-label={t('chatShell.closeAria')}>
            ×
          </button>
        ) : null}
      </header>
      <div className="react-chat-info-rail-body">
        {effectiveTab === 'artifacts' ? (
          <div className="react-chat-info-rail-panel-title">
            {artifacts.length > 0 ? t('chatShell.artifactsCount', { count: artifacts.length }) : t('chatShell.tabArtifacts')}
          </div>
        ) : effectiveTab === 'platform' ? (
          <div className="react-chat-info-rail-panel-title">
            {platformEntries.length > 0 ? t('chatShell.platformCount', { count: platformEntries.length }) : t('chatShell.tabPlatform')}
          </div>
        ) : effectiveTab === 'debug' ? (
          <div className="react-chat-info-rail-panel-title">{t('chatShell.tabDebug')}</div>
        ) : effectiveTab === 'agent' || effectiveTab === 'employee' || effectiveTab === 'task' ? null : (
          <div className="react-chat-info-rail-panel-title">
            <span>{tabTitle(t, effectiveTab, isEmployeeSession)}</span>
            {effectiveTab === 'files' && (
              <div className="react-chat-info-rail-panel-actions">
                <button
                  type="button"
                  className={`react-chat-info-rail-panel-action ${fullExpandMode ? 'is-active' : ''}`}
                  title={fullExpandMode ? t('chatShell.exitFullExpand') : t('chatShell.fullExpandLabel')}
                  onClick={() => setFullExpandMode(!fullExpandMode)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="4"/>
                    <rect x="14" y="4" width="6" height="6" rx="1"/>
                    <rect x="4" y="14" width="6" height="6" rx="1"/>
                    <circle cx="16" cy="16" r="4"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="react-chat-info-rail-panel-action"
                  onClick={() => setFiletreeCollapsed(!filetreeCollapsed)}
                  title={filetreeCollapsed ? t('chatShell.expandFileTree') : t('chatShell.collapseFileTree')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {filetreeCollapsed ? (
                      <>
                        <path d="M9 18l6-6-6-6"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </>
                    ) : (
                      <>
                        <path d="M15 18l-6-6 6-6"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </>
                    )}
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
        {body}
      </div>
    </aside>
  )
}

export const ChatWorkspaceInfoRail = memo(ChatWorkspaceInfoRailInner)
