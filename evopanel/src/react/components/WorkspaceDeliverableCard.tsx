/**
 * 聊天 / 工具行共用的产出文件操作：预览 · 复制路径 · 打开位置
 */
import { memo, useCallback, type MouseEvent } from 'react'
import { toast } from '../../components/toast.js'
import { getChatWorkspaceRoot } from '../../lib/chat-workspace-context.js'
import {
  resolveTaskOutputAbsolutePath,
  revealTaskOutputInFileManager,
} from '../../lib/task-output-preview.js'
import { openWorkspaceFilePreviewModal } from '../../lib/mount-workspace-file-preview.js'
import { useT } from '../lib/useI18n'

function basename(t: (key: string) => string, path: string): string {
  const parts = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  return parts[parts.length - 1] || path || t('chatShell.mentionFileKind')
}

function shortenPath(path: string, max = 64): string {
  const s = String(path || '').replace(/\\/g, '/')
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}

export type WorkspaceDeliverableCardProps = {
  path: string
  name?: string
  /** 优先用聊天侧已有预览；不传则走共享 modal */
  onPreview?: (path: string, name?: string) => void
  /** compact：工具行旁按钮；card：消息底部文件卡 */
  variant?: 'card' | 'compact'
  className?: string
}

async function resolveWorkspaceHint(): Promise<string> {
  return String(getChatWorkspaceRoot() || '').trim()
}

export const WorkspaceDeliverableCard = memo(function WorkspaceDeliverableCard({
  path,
  name,
  onPreview,
  variant = 'card',
  className = '',
}: WorkspaceDeliverableCardProps) {
  const t = useT()
  const rawPath = String(path || '').trim()
  const title = String(name || '').trim() || basename(t, rawPath)
  const isUrl = /^https?:\/\//i.test(rawPath)

  const stop = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handlePreview = useCallback(
    async (e: MouseEvent) => {
      stop(e)
      if (!rawPath) return
      if (isUrl) {
        window.open(rawPath, '_blank', 'noopener,noreferrer')
        return
      }
      if (onPreview) {
        onPreview(rawPath, title)
        return
      }
      try {
        const root = await resolveWorkspaceHint()
        openWorkspaceFilePreviewModal({
          workspaceRoot: root || rawPath.replace(/[\\/][^\\/]+$/, '') || '',
          path: rawPath,
          name: title,
          workspaceScopeOpts: root ? { configuredRoot: root } : undefined,
        })
      } catch (err) {
        toast(t('chatShell.wsdPreviewFailed', { msg: String((err as Error)?.message || err) }), 'error')
      }
    },
    [isUrl, onPreview, rawPath, title, t],
  )

  const handleCopy = useCallback(
    async (e: MouseEvent) => {
      stop(e)
      if (!rawPath) return
      try {
        const root = await resolveWorkspaceHint()
        let text = rawPath
        if (!isUrl) {
          try {
            text = await resolveTaskOutputAbsolutePath({ path: rawPath, workspaceRoot: root })
          } catch {
            /* keep raw */
          }
        }
        await navigator.clipboard.writeText(text)
        toast(t('chatShell.wsdCopied'), 'success')
      } catch (err) {
        toast(t('chatShell.wsdCopyFailed', { msg: String((err as Error)?.message || err) }), 'error')
      }
    },
    [isUrl, rawPath, t],
  )

  const handleReveal = useCallback(
    async (e: MouseEvent) => {
      stop(e)
      if (!rawPath || isUrl) return
      try {
        const root = await resolveWorkspaceHint()
        await revealTaskOutputInFileManager({ path: rawPath, workspaceRoot: root })
        toast(t('chatShell.openedInFileManager'), 'success')
      } catch (err) {
        toast(String((err as Error)?.message || err), 'error')
      }
    },
    [isUrl, rawPath, t],
  )

  if (!rawPath) return null

  if (variant === 'compact') {
    return (
      <span className={`msg-deliverable-actions ${className}`.trim()}>
        <button type="button" className="msg-deliverable-action" onClick={handlePreview}>
          {t('chatShell.wsdPreview')}
        </button>
        <button type="button" className="msg-deliverable-action msg-deliverable-action--muted" onClick={handleCopy}>
          {t('chatShell.wsdCopy')}
        </button>
        {!isUrl ? (
          <button
            type="button"
            className="msg-deliverable-action msg-deliverable-action--muted"
            title={t('chatShell.revealInManagerTitle')}
            onClick={handleReveal}
          >
            {t('chatShell.revealLocationLabel')}
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <div className={`msg-deliverable-card ${className}`.trim()}>
      <button type="button" className="msg-deliverable-card-main" onClick={handlePreview} title={rawPath}>
        <span className="msg-deliverable-card-name">{title}</span>
        <span className="msg-deliverable-card-path">{shortenPath(rawPath)}</span>
      </button>
      <div className="msg-deliverable-card-actions">
        <button type="button" className="msg-deliverable-action" onClick={handlePreview}>
          {t('chatShell.wsdPreview')}
        </button>
        <button type="button" className="msg-deliverable-action msg-deliverable-action--muted" onClick={handleCopy}>
          {t('chatShell.wsdCopyPath')}
        </button>
        {isUrl ? (
          <a className="msg-deliverable-action" href={rawPath} target="_blank" rel="noopener noreferrer">
            {t('chatShell.wsdOpen')}
          </a>
        ) : (
          <button
            type="button"
            className="msg-deliverable-action msg-deliverable-action--muted"
            title={t('chatShell.revealInManagerTitle')}
            onClick={handleReveal}
          >
            {t('chatShell.revealLocationLabel')}
          </button>
        )}
      </div>
    </div>
  )
})
