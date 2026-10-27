import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { positionMenuAbovePoint } from '../lib/session-list/menu-position.js'
import type { ShellWorkspaceGroup } from '../lib/session-list/types.js'
import { WORKSPACE_GROUP_UNBOUND } from '../lib/session-list/workspace-groups.js'
import { ShellArchiveIcon, ShellEditIcon, ShellRemoveIcon } from './ShellSidebarIcons.js'
import { useT } from '../lib/useI18n'

export type WorkspaceFolderContextMenuState = {
  workspaceKey: string
  x: number
  y: number
}

type WorkspaceFolderContextMenuPortalProps = {
  menu: WorkspaceFolderContextMenuState | null
  group: ShellWorkspaceGroup | null
  canOpenFolder?: boolean
  canPin?: boolean
  isPinned?: boolean
  canFocus?: boolean
  onClose: () => void
  onOpenFolder?: () => void
  onTogglePin?: () => void
  onFocusOnly?: () => void
  onDelete: () => void
  /** 编辑项目标题 */
  onEditTitle?: () => void
  /** 归档项目中的对话 */
  onArchive?: () => void
}

export function WorkspaceFolderContextMenuPortal({
  menu,
  group,
  canOpenFolder = false,
  canPin = false,
  isPinned = false,
  canFocus = false,
  onClose,
  onOpenFolder,
  onTogglePin,
  onFocusOnly,
  onDelete,
  onEditTitle,
  onArchive,
}: WorkspaceFolderContextMenuPortalProps) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const onDocClick = (e: Event) => {
      if (!(e.target as HTMLElement).closest('.react-chat-workspace-context-menu')) onClose()
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
  }, [menu, group?.sessionCount, canOpenFolder, canPin, canFocus, isPinned])

  if (!menu || !group) return null

  const count = Number(group.sessionCount || 0)

  return createPortal(
    <div
      ref={menuRef}
      className="react-chat-workspace-context-menu"
      role="menu"
      style={
        pos
          ? { position: 'fixed', left: pos.left, top: pos.top, zIndex: 12000, visibility: 'visible' }
          : { position: 'fixed', left: menu.x, top: menu.y, visibility: 'hidden' }
      }
    >
      <button
        type="button"
        className="react-chat-workspace-context-menu-item"
        onClick={() => onEditTitle?.()}
      >
        <ShellEditIcon size={14} className="react-chat-workspace-context-menu-item-ic" />
        {t('chatShell.wsfEditTitle')}
      </button>
      <button
        type="button"
        className="react-chat-workspace-context-menu-item"
        disabled={count === 0}
        title={count === 0 ? t('chatShell.wsfNoSessionsTitle') : undefined}
        onClick={() => onArchive?.()}
      >
        <ShellArchiveIcon size={14} className="react-chat-workspace-context-menu-item-ic" />
        {t('chatShell.wsfArchiveChats')}
        {count > 0 ? (
          <span className="react-chat-workspace-context-menu-item-count">{count}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="react-chat-workspace-context-menu-item react-chat-workspace-context-menu-item--danger"
        onClick={() => onDelete()}
      >
        <ShellRemoveIcon size={14} className="react-chat-workspace-context-menu-item-ic" />
        {t('chatShell.wsfRemoveProject')}
      </button>
      <div className="react-chat-workspace-context-menu-sep" role="separator" />
      {canFocus ? (
        <button
          type="button"
          className="react-chat-workspace-context-menu-item"
          onClick={() => onFocusOnly?.()}
        >
          {t('chatShell.wsfFocusOnly')}
        </button>
      ) : null}
      {canPin ? (
        <button
          type="button"
          className="react-chat-workspace-context-menu-item"
          onClick={() => onTogglePin?.()}
        >
          {isPinned ? t('chatShell.wsfUnpin') : t('chatShell.wsfPin')}
        </button>
      ) : null}
      {canOpenFolder ? (
        <button
          type="button"
          className="react-chat-workspace-context-menu-item"
          onClick={() => onOpenFolder?.()}
        >
          {canOpenFolder && group.workspaceKey === WORKSPACE_GROUP_UNBOUND
            ? t('chatShell.wsfOpenDefaultDir')
            : t('chatShell.wftOpenFolder')}
        </button>
      ) : null}
    </div>,
    document.body,
  )
}
