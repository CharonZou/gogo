import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/tauri-api.js'
import { useT } from '../lib/useI18n'

type Hit = {
  id?: string
  content?: string
  layer?: string
  kind?: string
  namespace_id?: string
}

type Snapshot = {
  hit_count?: number
  hits?: Hit[]
  standing_preview?: string
  query?: string
  updated_at?: string
}

type Props = {
  threadId?: string | null
  /** Bump after each assistant turn to refresh */
  refreshKey?: number | string
}

/** Chat transparency: 「用了 N 条记忆」— default on (Phase C). */
const SHOW_MEMORY_RECALL_CHIP = true

/**
 * Chat transparency chip: 「用了 N 条记忆」→ read-only drawer.
 */
export function MemoryRecallChip({ threadId, refreshKey = 0 }: Props) {
  const tr = useT()
  const tid = String(threadId || '').trim()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!SHOW_MEMORY_RECALL_CHIP || !tid) {
      setSnap(null)
      return
    }
    try {
      const data = await api.getMemoryRecallSnapshot(tid)
      setSnap(data || null)
    } catch {
      setSnap(null)
    }
  }, [tid])

  useEffect(() => {
    if (!SHOW_MEMORY_RECALL_CHIP) return
    void load()
  }, [load, refreshKey])

  if (!SHOW_MEMORY_RECALL_CHIP) return null

  const hits = Array.isArray(snap?.hits) ? snap!.hits! : []
  const standing = String(snap?.standing_preview || '').trim()
  const n = Number(snap?.hit_count || hits.length || 0)
  const hasStanding = !!standing
  if (!tid || (!n && !hasStanding)) return null

  const label =
    n > 0 ? tr('chatUi.memoriesUsed', { count: n }) : tr('chatUi.standingMemoryInjected')

  return (
    <div className="memory-recall-chip-wrap">
      <button
        type="button"
        className={`memory-recall-chip${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={tr('chatUi.memoryRecallTitle')}
      >
        {label}
      </button>
      {open ? (
        <div className="memory-recall-drawer" role="dialog" aria-label={tr('chatUi.memoryRecallAria')}>
          <div className="memory-recall-drawer__head">
            <strong>{tr('chatUi.memoryRecallAria')}</strong>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>
              {tr('chatUi.close')}
            </button>
          </div>
          {snap?.query ? (
            <p className="memory-muted">{tr('chatUi.memoryQueryPrefix', { query: snap.query })}</p>
          ) : null}
          {hasStanding ? (
            <div className="memory-recall-drawer__block">
              <h5>{tr('chatUi.standingCoreSummary')}</h5>
              <pre className="memory-recall-drawer__pre">{standing}</pre>
            </div>
          ) : null}
          {hits.length ? (
            <ul className="memory-recall-drawer__list">
              {hits.map((h, i) => (
                <li key={h.id || `${i}-${h.content?.slice(0, 24)}`}>
                  <div className="memory-fact-meta">
                    <span className="memory-fact-tag">{h.layer || h.kind || 'memory'}</span>
                    {h.namespace_id ? <span className="memory-fact-meta-item">{h.namespace_id}</span> : null}
                  </div>
                  <p>{h.content}</p>
                  {h.id ? (
                    <a className="memory-recall-drawer__link" href={`#/assets?tab=memory`} title={tr('chatUi.openAssetCenter')}>
                      {tr('chatUi.viewInAssetCenter')}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="memory-muted">{tr('chatUi.noArchivalRecall')}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
