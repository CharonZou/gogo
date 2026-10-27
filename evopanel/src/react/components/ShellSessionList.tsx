import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { getCurrentRoute, navigate } from '../../router.js'
import {
  mutateSessionPinned,
  persistPinnedOrderFromRows,
  renameSession,
  reorderPinnedRowsInPlace,
} from '../lib/session-list/session-list-mutations.js'
import { clearSessionPinPending } from '../lib/session-list/session-pin-pending.js'
import {
  loadExpandedWorkspaceKeys,
  saveExpandedWorkspaceKeys,
} from '../lib/session-list/expanded-workspaces-storage.js'
import {
  loadPinnedWorkspaceKeys,
  savePinnedWorkspaceKeys,
} from '../lib/session-list/pinned-workspaces-storage.js'
import type { ShellSidebarSyncRow, ShellWorkspaceGroup } from '../lib/session-list/types.js'
import type { ResolvedLiveStreamActivity } from '../lib/resolve-live-stream-activity.js'
import type { RunningSessionSummary } from '../hooks/useRunningSessionSummaries.js'
import {
  ShellSessionListRow,
  SessionContextMenuPortal,
  clipSidebarSessionTitle,
} from './ShellSessionListRow.js'
import {
  WORKSPACE_GROUP_PROACTIVE,
  WORKSPACE_GROUP_PROACTIVE_LABEL,
  WORKSPACE_GROUP_UNBOUND,
  WORKSPACE_GROUP_VIRTUAL,
  formatWorkspaceGroupLabel,
  isSpecialWorkspaceGroupKey,
  normalizeWorkspacePathKey,
  proactiveAgentCodeFromSessionKey,
  resolveShellGroupWorkspacePath,
  splitVisibleAndFoldedDutySessions,
} from '../lib/session-list/workspace-groups.js'
import { AssignedAgentAvatar } from './AssignedAgentAvatar.js'
import {
  ShellChevronIcon,
  ShellFolderPlusIcon,
  ShellMoreIcon,
  ShellPlusIcon,
  ShellRefreshIcon,
  ShellSearchIcon,
  ShellWorkspaceIcon,
} from './ShellSidebarIcons.js'
import { gogoFetch } from '../../lib/ws-client.js'
import { showConfirm } from '../../components/modal.js'
import { toast } from '../../components/toast.js'
import { useLang, useT } from '../lib/useI18n'
import {
  DndContext,
  DragOverlay,
  DroppableGroupWrap,
  sessionDndId,
  useSessionDnd,
} from '../lib/session-list/session-dnd.js'
import {
  WorkspaceFolderContextMenuPortal,
  type WorkspaceFolderContextMenuState,
} from './WorkspaceFolderContextMenuPortal.js'

export type ShellSessionListProps = {
  listLoading: boolean
  sessionFilter: string
  moreMenuKey: string | null
  selectedSessionKey: string
  newTaskActive: boolean
  rows: ShellSidebarSyncRow[]
  groups: ShellWorkspaceGroup[]
  /** ``/api/agents``：员工会话行展示岗位头像 */
  agents?: unknown[] | null
  runningSessionMap?: Record<string, RunningSessionSummary>
  resolveLiveStreamActivityForSession?: (
    sessionKey: string,
    isSelectedRow: boolean,
  ) => ResolvedLiveStreamActivity | null
  globalHasMore?: boolean
  globalLoading?: boolean
  onSelectSession: (sessionKey: string) => void
  /** Background warm idle runtime cache on sidebar hover. */
  onPrefetchSession?: (sessionKey: string) => void
  onSessionFilterChange: (value: string) => void
  onMoreMenuToggle: (sessionKey: string) => void
  onMoreMenuClose: () => void
  onDeleteSession: (sessionKey: string) => void
  onDeleteSessionHard?: (sessionKey: string) => void
  onForkSession?: (sessionKey: string) => void
  onRefreshSession: (sessionKey: string) => void
  onRefreshSessionList: () => void | Promise<void>
  onStopSession: (sessionKey: string) => void
  onWorkspaceExpand?: (
    workspaceKey: string,
    opt?: { force?: boolean; silent?: boolean },
  ) => void
  onLoadMoreWorkspace?: (workspaceKey: string) => void
  onLoadMoreGlobal?: () => void
  onPinSession?: (sessionKey: string, pinned: boolean) => void
  onNewWorkspace?: () => void
  onNewSessionInWorkspace?: (workspacePath: string | null) => void
  onDeleteWorkspace?: (group: ShellWorkspaceGroup) => void | Promise<void>
  /** 用户点选工作空间时，供全局「新对话」继承该目录 */
  onWorkspaceFocus?: (workspacePath: string | null) => void
  onOpenWorkspaceFolder?: (group: ShellWorkspaceGroup) => void | Promise<void>
  registeredWorkspacePaths?: string[]
  /** 已雇佣员工花名册；员工 Tab 展示全员，即使尚无会话 */
  employeeRoles?: Array<{
    agent_code: string
    role_name: string
    agent_name?: string
    department?: string
    status?: string
  }> | null
}

const SS_PENDING_SHELL_SESSION = 'evopanel_pending_shell_session'

function clearPendingShellSession(): void {
  try {
    sessionStorage.removeItem(SS_PENDING_SHELL_SESSION)
  } catch {
    /* ignore */
  }
}

function isChatHashRoute(): boolean {
  const p = (getCurrentRoute() || '/chat').split('?')[0]
  return p === '/chat' || p === '/chat-react'
}

function normalizePinKey(key: string): string {
  const raw = String(key || '').trim()
  if (!raw || isSpecialWorkspaceGroupKey(raw)) return raw
  return normalizeWorkspacePathKey(raw) || raw
}

/** 未命名岗位文案在语言包内，这里只带键名（导入期不取文案） */
const EMPLOYEE_JOB_TITLE_FALLBACK_KEY = 'chatShell.unnamedJobTitle'

/** 整组常量「智能体员工」不是具体岗位名，不能当员工下拉项文案 */
function isGenericEmployeeSidebarLabel(value: string, jobTitleFallback: string): boolean {
  const label = String(value || '').trim()
  return !label || label === WORKSPACE_GROUP_PROACTIVE_LABEL || label === jobTitleFallback
}

/** 与 ShellSessionListRow 一致：忽略大小写，_/- 互通，避免匹配失败后露出英文 code */
function normalizeEmployeeCodeKey(code: string): string {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
}

/** 岗位名是否已塌成英文 agent_code（不能当标题） */
function isCollapsedJobTitle(title: string, agentCode: string): boolean {
  const name = String(title || '').trim()
  const code = String(agentCode || '').trim()
  if (!name) return true
  if (!code) return false
  return normalizeEmployeeCodeKey(name) === normalizeEmployeeCodeKey(code)
}

/**
 * 员工下拉 / 分组标题：永远只显示岗位名（role_name）。
 * 禁止 agent_name、禁止英文 agent_code、禁止整组常量「智能体员工」。
 */
function resolveEmployeeGroupLabel(
  agentCode: string,
  roles: Array<{ agent_code: string; role_name: string; agent_name?: string }> | null | undefined,
  jobTitleFallback: string,
  fallback = '',
): string {
  const code = String(agentCode || '').trim()
  const codeKey = normalizeEmployeeCodeKey(code)
  const role = (roles || []).find(
    (r) => normalizeEmployeeCodeKey(r.agent_code) === codeKey,
  )
  const candidates = [role?.role_name, fallback]
  for (const raw of candidates) {
    const title = String(raw || '').trim()
    if (!title || isGenericEmployeeSidebarLabel(title, jobTitleFallback)) continue
    if (isCollapsedJobTitle(title, code)) continue
    // 显式不用 agent_name：即使与岗位名相同，也只接受 role_name / 岗位 hint
    return title
  }
  return jobTitleFallback
}

type EmployeeSidebarGroup = {
  agentCode: string
  label: string
  sessions: ShellSidebarSyncRow[]
  maxUpdatedAt: number
}

/** 员工 Tab：按 agent_code 折叠；花名册无会话也占一组 */
function buildEmployeeSidebarGroups(
  sessionRows: ShellSidebarSyncRow[],
  roles: Array<{ agent_code: string; role_name: string; agent_name?: string }> | null | undefined,
  jobTitleFallback: string,
): EmployeeSidebarGroup[] {
  const sessionsByCode = new Map<string, ShellSidebarSyncRow[]>()
  for (const row of sessionRows) {
    const code = proactiveAgentCodeFromSessionKey(row.sessionKey)
    if (!code) continue
    const lc = normalizeEmployeeCodeKey(code)
    const list = sessionsByCode.get(lc) || []
    list.push(row)
    sessionsByCode.set(lc, list)
  }

  const out: EmployeeSidebarGroup[] = []
  const seen = new Set<string>()
  const list = Array.isArray(roles) ? roles : []

  const pushGroup = (code: string, labelHint = '') => {
    const lc = normalizeEmployeeCodeKey(code)
    if (!lc || seen.has(lc)) return
    seen.add(lc)
    const sessions = [...(sessionsByCode.get(lc) || [])].sort((a, b) => {
      const byUpdated = Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
      if (byUpdated !== 0) return byUpdated
      return String(a.sessionKey || '').localeCompare(String(b.sessionKey || ''))
    })
    const maxUpdatedAt = sessions.reduce((m, r) => Math.max(m, Number(r.updatedAt || 0)), 0)
    out.push({
      agentCode: code,
      label: resolveEmployeeGroupLabel(code, roles, jobTitleFallback, labelHint),
      sessions,
      maxUpdatedAt,
    })
  }

  for (const role of list) {
    const code = String(role.agent_code || '').trim()
    if (!code) continue
    pushGroup(code, String(role.role_name || '').trim())
  }
  for (const [lc, rowsForCode] of sessionsByCode) {
    if (seen.has(lc)) continue
    const code = proactiveAgentCodeFromSessionKey(rowsForCode[0]?.sessionKey) || lc
    // workspaceLabel 对 proactive 会话恒为「智能体员工」，不能当岗位名传入
    const wsLabel = String(rowsForCode[0]?.workspaceLabel || '').trim()
    pushGroup(code, isGenericEmployeeSidebarLabel(wsLabel, jobTitleFallback) ? '' : wsLabel)
  }

  return out.sort((a, b) => {
    const byUpdated = Number(b.maxUpdatedAt || 0) - Number(a.maxUpdatedAt || 0)
    if (byUpdated !== 0) return byUpdated
    return a.label.localeCompare(b.label, 'zh-CN')
  })
}

/**
 * 特殊分组的展示名：workspace-groups 层给的是中文常量，这里按 workspaceKey
 * （稳定标识）出双语文案；普通分组仍是目录 basename 等后端数据，原样返回。
 */
function resolveGroupDisplayLabel(
  group: ShellWorkspaceGroup,
  translate: (key: string) => string,
): string {
  if (group.workspaceKey === WORKSPACE_GROUP_UNBOUND) return translate('chatShell.groupDefault')
  if (group.workspaceKey === WORKSPACE_GROUP_PROACTIVE) {
    return translate('chatShell.groupEmployees')
  }
  if (group.workspaceKey === WORKSPACE_GROUP_VIRTUAL) return translate('chatShell.groupVirtual')
  return String(group.label || '')
}

export function ShellSessionList({
  listLoading,
  sessionFilter,
  moreMenuKey,
  selectedSessionKey,
  newTaskActive,
  rows,
  groups = [],
  agents = null,
  employeeRoles = null,
  runningSessionMap = {},
  resolveLiveStreamActivityForSession,
  globalHasMore = false,
  globalLoading = false,
  onSelectSession,
  onPrefetchSession,
  onSessionFilterChange,
  onMoreMenuToggle,
  onMoreMenuClose,
  onDeleteSession,
  onDeleteSessionHard,
  onForkSession,
  onRefreshSession,
  onRefreshSessionList,
  onStopSession,
  onWorkspaceExpand,
  onLoadMoreWorkspace,
  onLoadMoreGlobal,
  onPinSession,
  onNewWorkspace,
  onNewSessionInWorkspace,
  onDeleteWorkspace,
  onWorkspaceFocus,
  onOpenWorkspaceFolder,
  registeredWorkspacePaths = [],
}: ShellSessionListProps) {
  const t = useT()
  const lang = useLang()
  const [titleEditKey, setTitleEditKey] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  /** 点击「刷新会话列表」按钮后的刷新中状态（列表未变化时给可见反馈） */
  const [refreshing, setRefreshing] = useState(false)
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  /** chats = 普通对话；employees = 智能体员工会话 */
  const [listTab, setListTab] = useState<'chats' | 'employees'>('chats')
  const [focusedWorkspaceKey, setFocusedWorkspaceKey] = useState<string | null>(null)
  /** 员工 Tab：下拉选中的员工 code；空 = 全部员工 */
  const [focusedEmployeeCode, setFocusedEmployeeCode] = useState<string | null>(null)
  const [empMenuOpen, setEmpMenuOpen] = useState(false)
  const [dutyFoldOpen, setDutyFoldOpen] = useState(false)
  const [pinnedWorkspaceKeys, setPinnedWorkspaceKeys] = useState<string[]>(() =>
    loadPinnedWorkspaceKeys(),
  )
  const [contextMenu, setContextMenu] = useState<{
    sessionKey: string
    x: number
    y: number
  } | null>(null)
  const [workspaceContextMenu, setWorkspaceContextMenu] =
    useState<WorkspaceFolderContextMenuState | null>(null)
  /** 正在编辑项目标题的 workspaceKey */
  const [workspaceTitleEditKey, setWorkspaceTitleEditKey] = useState('')
  /** 本地项目标题覆盖（编辑后立即生效，刷新后由后端 title 接管） */
  const [wsTitleOverride, setWsTitleOverride] = useState<Record<string, string | null>>({})
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(() =>
    loadExpandedWorkspaceKeys(),
  )
  /** 回收站（归档会话）：可恢复 / 可彻底删除 */
  const [trashRows, setTrashRows] = useState<
    Array<{
      sessionKey: string
      title: string
      localWorkspaceRoot: string | null
      archivedAt: string | null
      messageCount: number
    }>
  >([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashQuery, setTrashQuery] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const wsMenuRef = useRef<HTMLDivElement>(null)
  const empMenuRef = useRef<HTMLDivElement>(null)
  const loadMoreLockRef = useRef<Record<string, boolean>>({})
  const autoTabForSessionRef = useRef('')
  const onWorkspaceExpandRef = useRef(onWorkspaceExpand)
  onWorkspaceExpandRef.current = onWorkspaceExpand

  const onChatRoute = isChatHashRoute()
  const displaySelectedKey = String(selectedSessionKey || '').trim()
  const isSearching = !!String(sessionFilter || '').trim()
  const isEmployeesTab = listTab === 'employees'

  /** 父级花名册为空时（启动竞态），员工 Tab 自行补拉岗位名 */
  const [localEmployeeRoles, setLocalEmployeeRoles] = useState<
    Array<{ agent_code: string; role_name: string; agent_name?: string }>
  >([])
  useEffect(() => {
    if (!isEmployeesTab) return
    if (Array.isArray(employeeRoles) && employeeRoles.length > 0) return
    let cancelled = false
    void import('../../lib/tauri-api.js')
      .then(async ({ api, isGatewayWarming, waitForBackendReady }) => {
        if (typeof isGatewayWarming === 'function' && isGatewayWarming()) {
          await waitForBackendReady?.(90_000).catch(() => {})
        }
        return api.proactiveListRoles('active')
      })
      .then((res: { roles?: unknown[] } | unknown[]) => {
        if (cancelled) return
        const raw = Array.isArray(res)
          ? res
          : Array.isArray((res as { roles?: unknown[] })?.roles)
            ? (res as { roles: unknown[] }).roles
            : []
        const roles = raw
          .map((r: any) => ({
            agent_code: String(r?.agent_code || '').trim(),
            role_name: String(r?.role_name || '').trim(),
            agent_name: String(r?.agent_name || '').trim(),
          }))
          .filter((r) => r.agent_code)
        setLocalEmployeeRoles(roles)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isEmployeesTab, employeeRoles])

  const effectiveEmployeeRoles =
    Array.isArray(employeeRoles) && employeeRoles.length > 0
      ? employeeRoles
      : localEmployeeRoles

  useEffect(() => {
    setDutyFoldOpen(false)
  }, [isEmployeesTab, focusedEmployeeCode])

  /** 选中会话变化时对齐 Tab；不覆盖用户手动点 Tab */
  useEffect(() => {
    if (!displaySelectedKey) return
    if (autoTabForSessionRef.current === displaySelectedKey) return
    autoTabForSessionRef.current = displaySelectedKey
    const hit = rows.find((r) => String(r.sessionKey || '') === displaySelectedKey)
    if (!hit) return
    setListTab(hit.workspaceKey === WORKSPACE_GROUP_PROACTIVE ? 'employees' : 'chats')
  }, [displaySelectedKey, rows])

  /** 进入员工 Tab：已有数据则静默补拉，避免再亮一次底部 loading */
  useEffect(() => {
    if (!isEmployeesTab) return
    const hasProactive = rows.some((r) => r.workspaceKey === WORKSPACE_GROUP_PROACTIVE)
    onWorkspaceExpandRef.current?.(WORKSPACE_GROUP_PROACTIVE, {
      force: true,
      silent: hasProactive,
    })
  }, [isEmployeesTab])

  /**
   * 员工对话：后台新建会话靠 panel:session_upserted / 切回前台补拉即可。
   * 不要 setInterval 轮询——会反复 soft merge + 把 offset 打回首页，
   * IntersectionObserver 再 loadMore，底部 sentinel 转圈 →「最后一个闪烁」。
   */
  useEffect(() => {
    if (!isEmployeesTab) return
    const reload = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      onWorkspaceExpandRef.current?.(WORKSPACE_GROUP_PROACTIVE, {
        force: true,
        silent: true,
      })
    }
    const onVis = () => {
      if (!document.hidden) reload()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isEmployeesTab])

  const focusWorkspaceGroup = useCallback(
    (group: ShellWorkspaceGroup) => {
      if (isSpecialWorkspaceGroupKey(group.workspaceKey)) {
        onWorkspaceFocus?.(null)
        return
      }
      onWorkspaceFocus?.(resolveShellGroupWorkspacePath(group, registeredWorkspacePaths))
    },
    [onWorkspaceFocus, registeredWorkspacePaths],
  )

  const applyWorkspaceFocusFilter = useCallback(
    (group: ShellWorkspaceGroup | null) => {
      if (!group) {
        setFocusedWorkspaceKey(null)
        return
      }
      const key = normalizePinKey(group.workspaceKey)
      setFocusedWorkspaceKey(key)
      focusWorkspaceGroup(group)
      onWorkspaceExpand?.(key)
    },
    [focusWorkspaceGroup, onWorkspaceExpand],
  )

  const toggleWorkspacePinned = useCallback((workspaceKey: string) => {
    const key = normalizePinKey(workspaceKey)
    if (!key || isSpecialWorkspaceGroupKey(key)) return
    setPinnedWorkspaceKeys((prev) => {
      const exists = prev.some((k) => normalizePinKey(k) === key)
      const next = exists ? prev.filter((k) => normalizePinKey(k) !== key) : [...prev, key]
      savePinnedWorkspaceKeys(next)
      return next
    })
  }, [])

  const pinnedWorkspaceKeySet = useMemo(
    () => new Set(pinnedWorkspaceKeys.map((k) => normalizePinKey(k))),
    [pinnedWorkspaceKeys],
  )

  const focusedGroup = useMemo(() => {
    if (!focusedWorkspaceKey) return null
    const nk = normalizePinKey(focusedWorkspaceKey)
    return groups.find((g) => normalizePinKey(g.workspaceKey) === nk) || null
  }, [focusedWorkspaceKey, groups])

  /** 普通对话 Tab 下可选的工作空间（排除员工；含默认与已注册目录） */
  const workspaceFilterOptions = useMemo(() => {
    return groups.filter((g) => {
      if (g.workspaceKey === WORKSPACE_GROUP_PROACTIVE) return false
      if (g.workspaceKey === WORKSPACE_GROUP_VIRTUAL) return false
      return true
    })
  }, [groups])

  /** 分组展示名：特殊分组出双语文案，其余保持后端目录名 */
  const groupLabelFor = useCallback(
    (g: ShellWorkspaceGroup | null | undefined): string =>
      g ? resolveGroupDisplayLabel(g, t) : '',
    [t],
  )

  const selectWorkspaceFilter = useCallback(
    (group: ShellWorkspaceGroup | null) => {
      if (!group) {
        setFocusedWorkspaceKey(null)
        onWorkspaceFocus?.(null)
        setWsMenuOpen(false)
        return
      }
      const key = normalizePinKey(group.workspaceKey)
      setFocusedWorkspaceKey(key)
      setListTab('chats')
      setWsMenuOpen(false)
      if (key === WORKSPACE_GROUP_UNBOUND) {
        onWorkspaceFocus?.(null)
      } else {
        focusWorkspaceGroup(group)
      }
      onWorkspaceExpand?.(key)
    },
    [focusWorkspaceGroup, onWorkspaceExpand, onWorkspaceFocus],
  )

  const workspaceFilterLabel = groupLabelFor(focusedGroup) || t('chatShell.allWorkspaces')

  useEffect(() => {
    if (!wsMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (t && wsMenuRef.current?.contains(t)) return
      setWsMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [wsMenuOpen])

  useEffect(() => {
    const onExpandWorkspace = (ev: Event) => {
      const key = String(
        (ev as CustomEvent<{ workspaceKey?: string }>).detail?.workspaceKey || '',
      ).trim()
      if (!key) return
      const alreadyExpanded = expandedWorkspaces.has(key)
      setExpandedWorkspaces((prev) => {
        if (prev.has(key)) return prev
        const next = new Set(prev)
        next.add(key)
        saveExpandedWorkspaceKeys(next)
        return next
      })
      if (!alreadyExpanded) onWorkspaceExpand?.(key)
    }
    window.addEventListener('evopanel:shell-expand-workspace', onExpandWorkspace)
    return () => window.removeEventListener('evopanel:shell-expand-workspace', onExpandWorkspace)
  }, [expandedWorkspaces, onWorkspaceExpand])

  useEffect(() => {
    const btn = document.getElementById('shell-btn-new-task')
    if (!btn) return
    const na = !!newTaskActive && !displaySelectedKey
    btn.classList.toggle('active', na && onChatRoute)
  }, [newTaskActive, displaySelectedKey, onChatRoute])

  const handleSelect = useCallback(
    (sessionKey: string) => {
      const key = String(sessionKey || '').trim()
      if (!key) return
      clearPendingShellSession()
      document.getElementById('app-shell-aside')?.classList.remove('shell-aside-open')
      document.getElementById('shell-aside-overlay')?.classList.remove('visible')
      // 不在其它路由上立刻 select：宿主仍是 display:none，MessageVirtualList 会在 0 高度下 boot，
      // 回到 #/chat 后内容空白直到刷新。交给 chat-route-shown 再选一次。
      if (!isChatHashRoute()) {
        try {
          sessionStorage.setItem(SS_PENDING_SHELL_SESSION, key)
        } catch {
          /* ignore */
        }
        navigate('/chat')
        return
      }
      onSelectSession(key)
    },
    [onSelectSession],
  )

  const runMenuAction = useCallback(
    (action: 'pin' | 'rename' | 'stop' | 'delete' | 'delete-hard' | 'fork' | 'refresh', sessionKey: string) => {
      const key = String(sessionKey || '').trim()
      if (!key) return
      setContextMenu(null)
      onMoreMenuClose()
      if (action === 'stop') {
        onStopSession(key)
        return
      }
      if (action === 'delete') {
        window.setTimeout(() => onDeleteSession(key), 0)
        return
      }
      if (action === 'delete-hard') {
        window.setTimeout(() => onDeleteSessionHard?.(key), 0)
        return
      }
      if (action === 'fork') {
        window.setTimeout(() => onForkSession?.(key), 0)
        return
      }
      if (action === 'refresh') {
        onRefreshSession(key)
        return
      }
      if (action === 'rename') {
        setTitleEditKey(key)
        return
      }
      if (action === 'pin') {
        const row = rows.find((r) => String(r.sessionKey || '') === key)
        const nextPinned = !row?.isPinned
        onPinSession?.(key, nextPinned)
        void mutateSessionPinned(key, nextPinned).catch(() => {
          clearSessionPinPending(key)
          onPinSession?.(key, !nextPinned)
        })
      }
    },
    [onDeleteSession, onDeleteSessionHard, onForkSession, onMoreMenuClose, onPinSession, onRefreshSession, onStopSession, rows],
  )

  const handleTitleCommit = useCallback(
    async (sessionKey: string, rawValue: string) => {
      const key = String(sessionKey || '').trim()
      const row = rows.find((r) => String(r.sessionKey || '') === key)
      const current = String(row?.title || '').trim()
      const title = clipSidebarSessionTitle(rawValue)
      setTitleEditKey('')
      if (!key || !title || title === current) return
      try {
        await renameSession(key, title)
      } catch {
        /* refresh 后恢复 */
      }
    },
    [rows],
  )

  const handlePinnedReorder = useCallback(
    (dragKey: string, dropKey: string) => {
      const nextRows = reorderPinnedRowsInPlace(rows, dragKey, dropKey)
      if (!nextRows) return
      void persistPinnedOrderFromRows(nextRows).catch(() => {})
    },
    [rows],
  )

  useEffect(() => {
    if (!filterOpen) return
    const t = window.setTimeout(() => filterInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [filterOpen])

  useEffect(() => {
    if (sessionFilter) setFilterOpen(true)
  }, [sessionFilter])

  const triggerLoadMore = useCallback(
    (workspaceKey: string) => {
      const key = String(workspaceKey || '').trim()
      if (!key) return
      if (loadMoreLockRef.current[key]) return
      loadMoreLockRef.current[key] = true
      if (key === '__global__') onLoadMoreGlobal?.()
      else onLoadMoreWorkspace?.(key)
      window.setTimeout(() => {
        loadMoreLockRef.current[key] = false
      }, 400)
    },
    [onLoadMoreGlobal, onLoadMoreWorkspace],
  )

  const loadMoreKeys = useMemo(() => {
    if (isEmployeesTab) {
      const g = groups.find((x) => x.workspaceKey === WORKSPACE_GROUP_PROACTIVE)
      return g?.hasMoreSessions ? [WORKSPACE_GROUP_PROACTIVE] : []
    }
    if (focusedWorkspaceKey) {
      const g = focusedGroup
      return g?.hasMoreSessions ? [g.workspaceKey] : []
    }
    return globalHasMore ? ['__global__'] : []
  }, [isEmployeesTab, focusedWorkspaceKey, focusedGroup, globalHasMore, groups])

  const loadMoreKeysSig = loadMoreKeys.join('\n')

  useEffect(() => {
    if (!loadMoreKeysSig) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const key = (entry.target as HTMLElement).dataset.workspaceKey
            if (key) triggerLoadMore(key)
          }
        }
      },
      { rootMargin: '80px' },
    )
    const sentinels = listRef.current?.querySelectorAll('[data-load-more-sentinel]')
    sentinels?.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [loadMoreKeysSig, triggerLoadMore])

  const workspaceContextGroup = workspaceContextMenu
    ? groups.find((g) => g.workspaceKey === workspaceContextMenu.workspaceKey) || null
    : null

  const contextRow = contextMenu
    ? rows.find((r) => String(r.sessionKey || '') === contextMenu.sessionKey) || null
    : null

  /** 选中员工会话时对齐员工下拉 */
  useEffect(() => {
    if (!isEmployeesTab || !displaySelectedKey) return
    const code = proactiveAgentCodeFromSessionKey(displaySelectedKey)
    if (!code) return
    setFocusedEmployeeCode((prev) => {
      if (prev && prev.toLowerCase() === code.toLowerCase()) return prev
      return code
    })
  }, [isEmployeesTab, displaySelectedKey])

  useEffect(() => {
    if (!empMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (t && empMenuRef.current?.contains(t)) return
      setEmpMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEmpMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [empMenuOpen])

  const openNewEmployeeChat = useCallback(
    (agentCode: string) => {
      const code = String(agentCode || '').trim()
      if (!code) return
      const stamp = new Date().toISOString().replace(/[:/\\]/g, '-')
      const sk = `proactive:${code}:chat:${stamp}`
      clearPendingShellSession()
      try {
        sessionStorage.setItem(SS_PENDING_SHELL_SESSION, sk)
      } catch {
        /* ignore */
      }
      onSelectSession(sk)
    },
    [onSelectSession],
  )

  /** 员工 Tab：会话 ∪ 雇佣花名册 */
  const employeeGroups = useMemo(() => {
    if (!isEmployeesTab) return [] as EmployeeSidebarGroup[]
    const sessionOnly = rows.filter((r) => r.workspaceKey === WORKSPACE_GROUP_PROACTIVE)
    let groups = buildEmployeeSidebarGroups(
      sessionOnly,
      effectiveEmployeeRoles,
      t(EMPLOYEE_JOB_TITLE_FALLBACK_KEY),
    )
    const q = String(sessionFilter || '').trim().toLowerCase()
    if (q) {
      groups = groups
        .map((g) => {
          const code = g.agentCode.toLowerCase()
          const label = g.label.toLowerCase()
          const roleHit = (effectiveEmployeeRoles || []).some((role) => {
            if (String(role.agent_code || '').trim().toLowerCase() !== code) return false
            const an = String(role.agent_name || '').toLowerCase()
            const rn = String(role.role_name || '').toLowerCase()
            return an.includes(q) || rn.includes(q)
          })
          const groupHit = label.includes(q) || code.includes(q) || roleHit
          if (groupHit) return g
          const matchedSessions = g.sessions.filter((r) =>
            String(r.title || '')
              .toLowerCase()
              .includes(q),
          )
          if (matchedSessions.length === 0) return null
          return { ...g, sessions: matchedSessions }
        })
        .filter((g): g is EmployeeSidebarGroup => !!g)
    }
    return groups
    // lang：语言切换后 t 仍是同一函数引用，只有 lang 能让岗位兜底文案重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployeesTab, rows, effectiveEmployeeRoles, sessionFilter, t, lang])

  const focusedEmployeeGroup = useMemo(() => {
    if (!focusedEmployeeCode) return null
    const lc = focusedEmployeeCode.toLowerCase()
    return employeeGroups.find((g) => g.agentCode.toLowerCase() === lc) || null
  }, [focusedEmployeeCode, employeeGroups])

  const employeeFilterLabel = focusedEmployeeGroup?.label || t('chatShell.allEmployees')

  const employeeSessionRows = useMemo(() => {
    if (!isEmployeesTab) return [] as ShellSidebarSyncRow[]
    if (focusedEmployeeCode) {
      const lc = focusedEmployeeCode.toLowerCase()
      const g = employeeGroups.find((x) => x.agentCode.toLowerCase() === lc)
      return g?.sessions || []
    }
    // 全部员工：标题前缀员工名，避免多岗会话混在一起分不清
    return employeeGroups.flatMap((g) =>
      g.sessions.map((r) => ({
        ...r,
        title: `${g.label} · ${String(r.title || '').trim() || t('chatShell.sessionFallbackTitle')}`,
      })),
    )
    // lang：标题兜底「会话」随语言变化，需要重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployeesTab, employeeGroups, focusedEmployeeCode, t, lang])

  const pinnedRows = useMemo(() => {
    if (isEmployeesTab) {
      return employeeSessionRows
        .filter((r) => !!r.isPinned)
        .sort((a, b) => {
          const po = Number(a.pinOrder ?? 0) - Number(b.pinOrder ?? 0)
          if (po !== 0) return po
          return Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        })
    }
    let list = rows
      .filter((r) => !!r.isPinned)
      .sort((a, b) => {
        const po = Number(a.pinOrder ?? 0) - Number(b.pinOrder ?? 0)
        if (po !== 0) return po
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
      })
    list = list.filter((r) => r.workspaceKey !== WORKSPACE_GROUP_PROACTIVE)
    if (focusedWorkspaceKey) {
      const nk = normalizePinKey(focusedWorkspaceKey)
      list = list.filter((r) => normalizePinKey(r.workspaceKey) === nk)
    }
    return list
  }, [rows, focusedWorkspaceKey, isEmployeesTab, employeeSessionRows])

  const pinnedKeySet = useMemo(
    () => new Set(pinnedRows.map((r) => String(r.sessionKey || ''))),
    [pinnedRows],
  )

  const recentRows = useMemo(() => {
    if (isEmployeesTab) {
      return [...employeeSessionRows.filter((r) => !pinnedKeySet.has(String(r.sessionKey || '')))].sort(
        (a, b) => {
          const byUpdated = Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
          if (byUpdated !== 0) return byUpdated
          return String(a.sessionKey || '').localeCompare(String(b.sessionKey || ''))
        },
      )
    }
    let list = rows.filter((r) => !pinnedKeySet.has(String(r.sessionKey || '')))
    list = list.filter((r) => r.workspaceKey !== WORKSPACE_GROUP_PROACTIVE)
    if (focusedWorkspaceKey) {
      const nk = normalizePinKey(focusedWorkspaceKey)
      list = list.filter((r) => normalizePinKey(r.workspaceKey) === nk)
    }
    return [...list].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  }, [rows, pinnedKeySet, focusedWorkspaceKey, isEmployeesTab, employeeSessionRows])

  const selectEmployeeFilter = useCallback((code: string | null) => {
    setFocusedEmployeeCode(code ? String(code).trim() || null : null)
    setEmpMenuOpen(false)
    setDutyFoldOpen(false)
  }, [])

  const employeeDutySplit = useMemo(() => {
    if (!isEmployeesTab) return { visible: recentRows, folded: [] as ShellSidebarSyncRow[] }
    return splitVisibleAndFoldedDutySessions(recentRows, {
      selectedSessionKey: displaySelectedKey,
      expandAll: false,
    })
  }, [isEmployeesTab, recentRows, displaySelectedKey])
  const recentVisibleRows = isEmployeesTab && !isSearching
    ? employeeDutySplit.visible
    : recentRows
  const foldedDutyRows = employeeDutySplit.folded
  const showDutyFold = isEmployeesTab && !isSearching && foldedDutyRows.length > 0

  const renderSessionRow = (
    row: ShellSidebarSyncRow,
    options: { draggable?: boolean; group?: ShellWorkspaceGroup } = {},
  ) => {
    const sk = String(row.sessionKey || '')
    const active = onChatRoute && sk === displaySelectedKey
    const ownerSpecial = options.group
      ? isSpecialWorkspaceGroupKey(options.group.workspaceKey)
      : false
    const canDrag = !!options.draggable && !!options.group && !ownerSpecial
    const rowNode = (
      <ShellSessionListRow
        key={sk}
        row={row}
        active={active}
        moreOpen={moreMenuKey === sk}
        editingTitle={titleEditKey === sk}
        agents={agents}
        employeeRoles={effectiveEmployeeRoles}
        runningSummary={runningSessionMap[sk] ?? null}
        resolveLiveStreamActivity={resolveLiveStreamActivityForSession}
        variant="chat"
        draggableId={canDrag ? sessionDndId(sk) : undefined}
        onSelect={() => handleSelect(sk)}
        onMoreToggle={() => onMoreMenuToggle(sk)}
        onRefresh={() => onRefreshSession(sk)}
        onMenuAction={(action) => runMenuAction(action, sk)}
        onTitleCommit={(title) => void handleTitleCommit(sk, title)}
        onTitleCancel={() => setTitleEditKey('')}
        onStartTitleEdit={() => {
          setContextMenu(null)
          onMoreMenuClose()
          setTitleEditKey(sk)
        }}
        onContextMenu={(x, y) => {
          onMoreMenuClose()
          setContextMenu({ sessionKey: sk, x, y })
        }}
        onPinnedReorder={handlePinnedReorder}
        onPrefetch={
          active || !onPrefetchSession ? undefined : () => onPrefetchSession(sk)
        }
      />
    )
    return rowNode
  }

  const flatHasMore = isEmployeesTab
    ? !!groups.find((g) => g.workspaceKey === WORKSPACE_GROUP_PROACTIVE)?.hasMoreSessions
    : focusedWorkspaceKey
      ? !!focusedGroup?.hasMoreSessions
      : globalHasMore
  const flatLoading = isEmployeesTab
    ? !!groups.find((g) => g.workspaceKey === WORKSPACE_GROUP_PROACTIVE)?.loadingSessions
    : focusedWorkspaceKey
      ? !!focusedGroup?.loadingSessions
      : globalLoading

  const handleNewSessionClick = useCallback(() => {
    setFilterOpen(false)
    onSessionFilterChange('')
    if (isEmployeesTab) {
      const code = String(focusedEmployeeCode || '').trim()
      if (!code) {
        setEmpMenuOpen(true)
        return
      }
      openNewEmployeeChat(code)
      return
    }
    // 优先在当前筛选的工作空间内新建，避免全部落到「默认」
    if (focusedGroup) {
      const path =
        focusedGroup.workspaceKey === WORKSPACE_GROUP_UNBOUND
          ? null
          : resolveShellGroupWorkspacePath(focusedGroup, registeredWorkspacePaths)
      onNewSessionInWorkspace?.(path)
      return
    }
    const btn = document.getElementById('shell-btn-new-task')
    if (btn) {
      btn.click()
      return
    }
    onNewSessionInWorkspace?.(null)
  }, [
    focusedGroup,
    focusedEmployeeCode,
    isEmployeesTab,
    onNewSessionInWorkspace,
    onSessionFilterChange,
    openNewEmployeeChat,
    registeredWorkspacePaths,
  ])

  /** 树形项目视图：折叠 / 展开项目组 */
  const toggleWorkspaceExpanded = useCallback(
    (workspaceKey: string) => {
      const key = String(workspaceKey || '').trim()
      if (!key) return
      setExpandedWorkspaces((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        saveExpandedWorkspaceKeys(next)
        return next
      })
      if (!expandedWorkspaces.has(key)) onWorkspaceExpand?.(key)
    },
    [expandedWorkspaces, onWorkspaceExpand],
  )

  /** 项目显示名：本地覆盖 > 后端 title > 目录 basename */
  const groupTitleFor = useCallback(
    (g: ShellWorkspaceGroup): string => {
      const nk = normalizePinKey(g.workspaceKey)
      const ov = wsTitleOverride[nk]
      if (ov !== undefined && ov !== null && String(ov).trim()) return String(ov).trim()
      const apiTitle = String((g as { title?: string | null }).title || '').trim()
      if (apiTitle) return apiTitle
      return groupLabelFor(g)
    },
    [wsTitleOverride, groupLabelFor],
  )

  /** 提交项目标题（PUT /workspaces/{key}/title） */
  const commitWorkspaceTitle = useCallback(
    async (workspaceKey: string, rawTitle: string) => {
      const key = String(workspaceKey || '').trim()
      setWorkspaceTitleEditKey('')
      if (!key) return
      const t = String(rawTitle || '').trim()
      const nk = normalizePinKey(key)
      const cur = String(wsTitleOverride[nk] ?? '').trim()
      if (t === cur) return
      setWsTitleOverride((prev) => ({ ...prev, [nk]: t || null }))
      try {
        const resp = await gogoFetch(
          `/api/chat/sessions/workspaces/${encodeURIComponent(key)}/title`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: t }),
          },
        )
        if (!resp.ok) throw new Error(await resp.text().catch(() => 'rename project failed'))
      } catch (e) {
        console.warn('[gogo] rename project failed', e)
      }
      void onRefreshSessionList()
    },
    [wsTitleOverride, onRefreshSessionList],
  )

  /** 归档项目中的对话（POST /workspaces/{key}/archive） */
  const handleArchiveWorkspace = useCallback(
    async (group: ShellWorkspaceGroup) => {
      const key = String(group.workspaceKey || '').trim()
      if (!key) return
      const label = groupTitleFor(group)
      const count = Number(group.sessionCount || 0)
      if (count <= 0) {
        await showConfirm(t('chatShell.archiveNothingHint', { label }))
        return
      }
      const yes = await showConfirm(
        t('chatShell.archiveConfirm', { label, count }),
      )
      if (!yes) return
      try {
        const resp = await gogoFetch(
          `/api/chat/sessions/workspaces/${encodeURIComponent(key)}/archive`,
          { method: 'POST' },
        )
        if (!resp.ok) throw new Error(await resp.text().catch(() => 'archive workspace failed'))
      } catch (e) {
        console.warn('[gogo] archive workspace sessions failed', e)
      }
      void onRefreshSessionList()
    },
    [groupTitleFor, onRefreshSessionList, t],
  )

  /** 拉取回收站（归档会话）列表 */
  const loadTrash = useCallback(async () => {
    try {
      const resp = await gogoFetch('/api/chat/sessions/trash')
      if (!resp.ok) throw new Error('trash list failed')
      const data = await resp.json()
      const list = Array.isArray(data?.sessions) ? data.sessions : []
      setTrashRows(
        list.map((s: any) => ({
          sessionKey: String(s?.sessionKey || ''),
          title: String(s?.title || ''),
          localWorkspaceRoot: s?.localWorkspaceRoot ? String(s.localWorkspaceRoot) : null,
          archivedAt: s?.archivedAt ? String(s.archivedAt) : null,
          messageCount: Number(s?.messageCount || 0),
        })),
      )
    } catch (e) {
      console.warn('[gogo] load trash failed', e)
    }
  }, [])

  /** 父级刷新结束（listLoading true→false）时同步回收站 */
  const prevListLoadingRef = useRef(listLoading)
  useEffect(() => {
    if (prevListLoadingRef.current && !listLoading) void loadTrash()
    prevListLoadingRef.current = listLoading
  }, [listLoading, loadTrash])

  /** 恢复归档会话到原工作区 */
  const handleRestoreTrash = useCallback(
    async (row: { sessionKey: string; title: string }) => {
      try {
        const resp = await gogoFetch(
          `/api/chat/sessions/${encodeURIComponent(row.sessionKey)}/restore`,
          { method: 'POST' },
        )
        if (!resp.ok) throw new Error(await resp.text().catch(() => 'restore failed'))
      } catch (e) {
        console.warn('[gogo] restore trash session failed', e)
      }
      void loadTrash()
      void onRefreshSessionList()
    },
    [loadTrash, onRefreshSessionList],
  )

  /** 跨项目拖拽：调用 PATCH move 接口（移动归属，不是复制）。成功后刷新列表。 */
  const handleMoveSession = useCallback(
    async (sk: string, targetRoot: string) => {
      const resp = await gogoFetch(
        `/api/chat/sessions/${encodeURIComponent(sk)}/workspace`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetWorkspaceRoot: targetRoot, rebindContext: true }),
        },
      )
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        let msg = t('chatShell.dndMoveFailed')
        try {
          const d = JSON.parse(txt)
          if (d.detail) msg = d.detail
        } catch {
          if (txt) msg = txt
        }
        throw new Error(msg)
      }
      void onRefreshSessionList()
    },
    [onRefreshSessionList, t],
  )

  const handleDndNotify = useCallback(
    (msg: string, tone: 'info' | 'error' = 'info') => {
      toast(msg, tone === 'error' ? 'error' : 'info')
    },
    [],
  )

  /** 拖拽悬停折叠项目时自动展开 */
  const handleRequestExpandGroup = useCallback(
    (key: string) => {
      setExpandedWorkspaces((prev) => {
        if (prev.has(key)) return prev
        const next = new Set(prev)
        next.add(key)
        saveExpandedWorkspaceKeys(next)
        return next
      })
      onWorkspaceExpand?.(key)
    },
    [onWorkspaceExpand],
  )

  const dnd = useSessionDnd({
    groups,
    onMoveSession: handleMoveSession,
    onRequestExpandGroup: handleRequestExpandGroup,
    onNotify: handleDndNotify,
  })

  /** 彻底删除回收站会话（不可恢复） */
  const handleTrashDelete = useCallback(
    async (row: { sessionKey: string; title: string }) => {
      const label = row.title || t('chatShell.unnamedSession')
      const yes = await showConfirm(t('chatShell.deleteForeverConfirm', { label }))
      if (!yes) return
      try {
        const resp = await gogoFetch(
          `/api/chat/sessions/${encodeURIComponent(row.sessionKey)}`,
          { method: 'DELETE' },
        )
        if (!resp.ok) throw new Error(await resp.text().catch(() => 'trash delete failed'))
      } catch (e) {
        console.warn('[gogo] trash delete failed', e)
      }
      void loadTrash()
      void onRefreshSessionList()
    },
    [loadTrash, onRefreshSessionList, t],
  )

  /** 清空回收站（不可恢复） */
  const handleEmptyTrash = useCallback(async () => {
    if (trashRows.length === 0) return
    const yes = await showConfirm(
      t('chatShell.emptyTrashConfirm', { count: trashRows.length }),
    )
    if (!yes) return
    try {
      const resp = await gogoFetch('/api/chat/sessions/trash/empty', { method: 'POST' })
      if (!resp.ok) throw new Error(await resp.text().catch(() => 'empty trash failed'))
    } catch (e) {
      console.warn('[gogo] empty trash failed', e)
    }
    setTrashQuery('')
    void loadTrash()
    void onRefreshSessionList()
  }, [trashRows.length, loadTrash, onRefreshSessionList, t])

  /** 监听侧边栏底部垃圾桶图标 → 打开回收站模态 */
  useEffect(() => {
    const onOpenTrash = () => {
      setTrashOpen(true)
      setTrashQuery('')
      void loadTrash()
    }
    window.addEventListener('gogo-open-trash', onOpenTrash)
    return () => window.removeEventListener('gogo-open-trash', onOpenTrash)
  }, [loadTrash])

  const filteredTrash = useMemo(() => {
    const q = trashQuery.trim().toLowerCase()
    if (!q) return trashRows
    return trashRows.filter((r) => (r.title || '').toLowerCase().includes(q))
  }, [trashRows, trashQuery])

  /** 「更多」按钮 / 右键 → 项目操作菜单 */
  const openWorkspaceMoreMenu = useCallback(
    (g: ShellWorkspaceGroup, e: MouseEvent) => {
      if (isSpecialWorkspaceGroupKey(g.workspaceKey)) return
      e.preventDefault()
      e.stopPropagation()
      setContextMenu(null)
      onMoreMenuClose()
      setWsMenuOpen(false)
      setWorkspaceContextMenu({
        workspaceKey: g.workspaceKey,
        x: e.clientX,
        y: e.clientY,
      })
    },
    [onMoreMenuClose],
  )

  /** 在指定项目内新建会话（绑定该项目目录） */
  const newSessionInGroup = useCallback(
    (g: ShellWorkspaceGroup) => {
      const path =
        g.workspaceKey === WORKSPACE_GROUP_UNBOUND
          ? null
          : resolveShellGroupWorkspacePath(g, registeredWorkspacePaths)
      onNewSessionInWorkspace?.(path)
    },
    [onNewSessionInWorkspace, registeredWorkspacePaths],
  )

  /** 树形项目节点：项目头（hover 新建会话 / 更多）+ 组内会话 */
  const renderWorkspaceGroupNode = (g: ShellWorkspaceGroup) => {
    const nk = normalizePinKey(g.workspaceKey)
    const expanded = expandedWorkspaces.has(g.workspaceKey)
    const title = groupTitleFor(g)
    const editing = workspaceTitleEditKey === nk
    const special = isSpecialWorkspaceGroupKey(g.workspaceKey)
    const groupActive =
      onChatRoute && g.sessions.some((r) => String(r.sessionKey || '') === displaySelectedKey)
    return (
      <DroppableGroupWrap
        key={nk}
        workspaceKey={g.workspaceKey}
        disabled={special}
        dragActive={!!dnd.activeSessionKey}
        dropDisabled={dnd.dropDisabled}
        className={`react-chat-aside-ws-group${groupActive ? ' is-active' : ''}`}
      >
        <div
          className="react-chat-aside-ws-group-header"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          title={g.path || title}
          onClick={() => toggleWorkspaceExpanded(g.workspaceKey)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleWorkspaceExpanded(g.workspaceKey)
            }
          }}
          onContextMenu={(e) => {
            if (special) return
            e.preventDefault()
            e.stopPropagation()
            setContextMenu(null)
            onMoreMenuClose()
            setWorkspaceContextMenu({
              workspaceKey: g.workspaceKey,
              x: e.clientX,
              y: e.clientY,
            })
          }}
        >
          <img className="react-chat-aside-ws-group-folder" src="/icons/folder.png" alt="" />
          {editing ? (
            <input
              className="react-chat-aside-ws-group-title-input"
              autoFocus
              defaultValue={title}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  void commitWorkspaceTitle(g.workspaceKey, (e.target as HTMLInputElement).value)
                } else if (e.key === 'Escape') {
                  setWorkspaceTitleEditKey('')
                }
              }}
              onBlur={(e) => void commitWorkspaceTitle(g.workspaceKey, e.target.value)}
            />
          ) : (
            <span className="react-chat-aside-ws-group-label">{title}</span>
          )}
          {g.sessionCount > 0 ? (
            <span className="react-chat-aside-ws-group-count">{g.sessionCount}</span>
          ) : null}
          {!special ? (
            <span
              className="react-chat-aside-ws-group-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="react-chat-aside-ws-group-action-btn"
                title={t('chatShell.newSessionInProject', { name: title })}
                aria-label={t('chatShell.newSessionInProject', { name: title })}
                onClick={() => newSessionInGroup(g)}
              >
                <ShellPlusIcon size={13} />
              </button>
              <button
                type="button"
                className="react-chat-aside-ws-group-action-btn"
                title={t('chatShell.moreActions')}
                aria-label={t('chatShell.moreActionsFor', { name: title })}
                aria-haspopup="menu"
                onClick={(e) => openWorkspaceMoreMenu(g, e)}
              >
                <ShellMoreIcon size={14} />
              </button>
            </span>
          ) : null}
        </div>
        {expanded && g.sessions.length > 0 ? (
          <ul className="react-chat-aside-ws-group-sessions">
            {g.sessions.map((row) =>
              renderSessionRow(row, { draggable: true, group: g }),
            )}
            {g.hasMoreSessions ? (
              <li className="react-chat-aside-ws-group-more">
                <button
                  type="button"
                  className="react-chat-aside-ws-group-more-btn"
                  onClick={() => onLoadMoreWorkspace?.(g.workspaceKey)}
                >
                  {g.loadingSessions ? t('chatShell.loading') : t('chatShell.loadMore')}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </DroppableGroupWrap>
    )
  }

  const newSessionHint = isEmployeesTab
    ? focusedEmployeeCode
      ? t('chatShell.newSessionInEmployee', { name: employeeFilterLabel })
      : t('chatShell.newSessionPickEmployeeFirst')
    : focusedGroup
      ? focusedGroup.workspaceKey === WORKSPACE_GROUP_UNBOUND
        ? t('chatShell.newSessionInDefaultWorkspace')
        : t('chatShell.newSessionInWorkspace', { name: groupLabelFor(focusedGroup) })
      : t('chatShell.newSessionNoFilter')

  return (
    <>
      <div className="react-chat-aside-history">
        <div className="react-chat-aside-history-head">
          <div className="react-chat-aside-segment" role="tablist" aria-label={t('chatShell.sessionTypeAria')}>
            <button
              type="button"
              role="tab"
              aria-selected={listTab === 'chats'}
              className={`react-chat-aside-segment-btn${listTab === 'chats' ? ' is-active' : ''}`}
              onClick={() => setListTab('chats')}
            >
              {t('chatShell.segmentChats')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={listTab === 'employees'}
              className={`react-chat-aside-segment-btn${listTab === 'employees' ? ' is-active' : ''}`}
              onClick={() => {
                setListTab('employees')
                setFocusedWorkspaceKey(null)
                setWsMenuOpen(false)
              }}
            >
              {t('chatShell.segmentEmployees')}
            </button>
          </div>
          <div className="react-chat-aside-history-actions">
            <button
              type="button"
              className={`react-chat-aside-history-icon-btn${refreshing ? ' is-refreshing' : ''}`}
              title={refreshing ? t('chatShell.refreshing') : t('chatShell.refreshSessions')}
              aria-label={refreshing ? t('chatShell.refreshing') : t('chatShell.refreshSessions')}
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true)
                setFilterOpen(false)
                void Promise.resolve(onRefreshSessionList())
                  .catch(() => {
                    /* 刷新失败也结束刷新态，避免按钮卡死 */
                  })
                  .finally(() => {
                    setRefreshing(false)
                  })
              }}
            >
              <ShellRefreshIcon size={15} />
            </button>
            <button
              type="button"
              className={`react-chat-aside-history-icon-btn${filterOpen ? ' is-active' : ''}`}
              title={t('chatShell.searchSessions')}
              aria-label={t('chatShell.searchSessions')}
              aria-pressed={filterOpen}
              onClick={() => {
                setFilterOpen((v) => {
                  const next = !v
                  if (!next) onSessionFilterChange('')
                  return next
                })
              }}
            >
              <ShellSearchIcon size={15} />
            </button>
            <button
              type="button"
              className="react-chat-aside-history-icon-btn"
              title={newSessionHint}
              aria-label={newSessionHint}
              onClick={handleNewSessionClick}
            >
              <ShellPlusIcon size={15} />
            </button>
          </div>
          <div className="react-chat-aside-history-search-wrap" hidden={!filterOpen}>
            <input
              ref={filterInputRef}
              type="search"
              className="react-chat-aside-history-search"
              id="shell-session-filter"
              placeholder={
                isEmployeesTab
                  ? t('chatShell.searchEmployeeSessionsPlaceholder')
                  : t('chatShell.searchSessionsPlaceholder')
              }
              aria-label={
                isEmployeesTab
                  ? t('chatShell.searchEmployeeSessions')
                  : t('chatShell.searchSessions')
              }
              value={sessionFilter || ''}
              onChange={(e) => onSessionFilterChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilterOpen(false)
                  onSessionFilterChange('')
                }
              }}
            />
          </div>
        </div>

        {!isEmployeesTab ? (
          <div className="react-chat-aside-ws-picker" ref={wsMenuRef}>
            <button
              type="button"
              className={`react-chat-aside-ws-trigger${wsMenuOpen ? ' is-open' : ''}${focusedWorkspaceKey ? ' has-filter' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={wsMenuOpen}
              title={focusedGroup?.path || workspaceFilterLabel}
              onClick={() => setWsMenuOpen((v) => !v)}
            >
              <ShellWorkspaceIcon size={14} className="react-chat-aside-ws-trigger-ic" />
              <span className="react-chat-aside-ws-trigger-label">{workspaceFilterLabel}</span>
              <ShellChevronIcon
                size={12}
                className={`react-chat-aside-ws-trigger-chevron${wsMenuOpen ? ' is-open' : ''}`}
              />
            </button>
            {wsMenuOpen ? (
              <div className="react-chat-aside-ws-menu" role="listbox" aria-label={t('chatShell.selectWorkspaceAria')}>
                {onNewWorkspace ? (
                  <button
                    type="button"
                    className="react-chat-aside-ws-menu-item react-chat-aside-ws-menu-item--add"
                    onClick={() => {
                      setWsMenuOpen(false)
                      onNewWorkspace()
                    }}
                  >
                    <ShellFolderPlusIcon size={14} />
                    <span className="react-chat-aside-ws-menu-item-label">{t('chatShell.addWorkspace')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={!focusedWorkspaceKey}
                  className={`react-chat-aside-ws-menu-item${!focusedWorkspaceKey ? ' is-active' : ''}`}
                  onClick={() => selectWorkspaceFilter(null)}
                >
                  <span className="react-chat-aside-ws-menu-item-label">{t('chatShell.allWorkspaces')}</span>
                </button>
                {workspaceFilterOptions.map((g) => {
                  const active =
                    !!focusedWorkspaceKey &&
                    normalizePinKey(focusedWorkspaceKey) === normalizePinKey(g.workspaceKey)
                  return (
                    <button
                      key={g.workspaceKey}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`react-chat-aside-ws-menu-item${active ? ' is-active' : ''}`}
                      title={g.path || groupLabelFor(g)}
                      onClick={() => selectWorkspaceFilter(g)}
                      onContextMenu={(e) => {
                        if (isSpecialWorkspaceGroupKey(g.workspaceKey)) return
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu(null)
                        onMoreMenuClose()
                        setWsMenuOpen(false)
                        setWorkspaceContextMenu({
                          workspaceKey: g.workspaceKey,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }}
                    >
                      <span className="react-chat-aside-ws-menu-item-label">{groupLabelFor(g)}</span>
                      {g.sessionCount > 0 ? (
                        <span className="react-chat-aside-ws-menu-item-count">{g.sessionCount}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="react-chat-aside-ws-picker" ref={empMenuRef}>
            <button
              type="button"
              className={`react-chat-aside-ws-trigger${empMenuOpen ? ' is-open' : ''}${focusedEmployeeCode ? ' has-filter' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={empMenuOpen}
              title={focusedEmployeeGroup?.agentCode || employeeFilterLabel}
              onClick={() => setEmpMenuOpen((v) => !v)}
            >
              {focusedEmployeeCode ? (
                <AssignedAgentAvatar
                  agentCode={focusedEmployeeCode}
                  agents={agents}
                  size={16}
                  className="react-chat-aside-ws-trigger-ic"
                />
              ) : (
                <ShellWorkspaceIcon size={14} className="react-chat-aside-ws-trigger-ic" />
              )}
              <span className="react-chat-aside-ws-trigger-label">{employeeFilterLabel}</span>
              <ShellChevronIcon
                size={12}
                className={`react-chat-aside-ws-trigger-chevron${empMenuOpen ? ' is-open' : ''}`}
              />
            </button>
            {empMenuOpen ? (
              <div className="react-chat-aside-ws-menu" role="listbox" aria-label={t('chatShell.selectEmployeeAria')}>
                <button
                  type="button"
                  role="option"
                  aria-selected={!focusedEmployeeCode}
                  className={`react-chat-aside-ws-menu-item${!focusedEmployeeCode ? ' is-active' : ''}`}
                  onClick={() => selectEmployeeFilter(null)}
                >
                  <span className="react-chat-aside-ws-menu-item-label">{t('chatShell.allEmployees')}</span>
                </button>
                {employeeGroups.map((g) => {
                  const active =
                    !!focusedEmployeeCode &&
                    focusedEmployeeCode.toLowerCase() === g.agentCode.toLowerCase()
                  return (
                    <button
                      key={g.agentCode}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`react-chat-aside-ws-menu-item${active ? ' is-active' : ''}`}
                      title={g.agentCode}
                      onClick={() => selectEmployeeFilter(g.agentCode)}
                    >
                      <AssignedAgentAvatar
                        agentCode={g.agentCode}
                        agents={agents}
                        size={16}
                        className="react-chat-aside-ws-menu-item-avatar"
                      />
                      <span className="react-chat-aside-ws-menu-item-label">{g.label}</span>
                      {g.sessions.length > 0 ? (
                        <span className="react-chat-aside-ws-menu-item-count">{g.sessions.length}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )}

        <DndContext
          sensors={dnd.sensors}
          collisionDetection={dnd.collisionDetection}
          onDragStart={dnd.handleDragStart}
          onDragOver={dnd.handleDragOver}
          onDragEnd={dnd.handleDragEnd}
          onDragCancel={dnd.handleDragCancel}
        >
        <ul ref={listRef} className="react-chat-session-list" id="shell-session-list">
          {listLoading ? (
            <li className="react-chat-muted" style={{ padding: '10px 12px' }}>
              {t('chatShell.loading')}
            </li>
          ) : null}

          {!listLoading && !isEmployeesTab && !focusedWorkspaceKey && !isSearching ? (
            groups.length === 0 ? (
              <li className="react-chat-muted" style={{ padding: '10px 12px' }}>
                {t('chatShell.noSessions')}
              </li>
            ) : (
              groups.map((g) => renderWorkspaceGroupNode(g))
            )
          ) : (
            <>
              {!listLoading &&
              pinnedRows.length === 0 &&
              recentVisibleRows.length === 0 &&
              !showDutyFold ? (
                <li className="react-chat-muted" style={{ padding: '10px 12px' }}>
                  {isEmployeesTab
                    ? isSearching
                      ? t('chatShell.noMatchedSessions')
                      : focusedEmployeeCode
                        ? t('chatShell.employeeNoSessions')
                        : (effectiveEmployeeRoles || []).length > 0
                          ? t('chatShell.noEmployeeSessions')
                          : t('chatShell.noHiredEmployees')
                    : focusedWorkspaceKey
                      ? t('chatShell.workspaceNoSessions')
                      : isSearching
                        ? t('chatShell.noMatchedSessions')
                        : t('chatShell.noSessions')}
                </li>
              ) : null}

              {!listLoading && pinnedRows.length > 0 ? (
                <li className="react-chat-session-pinned-block" aria-label={t('chatShell.pinnedSectionAria')}>
                  <ul className="react-chat-session-pinned-list">
                    {pinnedRows.map((row) => renderSessionRow(row))}
                  </ul>
                </li>
              ) : null}

              {!listLoading &&
              (recentVisibleRows.length > 0 || showDutyFold || flatHasMore || flatLoading) ? (
                <li
                  className="react-chat-session-recent-block"
                  aria-label={isEmployeesTab ? t('chatShell.segmentEmployees') : t('chatShell.segmentChats')}
                >
                  <ul className="react-chat-session-recent-list">
                    {recentVisibleRows.map((row) => renderSessionRow(row))}
                    {showDutyFold ? (
                      <li className="react-chat-session-duty-fold">
                        <button
                          type="button"
                          className={`react-chat-session-duty-fold-btn${dutyFoldOpen ? ' is-open' : ''}`}
                          aria-expanded={dutyFoldOpen}
                          onClick={() => setDutyFoldOpen((v) => !v)}
                        >
                          <ShellChevronIcon
                            size={12}
                            className={`react-chat-session-duty-fold-chevron${dutyFoldOpen ? ' is-open' : ''}`}
                          />
                          <span>
                            {dutyFoldOpen
                              ? t('chatShell.dutyFoldCollapse')
                              : t('chatShell.dutyFoldCount', { count: foldedDutyRows.length })}
                          </span>
                        </button>
                      </li>
                    ) : null}
                    {showDutyFold && dutyFoldOpen
                      ? foldedDutyRows.map((row) => renderSessionRow(row))
                      : null}
                    {flatLoading && !flatHasMore ? (
                      <li className="react-chat-muted react-chat-session-workspace-loading">
                        {t('chatShell.loading')}
                      </li>
                    ) : null}
                    {flatHasMore ? (
                      <li
                        className="react-chat-session-workspace-load-more-sentinel"
                        data-load-more-sentinel=""
                        data-workspace-key={
                          isEmployeesTab
                            ? WORKSPACE_GROUP_PROACTIVE
                            : focusedWorkspaceKey
                              ? focusedGroup?.workspaceKey || focusedWorkspaceKey
                              : '__global__'
                        }
                      >
                        {flatLoading ? (
                          <span className="react-chat-session-workspace-load-spinner" />
                        ) : null}
                      </li>
                    ) : null}
                  </ul>
                </li>
              ) : null}
            </>
          )}
        </ul>
        <DragOverlay dropAnimation={null}>
          {dnd.activeSessionRow ? (
            <div className="react-chat-drag-overlay">
              <span className="react-chat-drag-overlay-title">
                {clipSidebarSessionTitle(dnd.activeSessionRow.title || t('chatShell.newSessionTitle'))}
              </span>
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>

        {/* 回收站模态（由侧边栏底部垃圾桶图标触发打开，portal 到 body 避免穿透） */}
        {trashOpen
          ? createPortal(
              <div
                className="react-chat-trash-modal-overlay"
                onClick={() => {
                  setTrashOpen(false)
                  setTrashQuery('')
                }}
              >
                <div className="react-chat-trash-modal" onClick={(e) => e.stopPropagation()}>
                <div className="react-chat-trash-modal-header">
                  <div>
                    <h3>{t('chatShell.trashTitle')}</h3>
                    <p>{t('chatShell.trashSubtitle')}</p>
                  </div>
                  <button
                    type="button"
                    className="react-chat-trash-modal-close"
                    aria-label={t('chatShell.closeAria')}
                    onClick={() => {
                      setTrashOpen(false)
                      setTrashQuery('')
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="react-chat-trash-modal-toolbar">
                  <input
                    type="search"
                    className="react-chat-trash-search"
                    placeholder={t('chatShell.searchSessionsPlaceholder')}
                    value={trashQuery}
                    onChange={(e) => setTrashQuery(e.target.value)}
                  />
                  <button
                    type="button"
                    className="react-chat-trash-tool-btn"
                    onClick={() => void loadTrash()}
                  >
                    {t('chatShell.refresh')}
                  </button>
                  <button
                    type="button"
                    className="react-chat-trash-tool-btn is-danger"
                    disabled={trashRows.length === 0}
                    onClick={() => void handleEmptyTrash()}
                  >
                    {t('chatShell.emptyTrash')}
                  </button>
                </div>
                <div className="react-chat-trash-modal-body">
                  {filteredTrash.length > 0 ? (
                    <ul className="react-chat-trash-list">
                      {filteredTrash.map((row) => (
                        <li className="react-chat-trash-item" key={row.sessionKey}>
                          <div className="react-chat-trash-item-body">
                            <span
                              className="react-chat-trash-item-title"
                              title={row.title || t('chatShell.unnamedSession')}
                            >
                              {row.title || t('chatShell.unnamedSession')}
                            </span>
                            <span className="react-chat-trash-item-meta">
                              {row.localWorkspaceRoot
                                ? formatWorkspaceGroupLabel(row.localWorkspaceRoot)
                                : t('chatShell.originalWorkspace')}
                              {' · '}
                              {row.archivedAt
                                ? t('chatShell.archivedAt', {
                                    time: String(row.archivedAt).replace('T', ' ').slice(0, 16),
                                  })
                                : t('chatShell.archivedUnknown')}
                            </span>
                          </div>
                          <div className="react-chat-trash-item-actions">
                            <button
                              type="button"
                              className="react-chat-trash-btn is-restore"
                              onClick={() => void handleRestoreTrash(row)}
                            >
                              {t('chatShell.restore')}
                            </button>
                            <button
                              type="button"
                              className="react-chat-trash-btn is-delete"
                              onClick={() => void handleTrashDelete(row)}
                            >
                              {t('chatShell.deleteForever')}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="react-chat-trash-empty-state">
                      <div className="react-chat-trash-empty-icon">🗑</div>
                      <p>{t('chatShell.trashEmpty')}</p>
                      <p className="react-chat-trash-empty-hint">
                        {t('chatShell.trashEmptyHint')}
                      </p>
                    </div>
                  )}
                </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>

      <SessionContextMenuPortal
        menu={contextMenu}
        row={contextRow}
        onClose={() => setContextMenu(null)}
        onAction={(action) => {
          if (contextMenu) runMenuAction(action, contextMenu.sessionKey)
        }}
      />
      <WorkspaceFolderContextMenuPortal
        menu={workspaceContextMenu}
        group={workspaceContextGroup}
        canOpenFolder={
          !!(
            workspaceContextGroup &&
            (resolveShellGroupWorkspacePath(workspaceContextGroup, registeredWorkspacePaths) ||
              workspaceContextGroup.workspaceKey === WORKSPACE_GROUP_UNBOUND)
          )
        }
        canPin={
          !!(
            workspaceContextGroup &&
            !isSpecialWorkspaceGroupKey(workspaceContextGroup.workspaceKey)
          )
        }
        isPinned={
          !!(
            workspaceContextGroup &&
            pinnedWorkspaceKeySet.has(normalizePinKey(workspaceContextGroup.workspaceKey))
          )
        }
        canFocus={
          !!(
            workspaceContextGroup &&
            !isSpecialWorkspaceGroupKey(workspaceContextGroup.workspaceKey)
          )
        }
        onClose={() => setWorkspaceContextMenu(null)}
        onOpenFolder={() => {
          const g = workspaceContextGroup
          setWorkspaceContextMenu(null)
          if (g) void onOpenWorkspaceFolder?.(g)
        }}
        onTogglePin={() => {
          const g = workspaceContextGroup
          setWorkspaceContextMenu(null)
          if (g) toggleWorkspacePinned(g.workspaceKey)
        }}
        onFocusOnly={() => {
          const g = workspaceContextGroup
          setWorkspaceContextMenu(null)
          if (g) applyWorkspaceFocusFilter(g)
        }}
        onDelete={() => {
          const g = workspaceContextGroup
          setWorkspaceContextMenu(null)
          if (g) {
            const nk = normalizePinKey(g.workspaceKey)
            setPinnedWorkspaceKeys((prev) => {
              const next = prev.filter((k) => normalizePinKey(k) !== nk)
              savePinnedWorkspaceKeys(next)
              return next
            })
            if (focusedWorkspaceKey && normalizePinKey(focusedWorkspaceKey) === nk) {
              setFocusedWorkspaceKey(null)
            }
            void onDeleteWorkspace?.(g)
          }
        }}
        onEditTitle={() => {
          const g = workspaceContextGroup
          setWorkspaceContextMenu(null)
          if (g) setWorkspaceTitleEditKey(normalizePinKey(g.workspaceKey))
        }}
        onArchive={() => {
          const g = workspaceContextGroup
          setWorkspaceContextMenu(null)
          if (g) void handleArchiveWorkspace(g)
        }}
      />
    </>
  )
}
