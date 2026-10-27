import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, isGatewayWarming, waitForBackendReady } from '../../lib/tauri-api.js'
import { formatTaskSourceLabel, normalizeTaskSource } from '../../lib/task-source.js'
import {
  formatTaskStatusLabel,
  isTaskRunningStatus,
  normalizeTaskStatusKey,
  toTaskStatusGroup,
} from '../../lib/task-status-label.js'
import { useLang, useT } from '../lib/useI18n'

/**
 * useT() 返回的翻译函数类型。
 * 本文件里 `t` 一直是「任务对象」的惯用参数名，会遮蔽翻译函数，
 * 因此这里统一用 `tr`，并把纯函数的翻译能力作为参数传入（模块级不得调用 Hook）。
 */
type Tr = ReturnType<typeof useT>

export type HomeTrendPoint = {
  date: string
  /** YYYY-MM-DD，供跳转任务中心 */
  isoDate: string
  created: number
  completed: number
  failed: number
}

export type HomeSourceSlice = {
  name: string
  value: number
  color: string
  key: string
}

export type HomeKpi = {
  id: string
  label: string
  value: string
  delta: string
  deltaPositive: boolean | null
  tone: 'accent' | 'info' | 'success' | 'danger' | 'warning'
  /** 次要说明，如「今日执行 2 次」 */
  hint?: string
}

export type HomeBadgeTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'default'
  | 'secondary'
  /** 我的事项状态色（与任务中心事项页一致） */
  | 'todo'
  | 'in_progress'
  | 'waiting'
  | 'parked'

export type HomeListItem = {
  id: string
  title: string
  meta: string
  status: string
  badge: HomeBadgeTone
  time?: string
  href?: string
  /** 筛选元数据 */
  sourceKey?: string
  statusGroup?: string
  bucket?: 'pending' | 'approval' | 'alert'
  dayKey?: string
  isoDate?: string
}

export type HomeAppItem = {
  id: string
  name: string
  status: string
  badge: 'success' | 'warning' | 'danger' | 'default' | 'secondary'
  href: string
}

export type HomeTodoSummary = {
  /** 待处理（非审批、非异常） */
  pending: number
  /** 待审批 */
  approval: number
  /** 异常 */
  alert: number
}

export type HomeAutoStats = {
  runsToday: number
  success: number
  failed: number
  skipped: number
  recentErrors: HomeListItem[]
}

export type HomeDashboardData = {
  loading: boolean
  error: string | null
  kpis: HomeKpi[]
  trendData: HomeTrendPoint[]
  sourceData: HomeSourceSlice[]
  /** 需你处理（attention：审批 / 待确认 / 失败等） */
  todos: HomeListItem[]
  todoSummary: HomeTodoSummary
  /** 我的待办（用户事项表；兼容旧 inbox） */
  myTodos: HomeListItem[]
  recentRuns: HomeListItem[]
  apps: HomeAppItem[]
  autoStats: HomeAutoStats
  refresh: () => void
}

/** 饼图固定色：紫 / 琥珀 / 绿 / 灰，避免两路都偏蓝 */
const SOURCE_HEX: Record<string, string> = {
  chat: '#5B5FEF',
  workflow: '#F59E0B',
  role: '#10B981',
  other: '#94A3B8',
}

function asArray(data: unknown): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.tasks)) return obj.tasks
    if (Array.isArray(obj.items)) return obj.items
    if (Array.isArray(obj.data)) return obj.data
    if (obj.data && typeof obj.data === 'object') {
      const inner = obj.data as Record<string, unknown>
      if (Array.isArray(inner.tasks)) return inner.tasks
      if (Array.isArray(inner.items)) return inner.items
    }
  }
  return []
}

function parseTime(raw: unknown): Date | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? null : d
}

function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${m}-${day}`
}

function formatShortTime(raw: unknown, tr: Tr): string {
  const d = parseTime(raw)
  if (!d) return ''
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startYesterday = new Date(startToday.getTime() - 86400000)
  if (d >= startToday) {
    return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
  }
  if (d >= startYesterday) return tr('home.timeYesterday')
  return dayKey(d)
}

function taskTitle(task: any, tr: Tr): string {
  const untitled = tr('home.untitledTask')
  return String(task?.name || task?.title || task?.goal || task?.id || untitled).trim() || untitled
}

function taskHref(t: any): string {
  const id = String(t?.id || t?.task_id || '').trim()
  return id ? `#/task/${encodeURIComponent(id)}` : '#/tasks'
}

function taskIsoDate(t: any): string {
  const d = parseTime(t.updated_at || t.updatedAt || t.created_at || t.createdAt || t.completed_at)
  if (!d) return ''
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function sourceKeyOf(t: any): string {
  const src = normalizeTaskSource(t.source || t.task_source || t.origin)
  if (src === 'chat' || src === 'workflow' || src === 'role') return src
  return 'other'
}

function classifyAttentionBucket(t: any): 'pending' | 'approval' | 'alert' {
  const key = normalizeTaskStatusKey(t.status)
  const g = toTaskStatusGroup(t.status)
  if (g === 'failed' || key === 'failed' || key === 'error' || key === 'timed_out') return 'alert'
  if (key === 'req_confirm' || key === 'waiting_user') return 'approval'
  return 'pending'
}

function attentionStatusLabel(bucket: 'pending' | 'approval' | 'alert', tr: Tr): string {
  // 「待处理」直接复用 KPI 的同一条文案（home.kpiPending）
  if (bucket === 'alert') return tr('home.attentionAlert')
  if (bucket === 'approval') return tr('home.attentionApproval')
  return tr('home.kpiPending')
}

function attentionBadge(
  bucket: 'pending' | 'approval' | 'alert',
): HomeListItem['badge'] {
  if (bucket === 'alert' || bucket === 'approval') return 'danger'
  return 'warning'
}

function badgeForGroup(group: string): HomeListItem['badge'] {
  if (group === 'completed') return 'success'
  if (group === 'failed') return 'danger'
  if (group === 'executing' || group === 'planning') return 'default'
  if (group === 'pending' || group === 'paused') return 'warning'
  return 'secondary'
}

/**
 * 事项状态：规范 key → 展示文案的 i18n key。
 * 展示文案会随界面语言变化，因此筛选、徽标判断一律使用规范 key（HomeListItem.statusGroup），
 * 不要再拿 status 文案做字符串比较。
 */
const ITEM_STATUS_I18N_KEY: Record<string, string> = {
  todo: 'home.todoTitle',
  in_progress: 'home.itemStatusInProgress',
  waiting: 'home.itemStatusWaiting',
  done: 'home.itemStatusDone',
  parked: 'home.itemStatusParked',
}

function itemStatusKey(status: unknown): string {
  const raw = String(status || 'todo').trim()
  const lower = raw.toLowerCase()
  if (ITEM_STATUS_I18N_KEY[lower]) return lower
  // 以下中文来自后端下发的状态值，只用于识别、不翻译
  if (raw === '待办') return 'todo'
  if (raw === '进行中') return 'in_progress'
  if (raw === '处理中') return 'waiting'
  if (raw === '已完成') return 'done'
  if (raw === '已搁置') return 'parked'
  return 'todo'
}

function itemStatusLabel(
  it: { status?: unknown; status_label?: unknown },
  tr: Tr,
): string {
  const label = String(it.status_label || '').trim()
  // 后端下发的展示文案原样透传
  if (label) return label
  const key = itemStatusKey(it.status)
  const i18nKey = ITEM_STATUS_I18N_KEY[key]
  return i18nKey ? tr(i18nKey) : key
}

function badgeForItemStatus(status: unknown): HomeListItem['badge'] {
  const key = itemStatusKey(status)
  if (key === 'done') return 'success'
  if (key === 'in_progress' || key === 'waiting' || key === 'parked' || key === 'todo') return key
  return 'todo'
}

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildTrend(tasks: any[], rangeDays = 7): HomeTrendPoint[] {
  const days: HomeTrendPoint[] = []
  const now = new Date()
  const span = Math.min(30, Math.max(7, rangeDays))
  const map = new Map<string, HomeTrendPoint>()
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = dayKey(d)
    const point = { date: key, isoDate: isoDay(d), created: 0, completed: 0, failed: 0 }
    days.push(point)
    map.set(key, point)
  }

  for (const t of tasks) {
    const created = parseTime(t.created_at || t.createdAt || t.created)
    if (created) {
      const point = map.get(dayKey(created))
      if (point) point.created += 1
    }
    const group = toTaskStatusGroup(t.status)
    const finished = parseTime(
      t.completed_at || t.finished_at || t.updated_at || t.updatedAt || t.updated,
    )
    if (finished && (group === 'completed' || group === 'failed')) {
      const point = map.get(dayKey(finished))
      if (!point) continue
      if (group === 'completed') point.completed += 1
      else point.failed += 1
    }
  }
  return days
}

function buildSource(tasks: any[], tr: Tr): HomeSourceSlice[] {
  const counts: Record<string, number> = { chat: 0, workflow: 0, role: 0, other: 0 }
  for (const t of tasks) {
    const src = normalizeTaskSource(t.source || t.task_source || t.origin)
    if (src === 'chat' || src === 'workflow' || src === 'role') counts[src] += 1
    else counts.other += 1
  }
  // name 只用于展示；下钻与筛选一律走 key（chat / workflow / role / other）
  const labels: Record<string, string> = {
    chat: tr('home.sourceManual'),
    workflow: tr('home.sourceAutomation'),
    role: tr('home.sourceEmployee'),
    other: tr('home.sourceOther'),
  }
  return (['chat', 'workflow', 'role', 'other'] as const)
    .map((key) => ({
      key,
      name: labels[key],
      value: counts[key],
      color: SOURCE_HEX[key],
    }))
    .filter((s) => s.value > 0 || s.key !== 'other')
}

function startOfToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function startOfYesterday(): Date {
  return new Date(startOfToday().getTime() - 86400000)
}

type KpiDeltaKind = 'pending' | 'running' | 'done' | 'alert'

function formatKpiDelta(
  kind: KpiDeltaKind,
  current: number,
  previous: number,
  tr: Tr,
): {
  delta: string
  deltaPositive: boolean | null
} {
  const diff = current - previous
  const abs = Math.abs(diff)
  if (kind === 'pending') {
    if (diff > 0) return { delta: tr('home.kpiDeltaPendingUp', { count: diff }), deltaPositive: false }
    if (diff < 0) return { delta: tr('home.kpiDeltaPendingDown', { count: abs }), deltaPositive: true }
    return { delta: tr('home.kpiDeltaPendingFlat'), deltaPositive: null }
  }
  if (kind === 'running') {
    if (diff > 0) return { delta: tr('home.kpiDeltaUp', { count: diff }), deltaPositive: true }
    if (diff < 0) return { delta: tr('home.kpiDeltaDown', { count: abs }), deltaPositive: null }
    return { delta: tr('home.kpiFlat'), deltaPositive: null }
  }
  if (kind === 'done') {
    if (diff > 0) return { delta: tr('home.kpiDeltaUp', { count: diff }), deltaPositive: true }
    if (diff < 0) return { delta: tr('home.kpiDeltaDown', { count: abs }), deltaPositive: false }
    return { delta: tr('home.kpiFlat'), deltaPositive: null }
  }
  // alert
  if (diff > 0) return { delta: tr('home.kpiDeltaAlertUp', { count: diff }), deltaPositive: false }
  if (diff < 0) return { delta: tr('home.kpiDeltaAlertDown', { count: abs }), deltaPositive: true }
  return { delta: tr('home.kpiNoAlerts'), deltaPositive: true }
}

export function useHomeDashboardData(opts?: { rangeDays?: number }): HomeDashboardData {
  const rangeDays = opts?.rangeDays ?? 7
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<any[]>([])
  const [userItems, setUserItems] = useState<any[]>([])
  const [automations, setAutomations] = useState<any[]>([])
  const [appsRaw, setAppsRaw] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [tick, setTick] = useState(0)
  /** 展示文案走 i18n；lang 用于让下方 useMemo 在切换语言时重算（tr 本身是稳定引用） */
  const tr = useT()
  const lang = useLang()

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        if (isGatewayWarming()) {
          await waitForBackendReady(90_000)
        }
        const [tasksRes, itemsRes, autoRes, appsRes, rolesRes] = await Promise.all([
          api.listAllTasks(),
          api.listUserItems({ include_done: false }).catch(() => ({ items: [] })),
          api.automationList().catch(() => ({ automations: [] })),
          api.listApps().catch(() => []),
          api.proactiveListRoles('active').catch(() => []),
        ])
        if (cancelled) return
        setTasks(asArray(tasksRes))
        setUserItems(Array.isArray(itemsRes?.items) ? itemsRes.items : asArray(itemsRes))
        setAutomations(Array.isArray(autoRes?.automations) ? autoRes.automations : asArray(autoRes))
        setAppsRaw(asArray(appsRes))
        const roleList = Array.isArray(rolesRes)
          ? rolesRes
          : Array.isArray(rolesRes?.roles)
            ? rolesRes.roles
            : asArray(rolesRes)
        setRoles(roleList)
      } catch (e) {
        // 后端错误信息原样透传；仅在没有任何信息时用本地化的兜底文案
        if (!cancelled) setError(e instanceof Error ? e.message : String(e || tr('home.errorLoadFailed')))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 依赖里故意不放 tr/lang：切换语言不应重新拉取全部数据
  }, [tick])

  return useMemo(() => {
    const today0 = startOfToday()
    const y0 = startOfYesterday()

    const running = tasks.filter((t) => isTaskRunningStatus(t.status) || toTaskStatusGroup(t.status) === 'planning')
    const completedToday = tasks.filter((t) => {
      if (toTaskStatusGroup(t.status) !== 'completed') return false
      const d = parseTime(t.completed_at || t.finished_at || t.updated_at || t.updatedAt)
      return d != null && d >= today0
    })
    const completedYesterday = tasks.filter((t) => {
      if (toTaskStatusGroup(t.status) !== 'completed') return false
      const d = parseTime(t.completed_at || t.finished_at || t.updated_at || t.updatedAt)
      return d != null && d >= y0 && d < today0
    })

    const pendingCreatedToday = tasks.filter((t) => {
      const g = toTaskStatusGroup(t.status)
      if (!(g === 'pending' || normalizeTaskStatusKey(t.status) === 'req_confirm')) return false
      const d = parseTime(t.created_at || t.createdAt)
      return d != null && d >= today0
    }).length

    const failedCreatedToday = tasks.filter((t) => {
      if (toTaskStatusGroup(t.status) !== 'failed') return false
      const d = parseTime(t.updated_at || t.updatedAt || t.created_at)
      return d != null && d >= today0
    }).length

    const runningNewToday = running.filter((t) => {
      const d = parseTime(t.created_at || t.createdAt || t.updated_at)
      return d != null && d >= today0
    }).length

    const autoActive = automations.filter((a) => String(a.status || '').toLowerCase() === 'active').length
    const autoTotal = automations.length

    const autoRunsToday = tasks.filter((t) => {
      const src = normalizeTaskSource(t.source || t.task_source)
      if (src !== 'workflow') return false
      const d = parseTime(t.updated_at || t.updatedAt || t.created_at || t.createdAt)
      return d != null && d >= today0
    }).length

    const successRate =
      autoRunsToday > 0 && autoTotal > 0 ? Math.round((autoActive / autoTotal) * 100) : null

    // 「需你处理」只收真要人拍板/处理的：待确认、阻塞、暂停、失败。普通排队中的 pending 不算。
    const attentionTasks = [...tasks].filter((t) => {
      const key = normalizeTaskStatusKey(t.status)
      const g = toTaskStatusGroup(t.status)
      // 随手待办单独进「我的待办」，不混进需你处理
      if (key === 'inbox' || g === 'inbox') return false
      return (
        key === 'req_confirm' ||
        key === 'waiting_user' ||
        key === 'blocked' ||
        key === 'paused' ||
        g === 'failed' ||
        g === 'paused'
      )
    })

    const inboxTasks = [...tasks].filter((t) => {
      const key = normalizeTaskStatusKey(t.status)
      if (key !== 'inbox') return false
      const raised = String(t.raised_by || 'user').trim().toLowerCase()
      return !raised || raised === 'user' || raised === 'human' || raised === 'manual' || raised === 'me' || raised === 'owner' || raised === 'operator'
    })

    let approvalCount = 0
    let alertCount = 0
    for (const t of attentionTasks) {
      const bucket = classifyAttentionBucket(t)
      if (bucket === 'approval') approvalCount += 1
      else if (bucket === 'alert') alertCount += 1
    }

    // KPI「待处理」仍统计排队中的任务（不含 inbox / 审批 / 已失败）
    const pendingCount = tasks.filter((t) => {
      const key = normalizeTaskStatusKey(t.status)
      const g = toTaskStatusGroup(t.status)
      if (key === 'inbox' || g === 'inbox') return false
      if (g === 'failed' || key === 'failed' || key === 'error' || key === 'timed_out') return false
      if (key === 'req_confirm' || key === 'waiting_user') return false
      return g === 'pending' || g === 'paused' || key === 'blocked' || key === 'paused'
    }).length

    const todoSummary: HomeTodoSummary = {
      pending: pendingCount,
      approval: approvalCount,
      alert: alertCount,
    }

    const pendingTrend =
      pendingCreatedToday > 0
        ? formatKpiDelta('pending', pendingCreatedToday, 0, tr)
        : pendingCount === 0
          ? { delta: tr('home.kpiNoPending'), deltaPositive: null as boolean | null }
          : { delta: tr('home.kpiDeltaPendingFlat'), deltaPositive: null as boolean | null }

    const runningDelta =
      runningNewToday > 0
        ? formatKpiDelta('running', runningNewToday, 0, tr)
        : { delta: tr('home.kpiFlat'), deltaPositive: null as boolean | null }
    const doneDelta = formatKpiDelta('done', completedToday.length, completedYesterday.length, tr)
    const alertDelta =
      failedCreatedToday > 0
        ? formatKpiDelta('alert', failedCreatedToday, 0, tr)
        : { delta: tr('home.kpiNoAlerts'), deltaPositive: true as boolean | null }

    const kpis: HomeKpi[] = [
      {
        id: 'pending',
        label: tr('home.kpiPending'),
        value: String(pendingCount),
        delta: pendingTrend.delta,
        deltaPositive: pendingTrend.deltaPositive,
        tone: 'accent',
      },
      {
        id: 'running',
        label: tr('home.kpiRunning'),
        value: String(running.length),
        delta: runningDelta.delta,
        deltaPositive: runningDelta.deltaPositive,
        tone: 'info',
      },
      {
        id: 'done',
        label: tr('home.kpiDoneToday'),
        value: String(completedToday.length),
        delta: doneDelta.delta,
        deltaPositive: doneDelta.deltaPositive,
        tone: 'success',
      },
      {
        id: 'alert',
        label: tr('home.kpiAlerts'),
        value: String(alertCount),
        delta: alertDelta.delta,
        deltaPositive: alertDelta.deltaPositive,
        tone: 'danger',
      },
      {
        id: 'auto',
        label: tr('home.kpiCronRate'),
        value: autoRunsToday === 0 ? '--' : `${successRate ?? 0}%`,
        delta:
          autoRunsToday === 0
            ? tr('home.kpiNoRuns')
            : autoTotal > 0
              ? tr('home.kpiAutoEnabled', { active: autoActive, total: autoTotal })
              : tr('home.kpiNoAuto'),
        deltaPositive: null,
        hint: autoRunsToday === 0 ? undefined : tr('home.kpiAutoRunsHint', { count: autoRunsToday }),
        tone: 'accent',
      },
    ]

    const attentionRank = (bucket: 'pending' | 'approval' | 'alert') =>
      bucket === 'alert' ? 0 : bucket === 'approval' ? 1 : 2

    const todos: HomeListItem[] = attentionTasks
      .sort((a, b) => {
        const ra = attentionRank(classifyAttentionBucket(a))
        const rb = attentionRank(classifyAttentionBucket(b))
        if (ra !== rb) return ra - rb
        const ta = parseTime(a.updated_at || a.updatedAt || a.created_at)?.getTime() || 0
        const tb = parseTime(b.updated_at || b.updatedAt || b.created_at)?.getTime() || 0
        return tb - ta
      })
      .slice(0, 8)
      .map((t) => {
        const bucket = classifyAttentionBucket(t)
        const src = formatTaskSourceLabel(t.source || t.task_source, tr)
        const iso = taskIsoDate(t)
        return {
          id: String(t.id || taskTitle(t, tr)),
          title: taskTitle(t, tr),
          meta: src || tr('home.metaTaskCenter'),
          status: attentionStatusLabel(bucket, tr),
          badge: attentionBadge(bucket),
          href: taskHref(t),
          sourceKey: sourceKeyOf(t),
          statusGroup: toTaskStatusGroup(t.status),
          bucket,
          dayKey: iso ? dayKey(new Date(`${iso}T00:00:00`)) : '',
          isoDate: iso,
        }
      })

    const itemTodos: HomeListItem[] = [...userItems]
      .filter((it) => String(it.status || '') !== 'done')
      .sort((a, b) => {
        const ta = parseTime(a.updated_at || a.created_at)?.getTime() || 0
        const tb = parseTime(b.updated_at || b.created_at)?.getTime() || 0
        return tb - ta
      })
      .slice(0, 8)
      .map((it) => {
        const due = String(it.due_at || '').trim()
        const iso = due ? due.slice(0, 10) : ''
        const assignee = String(it.assignee_label || it.assignee_intent || '').trim()
        const stKey = itemStatusKey(it.status)
        const st = itemStatusLabel(it, tr)
        return {
          id: String(it.id || it.title),
          title: String(it.title || tr('home.untitledItem')),
          meta: assignee || (iso ? tr('home.metaDue', { date: iso }) : tr('home.metaMyItems')),
          status: st,
          badge: badgeForItemStatus(stKey),
          href: '#/tasks?tab=items',
          sourceKey: 'item',
          statusGroup: stKey,
          dayKey: iso ? dayKey(new Date(`${iso}T00:00:00`)) : '',
          isoDate: iso,
        }
      })

    const legacyInboxTodos: HomeListItem[] = inboxTasks
      .sort((a, b) => {
        const ta = parseTime(a.updated_at || a.updatedAt || a.created_at)?.getTime() || 0
        const tb = parseTime(b.updated_at || b.updatedAt || b.created_at)?.getTime() || 0
        return tb - ta
      })
      .slice(0, 8)
      .map((t) => {
        const iso = taskIsoDate(t)
        const assignee = String(t.assigned_role || t.assigned_to || '').trim()
        return {
          id: String(t.id || taskTitle(t, tr)),
          title: taskTitle(t, tr),
          meta: assignee ? tr('home.metaToDispatch', { name: assignee }) : tr('home.metaUnassignedInbox'),
          status: tr('home.todoTitle'),
          badge: 'secondary' as const,
          href: '#/tasks?tab=items',
          sourceKey: sourceKeyOf(t),
          statusGroup: 'inbox',
          dayKey: iso ? dayKey(new Date(`${iso}T00:00:00`)) : '',
          isoDate: iso,
        }
      })

    const myTodos: HomeListItem[] = itemTodos.length ? itemTodos : legacyInboxTodos

    const recentRuns: HomeListItem[] = [...tasks]
      .sort((a, b) => {
        const ta = parseTime(a.updated_at || a.updatedAt || a.created_at)?.getTime() || 0
        const tb = parseTime(b.updated_at || b.updatedAt || b.created_at)?.getTime() || 0
        return tb - ta
      })
      .slice(0, 20)
      .map((t) => {
        const g = toTaskStatusGroup(t.status)
        const src = formatTaskSourceLabel(t.source || t.task_source, tr)
        const agent = String(t.assigned_agent_name || t.agent_name || t.role_name || '').trim()
        const iso = taskIsoDate(t)
        return {
          id: String(t.id || taskTitle(t, tr)),
          title: taskTitle(t, tr),
          meta: [src, agent].filter(Boolean).join(' · ') || tr('home.metaTask'),
          status: formatTaskStatusLabel(t.status, tr),
          badge: badgeForGroup(g),
          time: formatShortTime(t.updated_at || t.updatedAt || t.created_at, tr),
          href: taskHref(t),
          sourceKey: sourceKeyOf(t),
          statusGroup: g,
          dayKey: iso ? dayKey(new Date(`${iso}T00:00:00`)) : '',
          isoDate: iso,
        }
      })

    const workflowToday = tasks.filter((t) => {
      if (sourceKeyOf(t) !== 'workflow') return false
      const d = parseTime(t.updated_at || t.updatedAt || t.created_at)
      return d != null && d >= today0
    })
    const autoSuccess = workflowToday.filter((t) => toTaskStatusGroup(t.status) === 'completed').length
    const autoFailed = workflowToday.filter((t) => toTaskStatusGroup(t.status) === 'failed').length
    const autoSkipped = workflowToday.filter((t) => toTaskStatusGroup(t.status) === 'cancelled').length
    const autoStats: HomeAutoStats = {
      runsToday: workflowToday.length,
      success: autoSuccess,
      failed: autoFailed,
      skipped: autoSkipped,
      recentErrors: recentRuns.filter((r) => r.sourceKey === 'workflow' && r.statusGroup === 'failed').slice(0, 5),
    }

    const apps: HomeAppItem[] = appsRaw
      .filter((a) => String(a.status || '').toLowerCase() !== 'archived')
      .slice(0, 6)
      .map((a) => {
        // st 来自后端状态原值：比较一律用它，展示文案单独走 i18n
        const st = String(a.status || 'draft').toLowerCase()
        const published = st === 'published'
        return {
          id: String(a.id || a.name),
          name: String(a.name || tr('home.untitledWorkflow')),
          status: published ? tr('home.appPublished') : st === 'draft' ? tr('home.appDraft') : st,
          badge: published ? 'success' : 'secondary',
          href: a.id ? `#/apps/${encodeURIComponent(String(a.id))}` : '#/apps',
        }
      })

    void roles

    return {
      loading,
      error,
      kpis,
      trendData: buildTrend(tasks, rangeDays),
      sourceData: buildSource(tasks, tr),
      todos,
      todoSummary,
      myTodos,
      recentRuns,
      apps,
      autoStats,
      refresh,
    }
    // lang 必需：切换语言时所有展示文案要重算（tr 是稳定引用，一起写上便于阅读）
  }, [appsRaw, automations, error, lang, loading, rangeDays, refresh, roles, tasks, tr, userItems])
}
