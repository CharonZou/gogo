import { OBS_TIME_RANGE_OPTIONS, type ObsStatusFilter } from '../lib/obs-types'
import { useObsContext } from '../hooks/ObsContext'
import { CustomSelect } from './CustomSelect'
import { useT } from '../../lib/useI18n'

export function TopFilterBar({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  const t = useT() // 局部遮蔽
  const obs = useObsContext()
  const timeLabel = OBS_TIME_RANGE_OPTIONS.find((o) => o.key === obs.timeRange)?.label ?? obs.timeRange
  const agentAllLabel = t('obs.obsCommonAll')

  const timeOptions = OBS_TIME_RANGE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))
  const agentOptions = [
    { value: 'all', label: agentAllLabel },
    ...obs.agents
      .map((agent) => {
        const value = agent.id || agent.name || ''
        if (!value) return null
        return { value, label: agent.display_name || agent.name || value }
      })
      .filter(Boolean) as { value: string; label: string }[],
    { value: 'main', label: 'main' }, // agent key 保留英文
  ]
  // 从最近的请求记录中提取唯一的 models 和 providers
  const recentRequests = obs.recentRequests || []
  const uniqueModels = Array.from(new Set(recentRequests.map(r => r.model).filter(Boolean)))
  const uniqueProviders = Array.from(new Set(recentRequests.map(r => r.provider).filter(Boolean)))

  const modelOptions = [
    { value: 'all', label: agentAllLabel },
    ...uniqueModels.map(m => ({ value: m, label: m })),
  ]
  const providerOptions = [
    { value: 'all', label: agentAllLabel },
    ...uniqueProviders.map(p => ({ value: p, label: p })),
  ]
  const statusOptions = [
    { value: 'all', label: agentAllLabel },
    { value: 'success', label: t('obs.obsStatusSuccess') },
    { value: 'warning', label: t('obs.obsStatusWarning') },
    { value: 'error', label: t('obs.obsStatusFailed') },
  ]

  return (
    <header className="topbar">
      <div className="topbar-head">
        <div className="page-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="filter-row">
        <CustomSelect
          className="filter-pill"
          value={obs.timeRange}
          onChange={(v) => obs.setTimeRange(v as typeof obs.timeRange)}
          options={timeOptions}
          label={t('obs.obsLabelTimeRange')}
        >
          <strong>{timeLabel}</strong>
        </CustomSelect>
        <CustomSelect
          className="filter-pill"
          value={obs.agentFilter}
          onChange={(v) => obs.setAgentFilter(v)}
          options={agentOptions}
          label={t('obs.obsLabelAgentType')}
        >
          <strong>{obs.agentFilter === 'all' ? agentAllLabel : obs.agentFilter}</strong>
        </CustomSelect>
        <CustomSelect
          className="filter-pill"
          value={obs.modelFilter}
          onChange={(v) => obs.setModelFilter(v)}
          options={modelOptions}
          label={t('obs.obsLabelModel')}
        >
          <strong>{obs.modelFilter === 'all' ? agentAllLabel : obs.modelFilter}</strong>
        </CustomSelect>
        <CustomSelect
          className="filter-pill"
          value={obs.providerFilter}
          onChange={(v) => obs.setProviderFilter(v)}
          options={providerOptions}
          label={t('obs.obsLabelProvider')}
        >
          <strong>{obs.providerFilter === 'all' ? agentAllLabel : obs.providerFilter}</strong>
        </CustomSelect>
        <CustomSelect
          className="filter-pill"
          value={obs.statusFilter}
          onChange={(v) => obs.setStatusFilter(v as ObsStatusFilter)}
          options={statusOptions}
          label={t('obs.obsLabelStatus')}
        >
          <strong>{obs.statusFilter === 'all' ? agentAllLabel : obs.statusFilter}</strong>
        </CustomSelect>
        <button type="button" className={`filter-pill refresh${obs.loading ? ' spinning' : ''}`} onClick={() => obs.reload()}>
          <i className="refresh-icon">↻</i><span>{t('obs.obsCommonRefresh')}</span>
        </button>
        {children ? <div className="filter-inline-search">{children}</div> : null}
      </div>
    </header>
  )
}
