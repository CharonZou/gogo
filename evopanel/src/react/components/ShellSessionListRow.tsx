import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { formatRunningPreviewLine } from '../lib/session-list/build-shell-rows.js'
import { positionMenuAboveAnchor, positionMenuAbovePoint } from '../lib/session-list/menu-position.js'
import type { ShellSidebarSyncRow } from '../lib/session-list/types.js'
import type { ResolvedLiveStreamActivity } from '../lib/resolve-live-stream-activity.js'
import type { RunningSessionSummary } from '../hooks/useRunningSessionSummaries.js'
import { useShellSessionRunningPreview } from '../hooks/useShellSessionRunningPreview.js'
import { isProactiveSessionKey, proactiveAgentCodeFromSessionKey } from '../lib/session-list/workspace-groups.js'
import { AssignedAgentAvatar } from './AssignedAgentAvatar.js'
import {
  ShellLoaderIcon,
  ShellPinIcon,
  ShellSessionIcon,
} from './ShellSidebarIcons.js'
import { resolveAssignedAgentDisplayName } from '../../lib/tool-display.js'
import { useT } from '../lib/useI18n'

type SessionContextMenuState = {
  sessionKey: string
  x: number
  y: number
}

type ShellSessionListRowProps = {
  row: ShellSidebarSyncRow
  active: boolean
  moreOpen: boolean
  editingTitle: boolean
  /** ``/api/agents`` 列表，供员工会话行解析岗位头像 */
  agents?: unknown[] | null
  /** 雇佣花名册，agents 未命中时用于显示员工名 */
  employeeRoles?: Array<{
    agent_code: string
    role_name: string
    agent_name?: string
  }> | null
  runningSummary?: RunningSessionSummary | null
  resolveLiveStreamActivity?: (
    sessionKey: string,
    isSelectedRow: boolean,
  ) => ResolvedLiveStreamActivity | null
  /** chat=普通对话；employee=员工对话（单行，标题为员工名） */
  variant?: 'chat' | 'employee'
  onSelect: () => void
  onMoreToggle: () => void
  onRefresh: () => void
  onMenuAction: (action: 'pin' | 'rename' | 'stop' | 'delete' | 'delete-hard' | 'fork' | 'refresh') => void
  onTitleCommit: (title: string) => void
  onTitleCancel: () => void
  onStartTitleEdit: () => void
  onContextMenu: (x: number, y: number) => void
  onPinnedReorder: (dragKey: string, dropKey: string) => void
  /** Hover prefetch: warm idle runtime cache before click. */
  onPrefetch?: () => void
  /** DnD: when set (to the session DnD id), this row is a draggable source. */
  draggableId?: string
}

function normalizeAgentCodeKey(code: string): string {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
}

/** 侧栏会话标题：输入/落库上限 */
export const SIDEBAR_SESSION_TITLE_INPUT_MAX = 30

export function clipSidebarSessionTitle(
  text: string,
  max = SIDEBAR_SESSION_TITLE_INPUT_MAX,
): string {
  const chars = Array.from(String(text || '').trim())
  if (chars.length <= max) return chars.join('')
  return chars.slice(0, max).join('')
}

/** 侧栏员工行：只显示智能体名，不用岗位名 */
function resolveEmployeeName(
  t: (key: string) => string,
  agentCode: string,
  agents: unknown[] | null | undefined,
  fallbackTitle: string,
  roles?: Array<{ agent_code: string; role_name: string; agent_name?: string }> | null,
): string {
  const code = String(agentCode || '').trim()
  const fromAgents = resolveAssignedAgentDisplayName(code, agents)
  if (fromAgents && fromAgents !== code) return fromAgents

  const role = (roles || []).find(
    (r) => normalizeAgentCodeKey(r.agent_code) === normalizeAgentCodeKey(code),
  )
  const fromRoleAgent = String(role?.agent_name || '').trim()
  if (fromRoleAgent) return fromRoleAgent

  // role_name 在 proactiveRolesDisplay 里可能已被替换为 agent_name；仅当与 code 不同且不像岗位兜底时使用
  // 仍优先 code，避免把「前端架构负责人」这类岗位名当做人名
  if (code) return code
  return fallbackTitle || t('chatShell.groupEmployees')
}

function eventTargetElement(ev: Event): Element | null {
  const t = ev.target
  if (t instanceof Element) return t
  if (t && typeof (t as Node).parentElement !== 'undefined') {
    return (t as Node).parentElement
  }
  return null
}

function MoreMenu({
  row,
  open,
  anchorRef,
  onAction,
}: {
  row: ShellSidebarSyncRow
  open: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  onAction: (action: 'pin' | 'rename' | 'stop' | 'delete' | 'delete-hard' | 'fork' | 'refresh') => void
}) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const activateOnceRef = useRef(false)

  useLayoutEffect(() => {
    if (!open) {
      // Defer state update to avoid cascading renders
      requestAnimationFrame(() => {
        setPos(null)
      })
      return
    }
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return
    const rect = anchor.getBoundingClientRect()
    setPos(
      positionMenuAboveAnchor(rect, menu.offsetWidth, menu.offsetHeight, { gap: 6, preferAbove: true }),
    )
  }, [open, anchorRef, row.isPinned, row.executing])

  if (!open) return null
  const pinLabel = row.isPinned ? t('chatShell.sessionUnpin') : t('chatShell.sessionPin')
  const bindMenuItem = (action: 'pin' | 'rename' | 'stop' | 'delete' | 'delete-hard' | 'fork' | 'refresh') => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation?.()
      if (activateOnceRef.current) return
      activateOnceRef.current = true
      onAction(action)
      window.setTimeout(() => { activateOnceRef.current = false }, 0)
    },
    onClick: (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation?.()
      if (activateOnceRef.current) return
      activateOnceRef.current = true
      onAction(action)
      window.setTimeout(() => { activateOnceRef.current = false }, 0)
    },
  })

  const menu = (
    <div
      ref={menuRef}
      className="react-chat-session-more-menu react-chat-session-more-menu--portal"
      role="menu"
      style={
        pos
          ? { position: 'fixed', left: pos.left, top: pos.top, zIndex: 12000, visibility: 'visible' }
          : { position: 'fixed', left: -9999, top: 0, visibility: 'hidden' }
      }
    >
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('pin')}>
        {pinLabel}
      </button>
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('rename')}>
        {t('chatShell.sessionRename')}
      </button>
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('fork')}>
        {t('chatShell.sessionFork')}
      </button>
      {row.executing ? (
        <button
          type="button"
          className="react-chat-session-more-item react-chat-session-more-item--warning"
          {...bindMenuItem('stop')}
        >
          {t('chatShell.sessionStop')}
        </button>
      ) : null}
      {row.canDelete !== false ? (
        <button
          type="button"
          className="react-chat-session-more-item react-chat-session-more-item--danger"
          {...bindMenuItem('delete')}
        >
          {t('chatShell.sessionArchive')}
        </button>
      ) : null}
      <button
        type="button"
        className="react-chat-session-more-item react-chat-session-more-item--danger"
        title={t('chatShell.sessionDeleteHardTitle')}
        {...bindMenuItem('delete-hard')}
      >
        {t('chatShell.sessionDeleteLabel')}
      </button>
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('refresh')}>
        {t('chatShell.refresh')}
      </button>
    </div>
  )

  return createPortal(menu, document.body)
}

function ShellSessionListRowInner({
  row,
  active,
  moreOpen,
  editingTitle,
  agents = null,
  employeeRoles = null,
  runningSummary,
  resolveLiveStreamActivity,
  variant = 'chat',
  onSelect,
  onMoreToggle,
  onRefresh: _onRefresh,
  onMenuAction,
  onTitleCommit,
  onTitleCancel,
  onStartTitleEdit,
  onContextMenu,
  onPinnedReorder,
  onPrefetch,
  draggableId,
}: ShellSessionListRowProps) {
  const t = useT()
  const sessionKey = String(row.sessionKey || '')
  const proactiveAgentCode = isProactiveSessionKey(sessionKey)
    ? proactiveAgentCodeFromSessionKey(sessionKey)
    : ''
  /** 仅「员工」变体用员工名当标题；会话行与普通对话一致用 row.title */
  const useEmployeeTitle = variant === 'employee'
  const employeeName = useEmployeeTitle
    ? resolveEmployeeName(t, proactiveAgentCode, agents, row.title, employeeRoles)
    : ''
  const [titleDraft, setTitleDraft] = useState(row.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ key: string; dragging: boolean; startY: number } | null>(null)
  const suppressClickRef = useRef(false)

  /** DnD source: registered with DndContext when draggableId is provided. */
  const isDraggable = !!draggableId
  const {
    attributes: dndAttributes,
    listeners: dndListeners,
    setNodeRef: setDndNodeRef,
    transform: dndTransform,
    isDragging,
  } = useDraggable({
    id: draggableId || `not-draggable:${sessionKey}`,
    disabled: !isDraggable,
  })
  const dndStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(dndTransform),
    opacity: isDragging ? 0.35 : 1,
  }

  useEffect(() => {
    if (!editingTitle) return
    // Defer state update to avoid cascading renders
    requestAnimationFrame(() => {
      setTitleDraft(clipSidebarSessionTitle(row.title))
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    })
  }, [editingTitle, row.title])

  const resolveActivity =
    resolveLiveStreamActivity ||
    ((_sk: string, _sel: boolean) => null as ResolvedLiveStreamActivity | null)
  const livePreview = useShellSessionRunningPreview({
    sessionKey,
    executing: !!row.executing,
    isSelectedRow: active,
    staticPreviewLine: row.runningPreviewLine,
    runningSummary,
    resolveLiveStreamActivity: resolveActivity,
  })
  const preview = formatRunningPreviewLine({ ...row, runningPreviewLine: livePreview })
  const isPinned = !!row.isPinned
  const unseen = !!row.hasUnseenRunningUpdate && !active

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onSelect()
  }

  const handleTitleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onTitleCommit(titleDraft)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onTitleCancel()
    }
  }

  const handlePinnedPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const host = e.currentTarget.closest('[data-shell-session]') as HTMLDivElement | null
    if (!host) return
    dragRef.current = { key: sessionKey, dragging: false, startY: e.clientY }
    host.classList.add('react-chat-history-item--dragging')

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (Math.abs(ev.clientY - drag.startY) > 5) drag.dragging = true
      document.querySelectorAll('.react-chat-history-item--drag-over').forEach((n) => {
        n.classList.remove('react-chat-history-item--drag-over')
      })
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
      const target = under?.closest?.('[data-shell-session].react-chat-history-item--pinned')
      if (target && target !== host) target.classList.add('react-chat-history-item--drag-over')
    }

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      host.classList.remove('react-chat-history-item--dragging')
      document.querySelectorAll('.react-chat-history-item--drag-over').forEach((n) => {
        n.classList.remove('react-chat-history-item--drag-over')
      })
      const drag = dragRef.current
      dragRef.current = null
      if (!drag?.dragging) return
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
      const target = under?.closest?.('[data-shell-session].react-chat-history-item--pinned') as HTMLElement | null
      const dropKey = String(target?.dataset?.shellSession || '').trim()
      if (dropKey && dropKey !== sessionKey) {
        onPinnedReorder(sessionKey, dropKey)
        suppressClickRef.current = true
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  return (
    <li
      ref={setDndNodeRef}
      style={isDraggable ? dndStyle : undefined}
      className={`react-chat-session-list-item${isPinned ? ' react-chat-session-list-item--pinned' : ''}${useEmployeeTitle ? ' is-employee' : ' is-chat'}${isDragging ? ' is-dragging' : ''}`}
      data-session-pinned={isPinned ? '1' : '0'}
      {...(isDraggable ? dndAttributes : {})}
      {...(isDraggable ? dndListeners : {})}
    >
      <div
        className={[
          'react-chat-history-item',
          useEmployeeTitle ? 'react-chat-history-item--employee' : 'react-chat-history-item--chat',
          active ? 'active' : '',
          moreOpen ? 'session-menu-open' : '',
          isPinned ? 'react-chat-history-item--pinned' : '',
          unseen ? 'react-chat-history-item--unseen' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="button"
        tabIndex={0}
        data-shell-session={sessionKey}
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          if (
            (e.target as HTMLElement).closest(
              '[data-shell-more-btn], .react-chat-session-more-menu, .react-chat-history-item-title-edit, .react-chat-session-refresh-btn',
            )
          ) {
            return
          }
          onSelect()
        }}
        onKeyDown={handleKeyDown}
        onDoubleClick={(e) => {
          const titleEl = (e.target as HTMLElement).closest('.react-chat-history-item-title')
          if (!titleEl) return
          e.preventDefault()
          e.stopPropagation()
          onStartTitleEdit()
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-shell-more-btn], .react-chat-session-more-menu')) return
          e.preventDefault()
          onContextMenu(e.clientX, e.clientY)
        }}
        onMouseEnter={() => {
          if (!active) onPrefetch?.()
        }}
        onPointerDown={(e) => {
          // Start warm before click selection / history effect — covers fast clicks with no hover dwell.
          if (e.button === 0 && !active) onPrefetch?.()
        }}
      >
        {isPinned ? (
          <span
            className="react-chat-session-pin-badge"
            title={t('chatShell.pinnedDragHint')}
            aria-hidden="true"
            onPointerDown={handlePinnedPointerDown}
          >
            <ShellPinIcon size={12} />
          </span>
        ) : null}

        {useEmployeeTitle || row.executing ? (
          <span
            className={`react-chat-session-type-ic${active ? ' is-active' : ''}${row.executing ? ' is-running' : ''}${useEmployeeTitle && proactiveAgentCode ? ' react-chat-session-type-ic--avatar' : ''}`}
            aria-hidden="true"
          >
            {row.executing ? (
              <ShellLoaderIcon size={16} className="react-chat-session-spinner-ic" />
            ) : useEmployeeTitle && proactiveAgentCode ? (
              <AssignedAgentAvatar
                agentCode={proactiveAgentCode}
                agents={agents}
                size={20}
                className="react-chat-session-agent-avatar"
              />
            ) : (
              <ShellSessionIcon size={14} />
            )}
          </span>
        ) : null}

        {editingTitle ? (
          <div className="react-chat-history-item-title-edit" data-shell-title-edit={sessionKey}>
            <input
              ref={inputRef}
              type="text"
              className="react-chat-history-item-title-input"
              value={titleDraft}
              maxLength={SIDEBAR_SESSION_TITLE_INPUT_MAX}
              aria-label={t('chatShell.sessionTitleInputAria')}
              onChange={(ev) => setTitleDraft(ev.target.value)}
              onKeyDown={handleTitleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="react-chat-history-item-title-actions" role="group" aria-label={t('chatShell.titleEditAria')}>
              <button
                type="button"
                className="react-chat-title-edit-btn react-chat-title-edit-btn--ok"
                title={t('chatShell.saveLabel')}
                aria-label={t('chatShell.saveLabel')}
                onClick={(e) => {
                  e.stopPropagation()
                  onTitleCommit(titleDraft)
                }}
              >
                ✓
              </button>
              <button
                type="button"
                className="react-chat-title-edit-btn react-chat-title-edit-btn--cancel"
                title={t('chatShell.cancelLabel')}
                aria-label={t('chatShell.cancelLabel')}
                onClick={(e) => {
                  e.stopPropagation()
                  onTitleCancel()
                }}
              >
                ×
              </button>
            </span>
          </div>
        ) : useEmployeeTitle ? (
          <div className="react-chat-history-item-text react-chat-history-item-text--chat">
            <span className="react-chat-history-item-title" title={employeeName}>
              {employeeName}
            </span>
          </div>
        ) : (
          <div className="react-chat-history-item-text react-chat-history-item-text--chat">
            <span className="react-chat-history-item-title" title={row.title}>
              {row.title}
            </span>
          </div>
        )}

        <div
          className={`react-chat-history-item-trailing${useEmployeeTitle ? ' react-chat-history-item-trailing--employee' : ''}`}
        >
          {!editingTitle && (preview || row.time) ? (
            <span
              className={`react-chat-history-item-meta${preview ? ' is-live' : ''}`}
              title={row.title || row.time || ''}
            >
              {preview || row.time}
            </span>
          ) : null}
          <div className="react-chat-session-more-wrap" data-session-more-root>
            <button
              type="button"
              className="react-chat-session-more-btn"
              ref={moreBtnRef}
              data-shell-more-btn={sessionKey}
              aria-expanded={moreOpen ? 'true' : 'false'}
              aria-label={t('chatShell.sessionMoreAria')}
              title={t('chatShell.moreActionsTitle')}
              onClick={(e) => {
                e.stopPropagation()
                onMoreToggle()
              }}
            >
              ···
            </button>
            <MoreMenu row={row} open={moreOpen} anchorRef={moreBtnRef} onAction={onMenuAction} />
          </div>
        </div>
      </div>
    </li>
  )
}

export function SessionContextMenuPortal({
  menu,
  row,
  onClose,
  onAction,
}: {
  menu: SessionContextMenuState | null
  row: ShellSidebarSyncRow | null
  onClose: () => void
  onAction: (action: 'pin' | 'rename' | 'stop' | 'delete' | 'delete-hard' | 'fork' | 'refresh') => void
}) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const activateOnceRef = useRef(false)

  useEffect(() => {
    if (!menu) return
    const onDocClick = (e: Event) => {
      const el = eventTargetElement(e)
      if (!el?.closest('.react-chat-session-context-menu')) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) {
      setPos(null)
      return
    }
    const el = menuRef.current
    setPos(
      positionMenuAbovePoint(menu.x, menu.y, el.offsetWidth, el.offsetHeight, { gap: 6 }),
    )
  }, [menu, row?.isPinned, row?.executing])

  if (!menu || !row) return null
  const pinLabel = row.isPinned ? t('chatShell.sessionUnpin') : t('chatShell.sessionPin')
  const bindMenuItem = (action: 'pin' | 'rename' | 'stop' | 'delete' | 'delete-hard' | 'fork' | 'refresh') => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation?.()
      if (activateOnceRef.current) return
      activateOnceRef.current = true
      onAction(action)
      window.setTimeout(() => { activateOnceRef.current = false }, 0)
    },
    onClick: (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation?.()
      if (activateOnceRef.current) return
      activateOnceRef.current = true
      onAction(action)
      window.setTimeout(() => { activateOnceRef.current = false }, 0)
    },
  })

  return createPortal(
    <div
      ref={menuRef}
      className="react-chat-session-context-menu"
      role="menu"
      style={
        pos
          ? { position: 'fixed', left: pos.left, top: pos.top, zIndex: 12000, visibility: 'visible' }
          : { position: 'fixed', left: menu.x, top: menu.y, visibility: 'hidden' }
      }
    >
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('pin')}>
        {pinLabel}
      </button>
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('rename')}>
        {t('chatShell.sessionRename')}
      </button>
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('fork')}>
        {t('chatShell.sessionFork')}
      </button>
      {row.executing ? (
        <button
          type="button"
          className="react-chat-session-more-item react-chat-session-more-item--warning"
          {...bindMenuItem('stop')}
        >
          {t('chatShell.sessionStop')}
        </button>
      ) : null}
      {row.canDelete !== false ? (
        <button
          type="button"
          className="react-chat-session-more-item react-chat-session-more-item--danger"
          {...bindMenuItem('delete')}
        >
          {t('chatShell.sessionArchive')}
        </button>
      ) : null}
      <button
        type="button"
        className="react-chat-session-more-item react-chat-session-more-item--danger"
        title={t('chatShell.sessionDeleteHardTitle')}
        {...bindMenuItem('delete-hard')}
      >
        {t('chatShell.sessionDeleteLabel')}
      </button>
      <button type="button" className="react-chat-session-more-item" {...bindMenuItem('refresh')}>
        {t('chatShell.refresh')}
      </button>
    </div>,
    document.body,
  )
}

export const ShellSessionListRow = memo(ShellSessionListRowInner)
