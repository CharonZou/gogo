import { memo } from 'react'
import { useT } from '../lib/useI18n'

export type PendingSteerItem = {
  id: string
  messageId: string
  text: string
}

type PendingSteersStripProps = {
  items: PendingSteerItem[]
  onCancelPendingSteer?: (messageId: string) => void
  onInterruptAndSendSteers?: () => void
}

/** Mid-turn ↑ steers: sits above the composer input box, visually separate from typing area. */
export const PendingSteersStrip = memo(function PendingSteersStrip({
  items,
  onCancelPendingSteer,
  onInterruptAndSendSteers,
}: PendingSteersStripProps) {
  const tr = useT()
  if (!items.length) return null

  return (
    <div className="react-chat-steer-strip" aria-label={tr('chatUi.pendingSteersAria')}>
      <div className="react-chat-steer-strip__header">
        <span className="react-chat-steer-strip__title">
          {tr('chatUi.steerSubmitNextCall')}
          {items.length > 1 ? tr('chatUi.steerCountSuffix', { count: items.length }) : ''}
        </span>
        <span className="react-chat-steer-strip__hint">{tr('chatUi.steerEscHint')}</span>
        {onInterruptAndSendSteers ? (
          <button
            type="button"
            className="react-chat-steer-strip__interrupt"
            title={tr('chatUi.steerInterruptTitle')}
            onClick={() => onInterruptAndSendSteers()}
          >
            {tr('chatUi.sendNow')}
          </button>
        ) : null}
      </div>
      <div className="react-chat-steer-strip__list">
        {items.map((item) => (
          <div key={item.messageId || item.id} className="react-chat-steer-strip__bubble">
            <span className="react-chat-steer-strip__bubble-label" aria-hidden="true">
              {tr('chatUi.steerLabel')}
            </span>
            <span className="react-chat-steer-strip__bubble-text" title={item.text}>
              {item.text}
            </span>
            {onCancelPendingSteer ? (
              <button
                type="button"
                className="react-chat-steer-strip__cancel"
                title={tr('chatUi.steerCancelTitle')}
                aria-label={tr('chatUi.steerCancelAria')}
                onClick={() => onCancelPendingSteer(item.messageId)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
})
