import { memo, useState, type ReactNode } from 'react'
import { useT } from '../lib/useI18n'

export const CollapsedAnswerBlock = memo(function CollapsedAnswerBlock({
  preview,
  children,
  defaultExpanded = false,
}: {
  preview: string
  children: ReactNode
  defaultExpanded?: boolean
}) {
  const tr = useT()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const short = preview.trim().slice(0, 120)
  const needsCollapse = preview.trim().length > 120

  if (!needsCollapse) {
    return <>{children}</>
  }

  return (
    <div className={`ai-answer-collapse${expanded ? ' is-expanded' : ' is-collapsed'}`}>
      <button
        type="button"
        className="ai-answer-collapse-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className={`ai-answer-collapse-chevron${expanded ? ' is-expanded' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="ai-answer-collapse-label">
          {expanded ? tr('chatUi.collapseAnswer') : tr('chatUi.expandAnswer')}
        </span>
      </button>
      {!expanded ? (
        <p className="ai-answer-collapse-preview">{short}{preview.trim().length > 120 ? '…' : ''}</p>
      ) : (
        <div className="ai-answer-collapse-body">{children}</div>
      )}
    </div>
  )
})
