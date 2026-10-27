import { memo } from 'react'
import {
  formatSemanticFileChange,
  type SemanticRunStep,
  type SemanticStepStatus,
} from '../lib/semantic-run-steps.js'
import { AnimatedTokenInline } from './AnimatedTokenDisplay.js'
import { useT } from '../lib/useI18n'

type ProgressProps = {
  headline?: string
  steps: SemanticRunStep[]
  isLive?: boolean
}

type TelemetryProps = {
  summaryMeta?: string
  liveTokenStr?: string
  isLive?: boolean
  /**
   * 右下角「明细」：仅用于展开窗口外更早轮次。
   * 最新轮工具/思考/正文始终直接外露，不经此按钮。
   */
  earlierRoundCount?: number
  showFullHistory?: boolean
  onToggleFullHistory?: () => void
}

function StepMark({ status }: { status: SemanticStepStatus }) {
  if (status === 'done') return <span className="msg-run-progress-mark is-done">✓</span>
  if (status === 'active') {
    return (
      <span className="msg-run-progress-mark is-active" aria-hidden>
        <span className="msg-run-progress-spinner" />
      </span>
    )
  }
  if (status === 'error') return <span className="msg-run-progress-mark is-error">✕</span>
  return <span className="msg-run-progress-mark is-pending">○</span>
}

function AssistantRunProgressInner({ headline, steps, isLive = false }: ProgressProps) {
  const tr = useT()
  const headTitle =
    steps.length > 0
      ? ''
      : String(headline || '').trim() ||
        (isLive ? tr('chatUi.processingNow') : tr('chatUi.processingPaused'))

  return (
    <div className={`msg-run-progress${isLive ? ' is-live' : ''}`} data-variant="running">
      {headTitle ? (
        <div className="msg-run-progress-head">
          <p className="msg-run-progress-headline">{headTitle}</p>
        </div>
      ) : null}
      {steps.length > 0 ? (
        <ul className="msg-run-progress-steps" aria-label={tr('chatUi.execStepsAria')}>
          {steps.map((s) => {
            const count = s.count && s.count > 1 ? s.count : 0
            const fileDetail = formatSemanticFileChange(s.fileChange)
            return (
              <li key={s.id} className={`msg-run-progress-step is-${s.status}`}>
                <StepMark status={s.status} />
                <span className="msg-run-progress-step-body">
                  <span className="msg-run-progress-step-main">
                    <span className="msg-run-progress-step-label">{s.label}</span>
                    {fileDetail ? (
                      <span className="msg-run-progress-step-file" title={fileDetail}>
                        {fileDetail}
                      </span>
                    ) : null}
                  </span>
                  {count ? (
                    <span
                      className="msg-run-progress-step-count"
                      title={tr('chatUi.timesTotalTitle', { count })}
                    >
                      {tr('chatUi.timesCount', { count })}
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * 底部条：非 live 显示耗时/tokens；live 时指标在 StreamRunStatusLine。
 * 「明细」只展开更早轮次，不挡最新流式内容。
 */
function AssistantRunTelemetryInner({
  summaryMeta,
  liveTokenStr,
  isLive = false,
  earlierRoundCount = 0,
  showFullHistory = false,
  onToggleFullHistory,
}: TelemetryProps) {
  const tr = useT()
  const tokenStr = String(liveTokenStr || '').trim()
  const meta = String(summaryMeta || '').trim()
  const showHistoryToggle =
    !!onToggleFullHistory && (earlierRoundCount > 0 || showFullHistory)
  if (isLive && !showHistoryToggle) return null
  if (!isLive && !meta && !tokenStr && !showHistoryToggle) return null

  return (
    <div className={`msg-run-telemetry${isLive ? ' is-live' : ''}`} aria-live="polite">
      <div className="msg-run-telemetry-main">
        {!isLive && meta ? <span className="msg-run-telemetry-meta">{meta}</span> : null}
        {!isLive && meta && tokenStr ? (
          <span className="msg-run-telemetry-sep" aria-hidden>
            ·
          </span>
        ) : null}
        {!isLive && tokenStr ? (
          <span
            className="msg-run-telemetry-tokens"
            title={tr('chatUi.tokenUsageTitle')}
          >
            <AnimatedTokenInline
              tokenStr={tokenStr}
              animate={false}
              className="msg-run-telemetry-tokens-value"
            />
          </span>
        ) : null}
      </div>
      {showHistoryToggle ? (
        <div className="msg-run-telemetry-actions">
          <button
            type="button"
            className={`msg-run-telemetry-action msg-run-telemetry-details${
              showFullHistory ? ' is-open' : ''
            }`}
            onClick={onToggleFullHistory}
            aria-expanded={showFullHistory}
            title={
              showFullHistory
                ? tr('chatUi.showLatestRoundOnly')
                : tr('chatUi.viewEarlierRounds', { count: earlierRoundCount })
            }
          >
            {showFullHistory ? tr('chatUi.collapse') : tr('chatUi.details')}
            <span className="msg-run-telemetry-chevron" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const AssistantRunProgress = memo(AssistantRunProgressInner)
export const AssistantRunTelemetry = memo(AssistantRunTelemetryInner)
