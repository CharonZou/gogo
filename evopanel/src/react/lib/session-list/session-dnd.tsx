/**
 * Cross-project session drag & drop (豆包式：会话在项目间移动归属).
 *
 * - Draggable: session rows (id `session::<key>`)
 * - Droppable: project groups (id `group::<workspaceKey>`)
 *
 * The drop only *moves ownership* (not a copy). After the move the runtime
 * context rebinds to the target project (documents / knowledge / project memory).
 * Special groups (unbound/virtual/proactive) are not valid drop targets.
 */
import { cloneElement, useCallback, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '../../lib/useI18n'
import type { ShellSidebarSyncRow, ShellWorkspaceGroup } from './types.js'
import { isSpecialWorkspaceGroupKey } from './workspace-groups.js'

const SESSION_PREFIX = 'session::'
const GROUP_PREFIX = 'group::'

export const sessionDndId = (sessionKey: string) => `${SESSION_PREFIX}${sessionKey}`
export const groupDndId = (workspaceKey: string) => `${GROUP_PREFIX}${workspaceKey}`

export function parseDndId(id: UniqueIdentifier | string | undefined | null): {
  type: 'session' | 'group' | 'unknown'
  key: string
} {
  const raw = String(id ?? '')
  if (raw.startsWith(SESSION_PREFIX)) return { type: 'session', key: raw.slice(SESSION_PREFIX.length) }
  if (raw.startsWith(GROUP_PREFIX)) return { type: 'group', key: raw.slice(GROUP_PREFIX.length) }
  return { type: 'unknown', key: raw }
}

/** Find the group a row belongs to. */
function findGroupOfSession(
  groups: ShellWorkspaceGroup[],
  sessionKey: string,
): ShellWorkspaceGroup | null {
  for (const g of groups) {
    if (g.sessions.some((r) => String(r.sessionKey || '') === sessionKey)) return g
  }
  return null
}

/**
 * Resolve which group the pointer is over. Over may be a group id or a session
 * row that lives inside a group.
 */
function resolveOverGroup(
  overId: UniqueIdentifier | string | undefined | null,
  groups: ShellWorkspaceGroup[],
): ShellWorkspaceGroup | null {
  const parsed = parseDndId(overId)
  if (!parsed.key) return null
  if (parsed.type === 'group') {
    return groups.find((g) => g.workspaceKey === parsed.key) ?? null
  }
  if (parsed.type === 'session') {
    return findGroupOfSession(groups, parsed.key)
  }
  return null
}

// ---------------------------------------------------------------------------
// Draggable session row wrapper
// ---------------------------------------------------------------------------

export function DraggableSessionRow({
  row,
  disabled,
  children,
}: {
  row: ShellSidebarSyncRow
  disabled?: boolean
  children: React.ReactElement<Record<string, unknown>>
}) {
  const sk = String(row.sessionKey || '')
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: sessionDndId(sk),
    disabled,
  })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
  }
  return cloneElement(children, {
    dndRef: setNodeRef,
    dndListeners: listeners,
    dndAttributes: attributes,
    dndStyle: style,
    isDragging,
  })
}

// ---------------------------------------------------------------------------
// Droppable group hook
// ---------------------------------------------------------------------------

export function useDroppableGroup(workspaceKey: string, disabled: boolean) {
  const { setNodeRef, isOver } = useDroppable({
    id: groupDndId(workspaceKey),
    disabled,
  })
  return { setNodeRef, isOver }
}

/**
 * Wrap a project group's outer <li> so it is a drop target and self-highlights
 * when hovered during a drag (must be a real component — it calls a hook).
 */
export function DroppableGroupWrap({
  workspaceKey,
  disabled,
  dragActive,
  dropDisabled,
  className = '',
  children,
}: {
  workspaceKey: string
  disabled: boolean
  dragActive: boolean
  dropDisabled: boolean
  className?: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppableGroup(workspaceKey, disabled)
  const cls = [
    className,
    dragActive && isOver ? (dropDisabled ? ' is-drop-disabled' : ' is-drop-target') : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li ref={setNodeRef} className={cls}>
      {children}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Main DnD controller
// ---------------------------------------------------------------------------

export type UseSessionDndArgs = {
  groups: ShellWorkspaceGroup[]
  /** Actually perform the move; throw / return ok=false to surface an error. */
  onMoveSession: (sessionKey: string, targetRoot: string) => Promise<void>
  /** Auto-expand a collapsed group while hovering it during a drag. */
  onRequestExpandGroup: (workspaceKey: string) => void
  /** Show a non-blocking toast / message. */
  onNotify: (message: string, tone?: 'info' | 'error') => void
}

export function useSessionDnd({
  groups,
  onMoveSession,
  onRequestExpandGroup,
  onNotify,
}: UseSessionDndArgs) {
  const t = useT()
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)
  const [overGroupKey, setOverGroupKey] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const activeSessionRow = useMemo<ShellSidebarSyncRow | null>(() => {
    if (!activeSessionKey) return null
    for (const g of groups) {
      const hit = g.sessions.find((r) => String(r.sessionKey || '') === activeSessionKey)
      if (hit) return hit
    }
    return null
  }, [activeSessionKey, groups])

  const sourceGroup = useMemo(
    () => (activeSessionKey ? findGroupOfSession(groups, activeSessionKey) : null),
    [activeSessionKey, groups],
  )

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const parsed = parseDndId(event.active.id)
    if (parsed.type === 'session') setActiveSessionKey(parsed.key)
    setOverGroupKey(null)
  }, [])

  const handleDragOver = useCallback(
    (event: DragMoveEvent) => {
      const over = resolveOverGroup(event.over?.id, groups)
      const key = over?.workspaceKey ?? null
      setOverGroupKey((prev) => (prev === key ? prev : key))
      // Auto-expand a collapsed target group after a short hover dwell.
      if (over && key) {
        clearHoverTimer()
        hoverTimerRef.current = setTimeout(() => onRequestExpandGroup(key), 650)
      }
    },
    [groups, onRequestExpandGroup, clearHoverTimer],
  )

  const reset = useCallback(() => {
    clearHoverTimer()
    setActiveSessionKey(null)
    setOverGroupKey(null)
  }, [clearHoverTimer])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const dragged = parseDndId(event.active.id)
      const target = resolveOverGroup(event.over?.id, groups)
      const sk = dragged.type === 'session' ? dragged.key : ''
      if (!sk || !target) {
        reset()
        return
      }
      const targetSpecial = isSpecialWorkspaceGroupKey(target.workspaceKey)
      const targetRoot = String(target.path || target.workspaceKey || '').trim()
      // Source group for the "same project" / disabled checks.
      const src = findGroupOfSession(groups, sk)
      const sameProject =
        !!src && src.workspaceKey === target.workspaceKey
      if (targetSpecial) {
        onNotify(t('tasks.dndUnsupportedDrop'), 'info')
        reset()
        return
      }
      if (sameProject) {
        reset()
        return
      }
      if (!targetRoot) {
        onNotify(t('tasks.dndInvalidTargetPath'), 'error')
        reset()
        return
      }
      if (busyRef.current) {
        reset()
        return
      }
      busyRef.current = true
      try {
        await onMoveSession(sk, targetRoot)
        // 目标项目名来自用户数据，只翻译外层文案
        onNotify(t('tasks.dndMovedTo', { name: target.label }), 'info')
      } catch (e) {
        // e.message 来自后端，保持原样；仅兜底文案走 i18n
        const msg = e instanceof Error ? e.message : t('tasks.dndMoveFailed')
        onNotify(msg, 'error')
      } finally {
        busyRef.current = false
        reset()
      }
    },
    [groups, onMoveSession, onNotify, reset, t],
  )

  const overGroup = useMemo(
    () => groups.find((g) => g.workspaceKey === overGroupKey) ?? null,
    [groups, overGroupKey],
  )

  /** Drop target is a special group → show a disabled cue. */
  const dropDisabled = !!overGroup && isSpecialWorkspaceGroupKey(overGroup.workspaceKey)

  return {
    sensors,
    activeSessionKey,
    activeSessionRow,
    sourceGroup,
    overGroup,
    dropDisabled,
    collisionDetection: pointerWithin,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel: reset,
  }
}

export { DndContext, DragOverlay }
