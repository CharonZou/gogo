import type { ThreadGoalProposal } from '../chat-types.js'
import { pushTargetKey } from '../lib/goalPushTarget.js'
import { useT } from '../lib/useI18n'

export function GoalProposalDock({
  proposal,
  busy,
  onDismiss,
  onApplyOnly,
  onApplyStart,
}: {
  proposal: ThreadGoalProposal
  busy?: boolean
  onDismiss: () => void
  onApplyOnly: () => void
  onApplyStart: () => void
}) {
  const tr = useT()
  const goalPreview = (proposal.goal || '').trim()
  const head = goalPreview.length > 220 ? `${goalPreview.slice(0, 220)}…` : goalPreview
  const pushLabel =
    proposal.feishuPushOnComplete === false
      ? tr('chatUi.pushOff')
      : proposal.pushChannel && proposal.pushTargetId
        ? pushTargetKey(proposal.pushChannel, proposal.pushTargetId)
        : proposal.feishuPushOnComplete
          ? tr('chatUi.pushOn')
          : tr('chatUi.pushDefault')

  return (
    <div className="react-chat-hosted-proposal-dock" role="region" aria-label={tr('chatUi.goalProposalAria')}>
      <div className="react-chat-hosted-proposal-dock-inner">
        <div className="react-chat-hosted-proposal-dock-head">
          <strong>{tr('chatUi.goalProposal')}</strong>
          <span className="react-chat-hosted-proposal-dock-sub">{tr('chatUi.goalProposalSub')}</span>
        </div>
        <div className="react-chat-hosted-proposal-dock-body">
          <div className="react-chat-hosted-proposal-dock-row">
            <span className="react-chat-hosted-proposal-dock-k">{tr('chatUi.goalLabel')}</span>
            <span className="react-chat-hosted-proposal-dock-v">{head || tr('chatUi.emptyParen')}</span>
          </div>
          <div className="react-chat-hosted-proposal-dock-meta">
            <span>{pushLabel}</span>
            {proposal.useEvolutionSkill ? <span>{tr('chatUi.evolution')}</span> : null}
          </div>
        </div>
        <div className="react-chat-hosted-proposal-dock-actions">
          <button type="button" className="btn btn-ghost sm" disabled={!!busy} onClick={onDismiss}>
            {tr('chatUi.close')}
          </button>
          <button type="button" className="btn btn-ghost sm" disabled={!!busy} onClick={onApplyOnly}>
            {tr('chatUi.fillToPanel')}
          </button>
          <button type="button" className="btn btn-primary sm" disabled={!!busy} onClick={onApplyStart}>
            {tr('chatUi.fillAndStart')}
          </button>
        </div>
      </div>
    </div>
  )
}
