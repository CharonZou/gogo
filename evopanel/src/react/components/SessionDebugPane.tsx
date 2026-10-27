import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/tauri-api.js'
import { apiModelListRowToRequestRecord } from '../obs/data/adapter.js'
import { fetchObsModels } from '../obs/lib/obs-api.js'
import {
  fmtCacheHitTok,
  fmtUsageTok,
  requestTokenTitle,
} from '../obs/lib/obs-formatters.js'
import type { RequestRecord } from '../obs/types/index.js'
import {
  buildRunIdToChatSeq,
  fmtSessionDebugClock,
  groupCallsByTurn,
} from '../lib/session-debug-turn-groups.js'
import { SessionDebugCallModal } from './SessionDebugCallModal.js'
import { t } from '../../lib/i18n.js'
import { useT } from '../lib/useI18n'

function replyKindLabel(row: RequestRecord): string {
  if (row.status === 'failed') return t('chatUi.failedLabel')
  if (row.status === 'warning') return t('chatUi.dbgStatusWarning')
  switch (row.replyKind) {
    case 'tool_call':
      return t('chatUi.wpStatTool')
    case 'tools_and_content':
      return t('chatUi.dbgKindToolText')
    case 'planning':
      return t('chatUi.dbgKindPlanning')
    case 'reason':
      return t('chatUi.dbgKindReason')
    default:
      return t('chatUi.dbgKindText')
  }
}

function statusTone(status: RequestRecord['status']): string {
  if (status === 'failed') return 'failed'
  if (status === 'warning') return 'warning'
  return 'success'
}

async function fetchThreadModelCalls(threadId: string): Promise<RequestRecord[]> {
  const res = (await fetchObsModels({
    threadId,
    page: 1,
    pageSize: 100,
    timeRange: 'all',
  })) as { enabled?: boolean; items?: Record<string, unknown>[] }
  if (res?.enabled === false) return []
  const items = res?.items
  if (!Array.isArray(items)) return []
  return items.map((row) => apiModelListRowToRequestRecord(row))
}

async function fetchThreadChatSeqByRun(threadId: string): Promise<Map<string, number>> {
  try {
    const res = (await api.chatMessagesByThread(threadId, 2000)) as {
      messages?: unknown[]
    }
    return buildRunIdToChatSeq(Array.isArray(res?.messages) ? res.messages : [])
  } catch {
    return new Map()
  }
}

function SessionDebugPaneInner({
  threadId,
  isRunning = false,
}: {
  threadId: string
  isRunning?: boolean
}) {
  const tr = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calls, setCalls] = useState<RequestRecord[]>([])
  const [runIdToChatSeq, setRunIdToChatSeq] = useState<Map<string, number>>(() => new Map())
  const [selected, setSelected] = useState<RequestRecord | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  const tid = String(threadId || '').trim()

  const reload = useCallback(async (silent = false) => {
    if (!tid) {
      setCalls([])
      setRunIdToChatSeq(new Map())
      setError(null)
      return
    }
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [rows, seqMap] = await Promise.all([
        fetchThreadModelCalls(tid),
        fetchThreadChatSeqByRun(tid),
      ])
      setCalls(rows)
      setRunIdToChatSeq(seqMap)
    } catch (err) {
      setCalls([])
      setRunIdToChatSeq(new Map())
      setError(String((err as Error)?.message || err || t('chatUi.loadFailed')))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [tid])

  useEffect(() => {
    void reload(false)
  }, [reload])

  useEffect(() => {
    if (!tid) return
    const pollMs = isRunning ? 4000 : 15000
    const timer = setInterval(() => {
      void reload(true)
    }, pollMs)
    return () => clearInterval(timer)
  }, [tid, isRunning, reload])

  const turnGroups = useMemo(
    () => groupCallsByTurn(calls, runIdToChatSeq),
    [calls, runIdToChatSeq],
  )

  useEffect(() => {
    if (!turnGroups.length) {
      setExpandedRunId(null)
      return
    }
    setExpandedRunId((prev) => {
      if (prev && turnGroups.some((g) => g.runId === prev)) return prev
      return turnGroups[0]?.runId ?? null
    })
  }, [turnGroups])

  if (!tid) {
    return (
      <div className="react-chat-session-debug-empty">
        {tr('chatUi.dbgPaneEmptyNoThread')}
      </div>
    )
  }

  return (
    <>
      <div className="react-chat-session-debug">
        <div className="react-chat-session-debug-meta">
          <span className="react-chat-session-debug-meta-label">Thread</span>
          <code className="react-chat-session-debug-meta-value" title={tid}>
            {tid}
          </code>
          <button
            type="button"
            className="react-chat-info-rail-action"
            title={tr('chatUi.dbgCopyThreadTitle')}
            onClick={() => {
              void navigator.clipboard?.writeText(tid).catch(() => {})
            }}
          >
            {tr('chatUi.copy')}
          </button>
          <button type="button" className="react-chat-info-rail-action" onClick={() => void reload(false)}>
            {tr('chatUi.dbgRefresh')}
          </button>
        </div>

        {loading && !calls.length ? (
          <div className="react-chat-session-debug-empty">{tr('chatUi.dbgLoadingCalls')}</div>
        ) : null}
        {error ? <div className="react-chat-session-debug-error">{error}</div> : null}
        {!loading && !error && !calls.length ? (
          <div className="react-chat-session-debug-empty">
            {tr('chatUi.dbgPaneEmpty')}
          </div>
        ) : null}

        {turnGroups.length ? (
          <div className="react-chat-session-debug-turns">
            <div className="react-chat-session-debug-table-wrap">
              <table className="react-chat-session-debug-table">
                <thead>
                  <tr>
                    <th>{tr('chatUi.dbgColTurn')}</th>
                    <th>#</th>
                    <th>{tr('chatUi.dbgColTime')}</th>
                    <th>{tr('chatUi.wpStatModel')}</th>
                    <th>{tr('chatUi.dbgColKind')}</th>
                    <th>{tr('chatUi.dbgColLatency')}</th>
                    <th>Token</th>
                    <th>{tr('chatUi.preview')}</th>
                  </tr>
                </thead>
                <tbody>
                  {turnGroups.flatMap((group) =>
                    group.calls.map((row, idx) => (
                      <tr
                        key={row.id}
                        className={`is-${statusTone(row.status)}`}
                        onClick={() => setSelected(row)}
                        title={tr('chatUi.dbgRowTitle')}
                      >
                        <td>{idx === 0 ? group.title : ''}</td>
                        <td>{row.modelCallSeq != null ? `#${row.modelCallSeq}` : '—'}</td>
                        <td title={row.time && row.time !== '—' ? row.time : undefined}>
                          {fmtSessionDebugClock(row.occurredAt, row.time)}
                        </td>
                        <td>{row.model || '—'}</td>
                        <td>{replyKindLabel(row)}</td>
                        <td>{row.latency || '—'}</td>
                        <td title={requestTokenTitle(row)}>
                          {fmtUsageTok(row.promptTokens)} / {fmtUsageTok(row.completionTokens)}
                          {row.cacheReadTokens
                            ? tr('chatUi.dbgCachePrefix', {
                                n: fmtCacheHitTok(row.cacheReadTokens, row.cacheMissTokens),
                              })
                            : ''}
                        </td>
                        <td className="react-chat-session-debug-table-preview">
                          {row.replyPreview || row.failureMessage || '—'}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            {turnGroups.map((group) => {
              const expanded = expandedRunId === group.runId
              return (
                <section key={group.runId} className="react-chat-session-debug-turn">
                  <button
                    type="button"
                    className={`react-chat-session-debug-turn-head${expanded ? ' is-open' : ''}`}
                    aria-expanded={expanded}
                    title={[group.titleHint, group.timeHint].filter(Boolean).join(' · ') || undefined}
                    onClick={() =>
                      setExpandedRunId((prev) => (prev === group.runId ? null : group.runId))
                    }
                  >
                    <span className="react-chat-session-debug-turn-title">
                      {group.title}
                      <span className="react-chat-session-debug-turn-clock">{group.timeLabel}</span>
                    </span>
                    <span className="react-chat-session-debug-turn-meta">
                      {tr('chatUi.dbgCallCount', { count: group.calls.length })}
                      {group.relativeLabel && group.relativeLabel !== '—'
                        ? ` · ${group.relativeLabel}`
                        : ''}
                    </span>
                  </button>
                  {expanded ? (
                    <ul className="react-chat-session-debug-call-list">
                      {group.calls.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="react-chat-session-debug-call-btn"
                            onClick={() => setSelected(row)}
                          >
                            <span className={`react-chat-session-debug-status is-${statusTone(row.status)}`} />
                            <span className="react-chat-session-debug-call-main">
                              <span className="react-chat-session-debug-call-title">
                                {row.modelCallSeq != null ? `#${row.modelCallSeq} · ` : ''}
                                {row.model}
                              </span>
                              <span className="react-chat-session-debug-call-sub">
                                {replyKindLabel(row)}
                                {row.payloadMessageCount != null
                                  ? tr('chatUi.dbgMsgCount', { count: row.payloadMessageCount })
                                  : ''}
                                {row.thinkingLabel ? ` · ${row.thinkingLabel}` : ''}
                              </span>
                              {row.replyPreview ? (
                                <span className="react-chat-session-debug-call-preview" title={row.replyPreview}>
                                  {row.replyPreview}
                                </span>
                              ) : row.failureMessage ? (
                                <span
                                  className="react-chat-session-debug-call-preview is-error"
                                  title={row.failureMessage}
                                >
                                  {row.failureMessage}
                                </span>
                              ) : null}
                            </span>
                            <span className="react-chat-session-debug-call-stats">
                              <span
                                className="react-chat-session-debug-call-time"
                                title={row.time && row.time !== '—' ? row.time : undefined}
                              >
                                {fmtSessionDebugClock(row.occurredAt, row.time)}
                              </span>
                              <span>{row.latency}</span>
                              <span title={requestTokenTitle(row)}>
                                {fmtUsageTok(row.promptTokens)} / {fmtUsageTok(row.completionTokens)}
                              </span>
                              {row.cacheReadTokens ? (
                                <span title={requestTokenTitle(row)}>
                                  {tr('chatUi.dbgCache', {
                                    n: fmtCacheHitTok(row.cacheReadTokens, row.cacheMissTokens),
                                  })}
                                </span>
                              ) : null}
                              <span>{row.tokens.toLocaleString()} tok</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              )
            })}
          </div>
        ) : null}
      </div>

      {selected ? (
        <SessionDebugCallModal request={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  )
}

export const SessionDebugPane = memo(SessionDebugPaneInner)
