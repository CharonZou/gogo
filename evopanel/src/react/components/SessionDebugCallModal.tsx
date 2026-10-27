import { memo, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ContentStatsBar } from '../obs/components/ContentStatsBar.js'
import { JsonViewer } from '../obs/components/JsonViewer.js'
import { fetchObsModelDetail } from '../obs/lib/obs-api.js'
import {
  formatJsonText,
  parseRequestViews,
  parseResponseViews,
  resolveFailureMessage,
  type ToolContentStat,
} from '../obs/lib/obs-payload-parse.js'
import {
  fmtCacheHitTok,
  fmtMs,
  fmtUsageTok,
  requestTokenTitle,
} from '../obs/lib/obs-formatters.js'
import {
  estimateTextStats,
  fmtContentStats,
  fmtContentStatsShort,
  resolveContentStats,
  type ContentStats,
} from '../obs/lib/obs-text-stats.js'
import type { RequestRecord } from '../obs/types/index.js'
import { splitSystemPromptSections } from '../lib/system-prompt-sections.js'
import { useT } from '../lib/useI18n'

type ModalTab =
  | 'tools'
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool_calls'
  | 'request'
  | 'response'
  | 'usage'

function DebugTextPanel({
  value,
  stats,
  emptyHint,
}: {
  value: string | null | undefined
  stats?: ContentStats | null
  emptyHint?: string
}) {
  const tr = useT()
  const text = String(value || '').trim()
  // 默认空提示渲染期取词，跟随界面语言
  const hint = emptyHint ?? tr('chatUi.dbgEmptyDefault')
  const resolvedStats = resolveContentStats(stats, text)
  if (!text) {
    return <div className="react-chat-session-debug-modal-empty">{hint}</div>
  }
  return (
    <div className="react-chat-session-debug-modal-text-panel">
      <ContentStatsBar stats={resolvedStats} />
      <pre className="react-chat-session-debug-modal-pre react-chat-session-debug-modal-pre--fill">
        {text}
      </pre>
    </div>
  )
}

/** 按组装 XML 块拆开系统提示词，便于对照员工/主对话拼装逻辑 */
function DebugSystemPromptPanel({
  value,
  stats,
  emptyHint,
}: {
  value: string | null | undefined
  stats?: ContentStats | null
  emptyHint?: string
}) {
  const tr = useT()
  const text = String(value || '').trim()
  // 默认空提示渲染期取词，跟随界面语言
  const hint = emptyHint ?? tr('chatUi.dbgEmptyDefault')
  const resolvedStats = resolveContentStats(stats, text)
  const sections = useMemo(() => splitSystemPromptSections(text), [text])
  const [mode, setMode] = useState<'sections' | 'full'>('sections')
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    // 默认展开前 3 块，避免一次铺开过长
    const next: Record<string, boolean> = {}
    sections.slice(0, 3).forEach((s) => {
      next[s.id] = true
    })
    setOpenIds(next)
    setMode(sections.length > 1 ? 'sections' : 'full')
  }, [text])

  if (!text) {
    return <div className="react-chat-session-debug-modal-empty">{hint}</div>
  }

  const showSections = mode === 'sections' && sections.length > 1

  return (
    <div className="react-chat-session-debug-modal-text-panel">
      <div className="react-chat-session-debug-system-toolbar">
        <ContentStatsBar stats={resolvedStats} />
        {sections.length > 1 ? (
          <div className="react-chat-session-debug-system-mode" role="group" aria-label={tr('chatUi.dbgSystemViewAria')}>
            <button
              type="button"
              className={showSections ? 'is-active' : ''}
              onClick={() => setMode('sections')}
            >
              {tr('chatUi.dbgSectionsMode', { count: sections.length })}
            </button>
            <button
              type="button"
              className={!showSections ? 'is-active' : ''}
              onClick={() => setMode('full')}
            >
              {tr('chatUi.dbgFullText')}
            </button>
          </div>
        ) : null}
      </div>
      {showSections ? (
        <div className="react-chat-session-debug-system-sections">
          {sections.map((sec) => {
            const open = Boolean(openIds[sec.id])
            const short = estimateTextStats(sec.text)
            return (
              <section key={sec.id} className="react-chat-session-debug-system-section">
                <button
                  type="button"
                  className={`react-chat-session-debug-system-section-head${open ? ' is-open' : ''}`}
                  aria-expanded={open}
                  onClick={() =>
                    setOpenIds((prev) => ({ ...prev, [sec.id]: !prev[sec.id] }))
                  }
                >
                  <span className="react-chat-session-debug-system-section-title">
                    {sec.label}
                    {sec.tag && !sec.tag.startsWith('_') ? (
                      <code className="react-chat-session-debug-system-section-tag">&lt;{sec.tag}&gt;</code>
                    ) : null}
                  </span>
                  <span className="react-chat-session-debug-system-section-meta">
                    {short ? fmtContentStatsShort(short) : ''}
                  </span>
                </button>
                {open ? (
                  <pre className="react-chat-session-debug-modal-pre react-chat-session-debug-modal-pre--compact">
                    {sec.text}
                  </pre>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : (
        <pre className="react-chat-session-debug-modal-pre react-chat-session-debug-modal-pre--fill">
          {text}
        </pre>
      )}
    </div>
  )
}

function DebugToolsPanel({
  toolStats,
  toolNames,
  loading,
}: {
  toolStats: ToolContentStat[]
  toolNames: string[]
  loading: boolean
}) {
  const tr = useT()
  const rows = useMemo(() => {
    if (toolStats.length) {
      return [...toolStats].sort((a, b) => b.tokens - a.tokens)
    }
    return toolNames.map((name) => ({
      name,
      chars: 0,
      tokens: 0,
      estimated: false as const,
    }))
  }, [toolStats, toolNames])

  const total = useMemo(() => {
    if (!toolStats.length) return null
    return {
      chars: toolStats.reduce((sum, row) => sum + row.chars, 0),
      tokens: toolStats.reduce((sum, row) => sum + row.tokens, 0),
    }
  }, [toolStats])

  if (!rows.length) {
    return (
      <div className="react-chat-session-debug-modal-empty">
        {loading ? tr('chatUi.loadingEllipsis') : tr('chatUi.dbgNoToolsMounted')}
      </div>
    )
  }

  return (
    <div className="react-chat-session-debug-modal-tools-panel">
      {total ? (
        <ContentStatsBar stats={total} label={tr('chatUi.dbgToolsTotalLabel')} />
      ) : (
        <div className="obs-content-stats-bar obs-content-stats-bar--muted">
          {tr('chatUi.dbgToolsLegacyNote')}
        </div>
      )}
      <div className="react-chat-session-debug-modal-tools-table-wrap">
        <table className="react-chat-session-debug-modal-tools-table">
          <thead>
            <tr>
              <th>{tr('chatUi.dbgColTool')}</th>
              <th>{tr('chatUi.dbgColChars')}</th>
              <th>{tr('chatUi.dbgColTokenEst')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="react-chat-session-debug-modal-tools-name">{row.name}</td>
                <td className="react-chat-session-debug-modal-tools-num">
                  {toolStats.length ? row.chars.toLocaleString() : '—'}
                </td>
                <td className="react-chat-session-debug-modal-tools-num">
                  {toolStats.length ? `~${row.tokens.toLocaleString()}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function tabLabel(
  base: string,
  stats: ContentStats | null | undefined,
  tokenOverride?: number | null,
): string {
  const tok =
    typeof tokenOverride === 'number' && Number.isFinite(tokenOverride)
      ? tokenOverride
      : stats?.tokens
  const short = tok != null ? fmtContentStatsShort({ chars: 0, tokens: tok }) : ''
  return short ? `${base} (${short})` : base
}

function SessionDebugCallModalInner({
  request,
  onClose,
}: {
  request: RequestRecord
  onClose: () => void
}) {
  // 文案函数用 tr：本组件内 `t` 被 tabs.some 等回调参数占用，避免遮蔽
  const tr = useT()
  const [tab, setTab] = useState<ModalTab>('assistant')
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  const promptViews = useMemo(
    () => parseRequestViews(detail?.request_json),
    [detail?.request_json],
  )
  const responseViews = useMemo(
    () => parseResponseViews(detail?.response_json),
    [detail?.response_json],
  )
  const failureMessage = useMemo(
    () => resolveFailureMessage(request, detail, responseViews),
    [request, detail, responseViews],
  )

  const toolNames = promptViews?.requestToolNames ?? []
  const toolStats = promptViews?.requestToolStats ?? []
  const toolCalls = responseViews?.toolCalls ?? []
  const hasUsage = detail?.usage_json != null

  const assistantText =
    responseViews?.assistantContent?.trim() ||
    (responseViews?.reasoningContent?.trim()
      ? `[Thinking]\n${responseViews.reasoningContent.trim()}`
      : '') ||
    request.replyPreview?.trim() ||
    ''

  const assistantStats = resolveContentStats(
    responseViews?.assistantStats,
    assistantText,
  )
  const systemStats = resolveContentStats(
    promptViews?.systemPromptStats,
    promptViews?.systemPrompt,
  )
  const userStats = resolveContentStats(
    promptViews?.userLatestStats,
    promptViews?.userLatest,
  )

  const tabs = useMemo(() => {
    const items: { id: ModalTab; label: string }[] = [
      {
        id: 'tools',
        label: tabLabel(tr('chatUi.wpStatTool'), null, promptViews?.requestToolsTokensTotal),
      },
      {
        id: 'system',
        label: tabLabel(tr('chatUi.dbgTabSystem'), systemStats),
      },
      {
        id: 'user',
        label: tabLabel(tr('chatUi.dbgTabUser'), userStats),
      },
      {
        id: 'assistant',
        label: tabLabel(tr('chatUi.dbgTabAssistant'), assistantStats),
      },
    ]
    if (toolCalls.length > 0) {
      items.push({ id: 'tool_calls', label: tr('chatUi.dbgTabToolCalls', { count: toolCalls.length }) })
    }
    items.push({ id: 'request', label: tr('chatUi.dbgTabRequest') })
    items.push({ id: 'response', label: tr('chatUi.dbgTabResponse') })
    if (hasUsage) {
      items.push({ id: 'usage', label: tr('chatUi.dbgTabUsage') })
    }
    return items
  }, [
    assistantStats,
    hasUsage,
    promptViews?.requestToolsTokensTotal,
    systemStats,
    toolCalls.length,
    tr,
    userStats,
  ])

  useEffect(() => {
    queueMicrotask(() => setTab('assistant'))
  }, [request.id])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      setLoading(true)
      void fetchObsModelDetail(request.id)
        .then((row) => {
          if (!cancelled) setDetail(row)
        })
        .catch(() => {
          if (!cancelled) setDetail(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [request.id])

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) {
      queueMicrotask(() => setTab('assistant'))
    }
  }, [tab, tabs])

  const statusLabel =
    request.status === 'failed'
      ? tr('chatUi.failedLabel')
      : request.status === 'warning'
        ? tr('chatUi.dbgStatusWarning')
        : tr('chatUi.dbgStatusSuccess')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const renderTabBody = () => {
    if (loading && tab !== 'tools') {
      return <div className="react-chat-session-debug-modal-empty">{tr('chatUi.dbgLoadingDetail')}</div>
    }

    switch (tab) {
      case 'tools':
        return (
          <DebugToolsPanel
            toolStats={toolStats}
            toolNames={toolNames}
            loading={loading}
          />
        )

      case 'system':
        return (
          <DebugSystemPromptPanel
            value={promptViews?.systemPrompt}
            stats={promptViews?.systemPromptStats}
            emptyHint={loading ? tr('chatUi.loadingEllipsis') : tr('chatUi.dbgNoSystemPrompt')}
          />
        )

      case 'user':
        return (
          <DebugTextPanel
            value={promptViews?.userLatest}
            stats={promptViews?.userLatestStats}
            emptyHint={loading ? tr('chatUi.loadingEllipsis') : tr('chatUi.dbgNoUserMessage')}
          />
        )

      case 'assistant':
        return (
          <div className="react-chat-session-debug-modal-stack">
            <DebugTextPanel
              value={assistantText}
              stats={responseViews?.assistantStats}
              emptyHint={
                loading
                  ? tr('chatUi.loadingEllipsis')
                  : failureMessage || responseViews?.truncationNote || tr('chatUi.dbgNoReply')
              }
            />
            {responseViews?.reasoningContent?.trim() ? (
              <section className="react-chat-session-debug-modal-section react-chat-session-debug-modal-section--inline">
                <div className="react-chat-session-debug-modal-section-title">
                  Thinking
                  {responseViews.reasoningStats
                    ? ` · ${fmtContentStats(responseViews.reasoningStats)}`
                    : ''}
                </div>
                <pre className="react-chat-session-debug-modal-pre react-chat-session-debug-modal-pre--compact">
                  {responseViews.reasoningContent.trim()}
                </pre>
              </section>
            ) : null}
            {failureMessage ? (
              <section className="react-chat-session-debug-modal-section react-chat-session-debug-modal-section--inline">
                <div className="react-chat-session-debug-modal-section-title">
                  {tr('chatUi.dbgFailureTitle')}
                  {estimateTextStats(failureMessage)
                    ? ` · ${fmtContentStats(estimateTextStats(failureMessage))}`
                    : ''}
                </div>
                <pre className="react-chat-session-debug-modal-pre react-chat-session-debug-modal-pre--compact">
                  {failureMessage}
                </pre>
              </section>
            ) : null}
            {responseViews?.truncationNote && !failureMessage ? (
              <section className="react-chat-session-debug-modal-section react-chat-session-debug-modal-section--inline">
                <div className="react-chat-session-debug-modal-section-title">{tr('chatUi.dbgTruncationTitle')}</div>
                <pre className="react-chat-session-debug-modal-pre react-chat-session-debug-modal-pre--compact">
                  {responseViews.truncationNote}
                </pre>
              </section>
            ) : null}
          </div>
        )

      case 'tool_calls':
        return (
          <div className="react-chat-session-debug-modal-tool-calls react-chat-session-debug-modal-tool-calls--panel">
            {toolCalls.map((tool, index) => {
              const argsText = formatJsonText(tool.arguments ?? tool.raw) || '—'
              const argsStats = estimateTextStats(argsText)
              return (
                <div key={`${tool.id}-${index}`} className="react-chat-session-debug-modal-tool-call">
                  <div className="react-chat-session-debug-modal-tool-call-name">
                    {tool.name}
                    {argsStats ? ` · ${fmtContentStats(argsStats)}` : ''}
                  </div>
                  <pre className="react-chat-session-debug-modal-pre">{argsText}</pre>
                </div>
              )
            })}
          </div>
        )

      case 'request':
        return (
          <JsonViewer
            title=""
            layout="panel"
            value={detail?.request_json ?? promptViews?.raw}
            emptyHint={loading ? tr('chatUi.loadingEllipsis') : tr('chatUi.dbgNoRequest')}
          />
        )

      case 'response':
        return (
          <JsonViewer
            title=""
            layout="panel"
            value={detail?.response_json ?? responseViews?.raw}
            emptyHint={loading ? tr('chatUi.loadingEllipsis') : tr('chatUi.dbgNoResponse')}
          />
        )

      case 'usage':
        return (
          <JsonViewer
            title=""
            layout="panel"
            value={detail?.usage_json}
            emptyHint={loading ? tr('chatUi.loadingEllipsis') : tr('chatUi.dbgNoUsage')}
          />
        )

      default:
        return null
    }
  }

  return createPortal(
    <div
      className="react-chat-session-debug-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="react-chat-session-debug-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('chatUi.dbgModalAria')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="react-chat-session-debug-modal-header">
          <div className="react-chat-session-debug-modal-header-main">
            <h3>
              {request.modelCallSeq != null ? `#${request.modelCallSeq} · ` : ''}
              {request.model}
            </h3>
            <p>
              <span className={`react-chat-session-debug-modal-status is-${request.status}`}>
                {statusLabel}
              </span>
              <span>{request.relativeTime || request.time}</span>
              <span>{request.latency}</span>
              <span title={requestTokenTitle(request)}>
                {fmtUsageTok(request.promptTokens)} / {fmtUsageTok(request.completionTokens)} tok
              </span>
              {request.cacheReadTokens ? (
                <span title={requestTokenTitle(request)}>
                  {tr('chatUi.dbgCache', { n: fmtCacheHitTok(request.cacheReadTokens, request.cacheMissTokens) })}
                </span>
              ) : null}
              {request.totalCycleMs ? (
                <span
                  title={tr('chatUi.dbgCycleTitle', {
                    latency: request.latency,
                    overhead: fmtMs(Math.max(0, request.totalCycleMs - request.latencyMs)),
                  })}
                >
                  {tr('chatUi.dbgCycleLabel', { cycle: request.totalCycle })}
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="react-chat-session-debug-modal-close"
            aria-label={tr('chatUi.closeAria')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="react-chat-session-debug-modal-tabs" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`react-chat-session-debug-modal-tab${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="react-chat-session-debug-modal-body">
          <div className="react-chat-session-debug-modal-tab-panel">{renderTabBody()}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export const SessionDebugCallModal = memo(SessionDebugCallModalInner)
