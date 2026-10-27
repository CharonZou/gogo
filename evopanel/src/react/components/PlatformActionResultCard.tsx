import { memo, useMemo } from 'react'
import {
  navigatePlatformFeedbackRoute,
  parsePlatformUiFeedbackFromTool,
  platformActionCardMeta,
  platformActionCardTitle,
  type PlatformUiFeedback,
} from '../../lib/right-stage/platform-feedback.js'
import { requestOpenPlatformFeedbackFromTool } from '../../lib/right-stage/platform-feedback-bridge.js'
import { useT } from '../lib/useI18n'

type Props = {
  tool: Record<string, unknown>
  className?: string
}

function StatusIcon({ kind }: { kind: PlatformUiFeedback['kind'] }) {
  if (kind === 'error') {
    return (
      <span className="msg-action-result-icon is-error" aria-hidden>
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none">
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  if (kind === 'warning') {
    return (
      <span className="msg-action-result-icon is-warning" aria-hidden>
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none">
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path d="M9 5.2v5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="9" cy="12.6" r="0.9" fill="#fff" />
        </svg>
      </span>
    )
  }
  return (
    <span className="msg-action-result-icon is-success" aria-hidden>
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none">
        <circle cx="9" cy="9" r="8" fill="currentColor" />
        <path
          d="M5.4 9.2l2.4 2.4 4.8-5"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** 平台工具完成后的结构化 Action Result（消息流内） */
export const PlatformActionResultCard = memo(function PlatformActionResultCard({
  tool,
  className = '',
}: Props) {
  const tr = useT()
  const ui = useMemo(() => parsePlatformUiFeedbackFromTool(tool), [tool])
  if (!ui) return null

  const title = platformActionCardTitle(ui)
  const meta = platformActionCardMeta(ui)
  const primaryAction = Array.isArray(ui.actions) && ui.actions.length > 0 ? ui.actions[0] : null
  const actionLabel = primaryAction?.label || tr('chatUi.viewDetails')

  const onOpen = () => {
    if (primaryAction?.route) {
      navigatePlatformFeedbackRoute(primaryAction.route)
      return
    }
    requestOpenPlatformFeedbackFromTool(tool)
  }

  return (
    <div className={`msg-action-result${className ? ` ${className}` : ''}`}>
      <StatusIcon kind={ui.kind} />
      <div className="msg-action-result-body">
        <div className="msg-action-result-title">{title}</div>
        <div className="msg-action-result-meta">{meta}</div>
      </div>
      <button type="button" className="msg-action-result-link" onClick={onOpen}>
        {/* i18n: 保留中文比较串 */}
        {actionLabel === '查看事项' || actionLabel === '查看任务' ? tr('chatUi.viewDetails') : actionLabel}
      </button>
    </div>
  )
})
