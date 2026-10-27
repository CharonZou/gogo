import type { PushTargetOption } from '../lib/goalPushTarget.js'
import { useT } from '../lib/useI18n'

export function PushTargetPicker({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: PushTargetOption[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const t = useT()
  if (!options.length) {
    return <p className="react-chat-goal-hint">{t('chatShell.ptpEmpty')}</p>
  }

  return (
    <div className="react-chat-thread-clarify-options react-chat-goal-push-options" role="radiogroup" aria-label={t('chatShell.ptpAria')}>
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={`react-chat-thread-clarify-option${active ? ' is-selected' : ''}`}
            onClick={() => onChange(opt.id)}
          >
            <span className="react-chat-thread-clarify-option-indicator" aria-hidden />
            <span className="react-chat-thread-clarify-option-label">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
