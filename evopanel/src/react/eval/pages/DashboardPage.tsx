import { useState } from 'react'
import { useT } from '../../lib/useI18n'
import { evalApi, pollRunUntilDone } from '../api/evalApi'
import { useAsync } from '../hooks/useAsync'

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'primary' | 'green' | 'accent'
}) {
  return (
    <div className="eval-metric">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  )
}

export function DashboardPage({ onNavigate }: { onNavigate?: (k: string) => void }) {
  const t = useT()
  const summary = useAsync(() => evalApi.dashboardSummary(7), [])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [runMsg, setRunMsg] = useState('')

  const s = summary.data || {}
  const dim = s.dimensionScores || s.dimension_scores || {}
  const scenarioRate = s.scenarioPassRate ?? s.scenario_pass_rate
  const health = s.healthScore ?? s.health_score ?? 0
  const completion = s.taskCompletionRate ?? s.task_completion_rate ?? 0
  const toolOk = s.toolSuccessRate ?? s.tool_success_rate ?? 0
  const sec = s.securityScore ?? s.security_score ?? 0
  const latency = s.avgResponseLatencyMs ?? s.avg_response_latency_ms ?? 0
  const agents = s.activeAgents ?? s.active_agents ?? 0
  const alerts = s.alerts || []
  const ranking = s.agentsRanking || s.agents_ranking || []
  const recent = s.recentEvaluations || s.recent_evaluations || []
  const obs = s.observability || {}

  async function runSmoke() {
    setRunning(true)
    setProgress(0)
    setRunMsg(t('eval.evalRunStartSmoke'))
    try {
      const started = await evalApi.startRun({
        // 注意：name 是 API payload，按铁律不改中文（后端可能依赖文案匹配）
        name: '一键评测 smoke',
        mode: 'smoke',
        async_mode: true,
      })
      const runId = started.run_id || started.runId
      if (!runId) throw new Error(t('eval.evalNoRunId'))
      const detail = await pollRunUntilDone(runId, (p) => {
        setProgress(Number(p.progress || 0))
        setRunMsg(t('eval.evalRunProgress', { passed: p.passed_cases || 0, total: p.total_cases || '?' }))
      })
      const st = detail?.run?.status || detail?.status || 'done'
      setRunMsg(t('eval.evalRunDone', { status: st }))
      summary.reload()
      onNavigate?.('history')
    } catch (e: any) {
      setRunMsg(String(e?.message || e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <div className="eval-hero">
        <div>
          <h2>{t('eval.evalDashboardTitle')}</h2>
          <p>{t('eval.evalDashboardHeroSub')}</p>
        </div>
        <div className="eval-actions">
          <button type="button" className="eval-btn outline" onClick={() => summary.reload()} disabled={running}>
            {t('eval.evalBtnRefresh')}
          </button>
          <button type="button" className="eval-btn primary" onClick={runSmoke} disabled={running}>
            {running ? t('eval.evalBtnRunning') : t('eval.evalBtnRunSmoke')}
          </button>
        </div>
      </div>

      <div className="eval-guide-row">
        <button type="button" className="eval-guide-card" onClick={() => onNavigate?.('employees')}>
          <strong>{t('eval.evalGuideEmpStrong')}</strong>
          <span>{t('eval.evalGuideEmpSpan')}</span>
        </button>
        <button type="button" className="eval-guide-card" onClick={() => onNavigate?.('workflow')}>
          <strong>{t('eval.evalGuideWfStrong')}</strong>
          <span>{t('eval.evalGuideWfSpan')}</span>
        </button>
        <button type="button" className="eval-guide-card" onClick={() => onNavigate?.('history')}>
          <strong>{t('eval.evalGuideHistStrong')}</strong>
          <span>{t('eval.evalGuideHistSpan')}</span>
        </button>
      </div>

      {summary.error ? <div className="eval-error">{summary.error}</div> : null}
      {runMsg ? <div className="eval-muted" style={{ marginBottom: 8 }}>{runMsg}</div> : null}
      {progress !== null ? (
        <div className="eval-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {summary.loading && !summary.data ? (
        <p className="eval-muted">{t('eval.evalLoading')}</p>
      ) : (
        <>
          <div className="eval-metrics">
            <Metric label={t('eval.evalMetricHealth')} value={`${Math.round(Number(health))}/100`} tone="primary" />
            <Metric
              label={t('eval.evalMetricScenarioRate')}
              value={scenarioRate == null ? '—' : `${(Number(scenarioRate) * 100).toFixed(0)}%`}
              hint={t('eval.evalMetricScenarioHint')}
              tone="green"
            />
            <Metric label={t('eval.evalMetricTaskRate')} value={`${(Number(completion) * 100).toFixed(1)}%`} />
            <Metric label={t('eval.evalMetricSecurity')} value={`${Math.round(Number(sec))}/100`} />
            <Metric label={t('eval.evalMetricToolRate')} value={`${(Number(toolOk) * 100).toFixed(1)}%`} tone="green" />
            <Metric label={t('eval.evalMetricLatency')} value={`${(Number(latency) / 1000).toFixed(1)}s`} />
            <Metric label={t('eval.evalMetricAgent')} value={String(agents)} tone="primary" />
            <Metric
              label={t('eval.evalMetricObsThread')}
              value={obs.thread_health != null ? String(Math.round(Number(obs.thread_health))) : '—'}
              hint={obs.invalid_tool_rate != null ? t('eval.evalMetricObsHint', { rate: obs.invalid_tool_rate }) : undefined}
            />
          </div>

          <div className="eval-grid-2">
            <div className="eval-card">
              <h3>{t('eval.evalDimScore')}</h3>
              <table className="eval-table">
                <tbody>
                  {Object.entries(dim).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{Math.round(Number(v))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="eval-card">
              <h3>{t('eval.evalKeyAlert')}</h3>
              {alerts.length === 0 ? (
                <p className="eval-muted">{t('eval.evalNoAlert')}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {alerts.map((a: any, i: number) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <span className={`eval-badge ${a.level === 'error' ? 'fail' : 'warn'}`}>{a.level}</span>{' '}
                      {a.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="eval-grid-2">
            <div className="eval-card">
              <h3>{t('eval.evalAgentRank')}</h3>
              {ranking.length === 0 ? (
                <p className="eval-muted">{t('eval.evalNoRank')}</p>
              ) : (
                <table className="eval-table">
                  <thead>
                    <tr>
                      <th>{t('eval.evalThAgent')}</th>
                      <th>{t('eval.evalThTask')}</th>
                      <th>{t('eval.evalThCompletion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r: any) => (
                      <tr key={r.agent}>
                        <td>{r.agent}</td>
                        <td>{r.tasks}</td>
                        <td>{((r.completion_rate ?? r.completionRate ?? 0) * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="eval-card">
              <h3>{t('eval.evalRecentEval')}</h3>
              {recent.length === 0 ? (
                <p className="eval-muted">{t('eval.evalNoRecent')}</p>
              ) : (
                <table className="eval-table">
                  <thead>
                    <tr>
                      <th>{t('eval.evalThName')}</th>
                      <th>{t('eval.evalThScore')}</th>
                      <th>{t('eval.evalThStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r: any) => (
                      <tr key={r.id}>
                        <td>{r.name || r.dimension}</td>
                        <td>{r.score}</td>
                        <td>
                          <span className={`eval-badge ${String(r.status).includes('fail') ? 'fail' : 'ok'}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
