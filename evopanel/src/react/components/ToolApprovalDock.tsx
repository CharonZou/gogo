import { useMemo } from 'react'
import { useT } from '../lib/useI18n'
import { ToolApprovalPanel, type ToolApprovalChoice } from './ToolApprovalPanel.js'

export type PendingToolApproval = {
  tool_call_id: string
  tool_name: string
  summary: string
  args?: Record<string, unknown>
  risk?: string
}

export function ToolApprovalDock({
  pending,
  busy,
  onChoice,
}: {
  pending: PendingToolApproval[]
  busy?: boolean
  onChoice: (toolCallId: string, choice: ToolApprovalChoice) => void
}) {
  const tr = useT()
  const list = useMemo(
    () => (pending || []).filter((p) => String(p?.tool_call_id || '').trim()),
    [pending],
  )
  if (!list.length) return null

  return (
    <div className="react-chat-tool-approval-dock" role="region" aria-label={tr('chatUi.pendingToolsAria')}>
      {list.map((item, index) => {
        const id = String(item.tool_call_id || '').trim()
        const name = String(item.tool_name || tr('chatUi.toolStubName')).trim()
        const summary = String(item.summary || '').trim()
        return (
          <ToolApprovalPanel
            key={id}
            toolName={name}
            summary={summary}
            busy={busy}
            autoFocus={index === 0}
            onConfirm={(choice) => onChoice(id, choice)}
          />
        )
      })}
    </div>
  )
}
