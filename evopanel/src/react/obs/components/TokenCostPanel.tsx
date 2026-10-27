import { ObsSection } from './ObsLayout'
import { fmtCnyEstimate, fmtHitPct, fmtTok } from '../lib/obs-formatters'
import { useT } from '../../lib/useI18n'

export type TokenCostSummary = {
  totalTokens: number
  totalTokensDelta: string
  cacheReadTokens: number
  cacheHitRatePct: string
  fullPriceCny: string
  costAfterCacheCny: string
  savingsCny: string
  pricingNote: string | null
}

export function TokenCostPanel({ summary }: { summary: TokenCostSummary }) {
  const t = useT() // 局部遮蔽
  const hasCost = summary.fullPriceCny !== '—' || summary.costAfterCacheCny !== '—' || summary.savingsCny !== '—'
  const pricingNote = summary.pricingNote ?? t('obs.obsTokenPricingNote')

  return (
    <ObsSection
      title={t('obs.obsTokenTitle')}
      subtitle={pricingNote}
      className="span-3 token-cost-section"
    >
      <div className="token-cost-panel">
        <div className="token-cost-panel__block">
          <span className="token-cost-panel__label">{t('obs.obsTokenTotal')}</span>
          <strong className="token-cost-panel__value">{fmtTok(summary.totalTokens)}</strong>
          {summary.totalTokensDelta !== '—' && (
            <em className="token-cost-panel__hint">{summary.totalTokensDelta}</em>
          )}
        </div>
        <div className="token-cost-panel__block">
          <span className="token-cost-panel__label">{t('obs.obsTokenCacheHit')}</span>
          <strong className="token-cost-panel__value">{fmtTok(summary.cacheReadTokens)}</strong>
          <em className="token-cost-panel__hint">{summary.cacheHitRatePct}</em>
        </div>
        {hasCost ? (
          <>
            <div className="token-cost-panel__divider" aria-hidden />
            <div className="token-cost-panel__block">
              <span className="token-cost-panel__label">{t('obs.obsTokenFullPrice')}</span>
              <strong className="token-cost-panel__value">{summary.fullPriceCny}</strong>
            </div>
            <div className="token-cost-panel__block">
              <span className="token-cost-panel__label">{t('obs.obsTokenAfterCache')}</span>
              <strong className="token-cost-panel__value">{summary.costAfterCacheCny}</strong>
            </div>
            <div className="token-cost-panel__block token-cost-panel__block--savings">
              <span className="token-cost-panel__label">{t('obs.obsTokenSavings')}</span>
              <strong className="token-cost-panel__value">{summary.savingsCny}</strong>
            </div>
          </>
        ) : (
          <div className="token-cost-panel__block token-cost-panel__block--muted">
            <span className="token-cost-panel__label">{t('obs.obsTokenCostEstimate')}</span>
            <strong className="token-cost-panel__value">—</strong>
            <em className="token-cost-panel__hint">{t('obs.obsTokenNoCacheData')}</em>
          </div>
        )}
      </div>
    </ObsSection>
  )
}

export function buildTokenCostSummary(args: {
  totalTokens: number
  totalTokensDelta: string
  cacheReadTokens: number
  cacheHitRatePct: number | null | undefined
  estimatedFullPriceCny: number | null | undefined
  estimatedTotalCostCny: number | null | undefined
  estimatedSavingsCny: number | null | undefined
  pricingNote: string | null | undefined
}): TokenCostSummary {
  return {
    totalTokens: args.totalTokens,
    totalTokensDelta: args.totalTokensDelta,
    cacheReadTokens: args.cacheReadTokens,
    cacheHitRatePct: fmtHitPct(args.cacheHitRatePct ?? null),
    fullPriceCny: fmtCnyEstimate(args.estimatedFullPriceCny ?? null),
    costAfterCacheCny: fmtCnyEstimate(args.estimatedTotalCostCny ?? null),
    savingsCny: fmtCnyEstimate(args.estimatedSavingsCny ?? null),
    pricingNote: args.pricingNote ?? null,
  }
}
