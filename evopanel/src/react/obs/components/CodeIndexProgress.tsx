import type { CodeIndexStatus } from '../types/code-index'
import { useT } from '../../lib/useI18n'

export function CodeIndexProgress({
  status,
  building,
}: {
  status: CodeIndexStatus | null
  building: boolean
}) {
  const t = useT() // 局部遮蔽

  const isBuilding = building || !!status?.building
  const pct = status?.build_progress_pct
  const total = status?.build_total_files
  const done = status?.build_indexed_files
  const files = status?.files
  const symbols = status?.symbols
  const phase = status?.build_phase || (isBuilding ? 'indexing' : '')
  const updatedLabel = formatUpdatedAt(status?.updated_at)

  // statusLabel 渲染期组装，以便切换语言时更新
  const stLabel =
    isBuilding || status?.building
      ? t('obs.obsStatusBuilding')
      : status?.ready
        ? t('obs.obsStatusReady')
        : status?.status === 'scheduled'
          ? t('obs.obsStatusQueued')
          : t('obs.obsStatusNotReady')

  const progressWidth =
    pct != null ? `${Math.min(100, Math.max(0, pct))}%` : isBuilding ? '12%' : status?.ready ? '100%' : '0%'

  return (
    <div className="code-index-progress-card">
      <div className="code-index-progress-header">
        <span className="code-index-progress-title">{t('obs.obsIdxStatusTitle')}</span>
        <span className={`code-index-progress-badge ${isBuilding ? 'building' : status?.ready ? 'ready' : 'idle'}`}>
          {stLabel}
        </span>
      </div>
      <div className="code-index-progress-bar-track">
        <div
          className={`code-index-progress-bar-fill ${isBuilding && pct == null ? 'indeterminate' : ''}`}
          style={{ width: progressWidth }}
        />
      </div>
      <div className="code-index-progress-stats">
        {isBuilding && total != null && total > 0 ? (
          <span>
            {t('obs.obsIdxProgressLabel')} <strong>{done ?? 0}</strong> / <strong>{total}</strong> {t('obs.obsIdxSymbols')}
            {pct != null ? `（${pct}%）` : ''}
          </span>
        ) : (
          <span>
            {t('obs.obsIdxIndexedFiles', { count: files ?? 0 })}
            {symbols != null ? (
              <>
                {' '}
                · <strong>{symbols}</strong> {t('obs.obsIdxSymbols')}
              </>
            ) : null}
          </span>
        )}
        {updatedLabel ? <span className="code-index-progress-phase">{t('obs.obsIdxUpdatedAt', { time: updatedLabel })}</span> : null}
        {phase ? <span className="code-index-progress-phase">{t('obs.obsIdxPhase', { phase })}</span> : null}
      </div>
    </div>
  )
}

function formatUpdatedAt(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
