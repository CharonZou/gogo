import { useMemo, useState } from 'react'
import {
  contextBreakdownFromSnapshot,
  contextOccupancyFromSnapshot,
  formatContextTokensCompact,
  formatTokenCountDisplay,
  type ContextUsageSnapshot,
} from '../lib/context-usage.js'
import type { TokenTotals } from '../chat-types.js'
import { useT } from '../lib/useI18n'

type Props = {
  usage: ContextUsageSnapshot | null
  tokenTotals?: TokenTotals | null
  onManualCompact?: () => void
  manualCompactDisabled?: boolean
  compacting?: boolean
  className?: string
}

function cacheHitLine(t: (key: string, params?: Record<string, unknown>) => string, tokenTotals: TokenTotals | null | undefined): string | null {
  if (!tokenTotals) return null
  const hit = Math.max(0, Number(tokenTotals.cacheRead) || 0)
  const miss = Math.max(0, Number(tokenTotals.cacheMiss) || 0)
  const creation = Math.max(0, Number(tokenTotals.cacheCreation) || 0)
  if (hit <= 0 && miss <= 0 && creation <= 0) return null
  const denom = hit + miss
  const rate = denom > 0 ? `${((hit / denom) * 100).toFixed(0)}%` : null
  const parts: string[] = []
  if (rate) parts.push(t('chatShell.cacheHitRate', { rate }))
  if (hit > 0) parts.push(t('chatShell.cacheHitCount', { count: formatTokenCountDisplay(hit) }))
  if (creation > 0) parts.push(t('chatShell.cacheWriteCount', { count: formatTokenCountDisplay(creation) }))
  if (miss > 0) parts.push(t('chatShell.cacheMissCount', { count: formatTokenCountDisplay(miss) }))
  return parts.join(' · ')
}

/** DeepSeek-style occupancy: % + figures + bar; developer details collapsed. */
export function ContextOccupancyPanel({
  usage,
  tokenTotals = null,
  onManualCompact,
  manualCompactDisabled = false,
  compacting = false,
  className = '',
}: Props) {
  const t = useT()
  const occupancy = useMemo(() => contextOccupancyFromSnapshot(usage), [usage])
  const breakdown = useMemo(() => contextBreakdownFromSnapshot(usage), [usage])
  const cacheLine = useMemo(() => cacheHitLine(t, tokenTotals), [tokenTotals, t])
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (!occupancy) {
    return (
      <div className={`react-chat-ctx-meter${className ? ` ${className}` : ''}`}>
        <p className="react-chat-ctx-meter-hint">{t('chatShell.ctxNoData')}</p>
      </div>
    )
  }

  const { percent, usedTokens, contextWindow } = occupancy
  const breakdownTotal = breakdown
    ? breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
    : 0
  const messageCount =
    usage?.messageCount != null && Number.isFinite(Number(usage.messageCount))
      ? Math.max(0, Math.round(Number(usage.messageCount)))
      : null
  const toolCount =
    usage?.toolCount != null && Number.isFinite(Number(usage.toolCount))
      ? Math.max(0, Math.round(Number(usage.toolCount)))
      : null
  const promptTokens =
    tokenTotals != null && Number.isFinite(Number(tokenTotals.input))
      ? Math.max(0, Math.round(Number(tokenTotals.input)))
      : null
  const completionTokens =
    tokenTotals != null && Number.isFinite(Number(tokenTotals.output))
      ? Math.max(0, Math.round(Number(tokenTotals.output)))
      : null
  const rows = [
    { key: 'system', label: t('chatShell.ctxSegSystem'), tokens: breakdown?.systemTokens ?? 0, tone: 'system' as const, countLabel: null as string | null },
    {
      key: 'tools',
      label: t('chatShell.ctxSegTools'),
      tokens: breakdown?.toolsTokens ?? 0,
      tone: 'tools' as const,
      countLabel: toolCount != null && toolCount > 0 ? t('chatShell.ctxCountGe', { count: toolCount }) : null,
    },
    {
      key: 'messages',
      label: t('chatShell.ctxSegMessages'),
      tokens: breakdown?.messageTokens ?? 0,
      tone: 'messages' as const,
      countLabel: messageCount != null && messageCount > 0 ? t('chatShell.ctxCountTiao', { count: messageCount }) : null,
    },
  ]
  const segments =
    !breakdown || breakdownTotal <= 0
      ? [{ key: 'total', tone: 'total' as const, width: percent }]
      : rows
          .map((row) => ({
            key: row.key,
            tone: row.tone,
            width: (percent * row.tokens) / breakdownTotal,
          }))
          .filter((s) => s.width > 0)

  const hasDeveloperDetails =
    Boolean(breakdown) ||
    Boolean(cacheLine) ||
    promptTokens != null ||
    completionTokens != null ||
    (toolCount != null && toolCount > 0)

  return (
    <div className={`react-chat-ctx-meter${className ? ` ${className}` : ''}`}>
      <div className="react-chat-ctx-meter-header">
        <span className="react-chat-ctx-meter-headline">{t('chatShell.tabContext')}</span>
        <span className="react-chat-ctx-meter-percent">{percent}%</span>
        {onManualCompact ? (
          <button
            type="button"
            className="react-chat-ctx-meter-compact-btn"
            disabled={manualCompactDisabled || compacting}
            title={t('chatShell.ctxCompactTitle')}
            onClick={(e) => {
              e.stopPropagation()
              onManualCompact()
            }}
          >
            {compacting || manualCompactDisabled ? t('chatShell.ctxCompacting') : t('chatShell.ctxCompact')}
          </button>
        ) : null}
        <span className="react-chat-ctx-meter-figures">
          {formatContextTokensCompact(usedTokens)} / {formatContextTokensCompact(contextWindow)} tokens
        </span>
      </div>
      <div className="react-chat-ctx-meter-bar" aria-hidden>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`react-chat-ctx-meter-segment is-${seg.tone}`}
            style={{ width: `${seg.width}%` }}
          />
        ))}
      </div>
      {usage?.compacted ||
      (usage?.beforeTokens != null && usage.beforeTokens > usage.usedTokens) ? (
        <p className="react-chat-ctx-meter-compact-note">
          {usage.beforeTokens != null && usage.beforeTokens > usage.usedTokens
            ? t('chatShell.ctxCompactedRange', {
                before: formatContextTokensCompact(usage.beforeTokens),
                after: formatContextTokensCompact(usage.usedTokens),
              })
            : t('chatShell.ctxCompacted')}
        </p>
      ) : null}
      {hasDeveloperDetails ? (
        <details
          className="react-chat-ctx-meter-details"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>{t('chatShell.ctxRunStats')}</summary>
          {(messageCount != null && messageCount > 0) || (toolCount != null && toolCount > 0) ? (
            <p className="react-chat-ctx-meter-counts" title={t('chatShell.ctxCountsTitle')}>
              {[
                messageCount != null && messageCount > 0 ? t('chatShell.ctxMessagesCount', { count: messageCount }) : null,
                toolCount != null && toolCount > 0 ? t('chatShell.ctxToolsCount', { count: toolCount }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
          {breakdown ? (
            <dl className="react-chat-ctx-meter-rows">
              {rows.map((row) => (
                <div key={row.key} className="react-chat-ctx-meter-row">
                  <dt>
                    <span className={`react-chat-ctx-meter-swatch is-${row.tone}`} aria-hidden />
                    {row.label}
                    {row.countLabel ? (
                      <span className="react-chat-ctx-meter-count">{row.countLabel}</span>
                    ) : null}
                  </dt>
                  <dd>~{formatContextTokensCompact(row.tokens)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="react-chat-ctx-meter-hint">{t('chatShell.ctxBreakdownHint')}</p>
          )}
          {promptTokens != null || completionTokens != null ? (
            <dl className="react-chat-ctx-meter-rows">
              {promptTokens != null ? (
                <div className="react-chat-ctx-meter-row">
                  <dt>Prompt Tokens</dt>
                  <dd>{formatTokenCountDisplay(promptTokens)}</dd>
                </div>
              ) : null}
              {completionTokens != null ? (
                <div className="react-chat-ctx-meter-row">
                  <dt>Completion Tokens</dt>
                  <dd>{formatTokenCountDisplay(completionTokens)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {cacheLine ? (
            <p className="react-chat-ctx-meter-cache" title={t('chatShell.ctxCacheTitle')}>
              {t('chatShell.ctxCachePrefix', { line: cacheLine })}
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  )
}
