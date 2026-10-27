import {
  fmtContentStats,
  type ContentStats,
} from '../lib/obs-text-stats'
import { useT } from '../../lib/useI18n'

export function ContentStatsBar({
  stats,
  label,
}: {
  stats: ContentStats | null | undefined
  label?: string
}) {
  const t = useT() // 局部遮蔽
  if (!stats) return null
  const text = fmtContentStats(stats)
  if (!text) return null
  const title = label || t('obs.obsContentStatsTitle')
  return (
    <div className="obs-content-stats-bar" title={title}>
      {label ? <span className="obs-content-stats-bar-label">{label}</span> : null}
      <span className="obs-content-stats-bar-value">{text}</span>
    </div>
  )
}
