import { useState, useCallback } from 'react'
import { X, Play, RotateCcw, Loader2, ChevronDown, ChevronRight, FileText, Code } from 'lucide-react'
import { MockInputEditor, type MockInputs } from './MockInputEditor.tsx'
import type { AppWorkflowStep } from '../../lib/app-workflow-plan.ts'
import { useT } from '../../lib/useI18n'

type DebugResult = {
  step_ref: string
  status: string
  output: Record<string, unknown> | null
  summary: string
  actual_prompt: string
  resolved_bindings: Record<string, unknown>
  extraction_source: string
  duration_ms: number
  error?: string
}

type TraceResult = {
  step_ref: string
  status: string
  actual_prompt: string
  resolved_bindings: Record<string, unknown>
  model_response: string
  structured_output: Record<string, unknown> | null
  schema_valid: boolean | null
  schema_errors: string[]
  artifacts: Array<Record<string, unknown>>
}

type Props = {
  appId: string
  selectedStep: AppWorkflowStep | null
  runId?: string
  parameters: Record<string, string>
  onClose: () => void
}

type Tab = 'run-step' | 'run-from' | 'trace'

/** Debug panel for single-step execution, run-from-step, and trace inspection. */
export function DebugPanel({
  appId,
  selectedStep,
  runId,
  parameters,
  onClose,
}: Props) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('run-step')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DebugResult | TraceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mockInputs, setMockInputs] = useState<MockInputs>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    prompt: false,
    output: true,
    bindings: false,
    response: false,
  })

  const stepRef = selectedStep?.ref || ''
  const upstreamRefs = selectedStep?.depends_on || []

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleRunStep = useCallback(async () => {
    if (!stepRef) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const { gatewayFetch } = await import('../../../lib/gateway-json.js')
      const resp = await gatewayFetch(`/api/apps/${appId}/debug/run-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_ref: stepRef,
          parameters,
          mock_inputs: Object.keys(mockInputs).length ? mockInputs : undefined,
          execution_mode: 'workflow',
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.detail || `HTTP ${resp.status}`)
      } else {
        setResult(data as DebugResult)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [appId, stepRef, parameters, mockInputs])

  const handleRunFrom = useCallback(async () => {
    if (!stepRef) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const { gatewayFetch } = await import('../../../lib/gateway-json.js')
      const resp = await gatewayFetch(`/api/apps/${appId}/debug/run-from`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_step_ref: stepRef,
          base_run_id: runId || undefined,
          parameters,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.detail || `HTTP ${resp.status}`)
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [appId, stepRef, runId, parameters])

  const handleTrace = useCallback(async () => {
    if (!stepRef || !runId) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const { gatewayFetch } = await import('../../../lib/gateway-json.js')
      const resp = await gatewayFetch(`/api/apps/runs/${runId}/steps/${stepRef}/trace`)
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.detail || `HTTP ${resp.status}`)
      } else {
        setResult(data as TraceResult)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [runId, stepRef])

  if (!selectedStep) {
    return (
      <div className="wf-debug-panel">
        <div className="wf-debug-panel-head">
          <h3>{t('workflow.debugTitle')}</h3>
          <button type="button" className="wf-debug-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="wf-debug-panel-body">
          <p className="wf-inspector-muted">{t('workflow.debugSelectHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wf-debug-panel">
      <div className="wf-debug-panel-head">
        <h3>{t('workflow.debugTitleStep', { ref: stepRef })}</h3>
        <button type="button" className="wf-debug-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="wf-debug-tabs">
        <button
          type="button"
          className={`wf-debug-tab${tab === 'run-step' ? ' is-active' : ''}`}
          onClick={() => setTab('run-step')}
        >
          {t('workflow.tabRunStep')}
        </button>
        <button
          type="button"
          className={`wf-debug-tab${tab === 'run-from' ? ' is-active' : ''}`}
          onClick={() => setTab('run-from')}
        >
          {t('workflow.tabRunFrom')}
        </button>
        <button
          type="button"
          className={`wf-debug-tab${tab === 'trace' ? ' is-active' : ''}`}
          onClick={() => setTab('trace')}
          disabled={!runId}
        >
          {t('workflow.tabTrace')}
        </button>
      </div>

      <div className="wf-debug-panel-body">
        {tab === 'run-step' && (
          <>
            <div className="wf-debug-section">
              <p className="wf-inspector-muted" style={{ fontSize: 12 }}>
                {t('workflow.runStepDescPre')}<strong>#{stepRef}</strong>{t('workflow.runStepDescPost')}
              </p>
            </div>

            {upstreamRefs.length > 0 ? (
              <div className="wf-debug-section">
                <h4 className="wf-inspector-block-title">{t('workflow.mockUpstreamTitle')}</h4>
                <MockInputEditor
                  upstreamRefs={upstreamRefs}
                  mockInputs={mockInputs}
                  onChange={setMockInputs}
                />
              </div>
            ) : null}

            <button
              type="button"
              className="wf-debug-run-btn"
              disabled={loading}
              onClick={handleRunStep}
            >
              {loading ? <Loader2 size={14} className="wf-spin" /> : <Play size={14} />}
              <span>{loading ? t('workflow.executing') : t('workflow.runThisStep')}</span>
            </button>

            {error ? <div className="wf-debug-error">{error}</div> : null}

            {result && tab === 'run-step' ? (
              <DebugResultView result={result as DebugResult} expandedSections={expandedSections} toggleSection={toggleSection} />
            ) : null}
          </>
        )}

        {tab === 'run-from' && (
          <>
            <div className="wf-debug-section">
              <p className="wf-inspector-muted" style={{ fontSize: 12 }}>
                {t('workflow.runFromDescPre')}<strong>#{stepRef}</strong>{t('workflow.runFromDescMid')}
                {runId ? t('workflow.runFromReuse', { run: runId.slice(0, 16) }) : t('workflow.runFromFresh')}
              </p>
            </div>

            <button
              type="button"
              className="wf-debug-run-btn"
              disabled={loading}
              onClick={handleRunFrom}
            >
              {loading ? <Loader2 size={14} className="wf-spin" /> : <RotateCcw size={14} />}
              <span>{loading ? t('workflow.creating') : t('workflow.tabRunFrom')}</span>
            </button>

            {error ? <div className="wf-debug-error">{error}</div> : null}

            {result && tab === 'run-from' && 'new_run_id' in result ? (
              <div className="wf-debug-result">
                <div className="wf-debug-result-row">
                  <span>{t('workflow.newRunId')}</span>
                  <code>{(result as Record<string, unknown>).new_run_id as string}</code>
                </div>
                <div className="wf-debug-result-row">
                  <span>{t('workflow.reusedSteps')}</span>
                  <span>{((result as Record<string, unknown>).reused_steps as string[])?.join(', ') || t('workflow.none')}</span>
                </div>
                <div className="wf-debug-result-row">
                  <span>{t('workflow.rerunSteps')}</span>
                  <span>{((result as Record<string, unknown>).rerun_steps as string[])?.join(', ') || t('workflow.none')}</span>
                </div>
              </div>
            ) : null}
          </>
        )}

        {tab === 'trace' && (
          <>
            <div className="wf-debug-section">
              <p className="wf-inspector-muted" style={{ fontSize: 12 }}>
                {t('workflow.traceDescPre')}<strong>#{stepRef}</strong>{t('workflow.traceDescMid')}{runId?.slice(0, 16)}{t('workflow.traceDescPost')}
              </p>
            </div>

            <button
              type="button"
              className="wf-debug-run-btn"
              disabled={loading || !runId}
              onClick={handleTrace}
            >
              {loading ? <Loader2 size={14} className="wf-spin" /> : <FileText size={14} />}
              <span>{loading ? t('workflow.loading') : t('workflow.loadTrace')}</span>
            </button>

            {error ? <div className="wf-debug-error">{error}</div> : null}

            {result && tab === 'trace' ? (
              <TraceResultView result={result as TraceResult} expandedSections={expandedSections} toggleSection={toggleSection} />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

// ── Result Views ───────────────────────────────────────────────────────

function SectionToggle({
  title,
  expanded,
  onToggle,
  icon,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  icon?: React.ReactNode
}) {
  return (
    <div className="wf-debug-section-toggle" onClick={onToggle}>
      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      {icon}
      <span>{title}</span>
    </div>
  )
}

function DebugResultView({
  result,
  expandedSections,
  toggleSection,
}: {
  result: DebugResult
  expandedSections: Record<string, boolean>
  toggleSection: (key: string) => void
}) {
  const t = useT()
  return (
    <div className="wf-debug-result">
      <div className="wf-debug-result-status">
        <span className={`wf-debug-status-badge wf-debug-status--${result.status}`}>
          {result.status}
        </span>
        <span className="wf-debug-duration">{result.duration_ms}ms</span>
        {result.extraction_source ? (
          <span className="wf-debug-source">{t('workflow.extraction', { source: result.extraction_source })}</span>
        ) : null}
      </div>

      {/* Actual Prompt */}
      <SectionToggle
        title={t('workflow.actualPrompt')}
        expanded={expandedSections.prompt}
        onToggle={() => toggleSection('prompt')}
        icon={<Code size={12} />}
      />
      {expandedSections.prompt ? (
        <pre className="wf-debug-pre">{result.actual_prompt}</pre>
      ) : null}

      {/* Resolved Bindings */}
      {Object.keys(result.resolved_bindings || {}).length > 0 ? (
        <>
          <SectionToggle
            title={t('workflow.resolvedBindings')}
            expanded={expandedSections.bindings}
            onToggle={() => toggleSection('bindings')}
          />
          {expandedSections.bindings ? (
            <pre className="wf-debug-pre">
              {JSON.stringify(result.resolved_bindings, null, 2)}
            </pre>
          ) : null}
        </>
      ) : null}

      {/* Structured Output */}
      {result.output ? (
        <>
          <SectionToggle
            title={t('workflow.structuredOutput')}
            expanded={expandedSections.output}
            onToggle={() => toggleSection('output')}
          />
          {expandedSections.output ? (
            <pre className="wf-debug-pre">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          ) : null}
        </>
      ) : null}

      {/* Summary */}
      {result.summary ? (
        <>
          <SectionToggle
            title={t('workflow.textSummary')}
            expanded={expandedSections.response}
            onToggle={() => toggleSection('response')}
            icon={<FileText size={12} />}
          />
          {expandedSections.response ? (
            <pre className="wf-debug-pre">{result.summary}</pre>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function TraceResultView({
  result,
  expandedSections,
  toggleSection,
}: {
  result: TraceResult
  expandedSections: Record<string, boolean>
  toggleSection: (key: string) => void
}) {
  const t = useT()
  return (
    <div className="wf-debug-result">
      <div className="wf-debug-result-status">
        <span className={`wf-debug-status-badge wf-debug-status--${result.status}`}>
          {result.status}
        </span>
        {result.schema_valid !== null ? (
          <span className={`wf-debug-schema-badge ${result.schema_valid ? 'is-valid' : 'is-invalid'}`}>
            Schema: {result.schema_valid ? '✓' : '✗'}
          </span>
        ) : null}
      </div>

      {result.schema_errors.length > 0 ? (
        <div className="wf-debug-schema-errors">
          {result.schema_errors.map((e, i) => (
            <div key={i} className="wf-debug-schema-error">{e}</div>
          ))}
        </div>
      ) : null}

      {/* Resolved Bindings */}
      {Object.keys(result.resolved_bindings || {}).length > 0 ? (
        <>
          <SectionToggle
            title={t('workflow.resolvedBindings')}
            expanded={expandedSections.bindings}
            onToggle={() => toggleSection('bindings')}
          />
          {expandedSections.bindings ? (
            <pre className="wf-debug-pre">
              {JSON.stringify(result.resolved_bindings, null, 2)}
            </pre>
          ) : null}
        </>
      ) : null}

      {/* Structured Output */}
      {result.structured_output ? (
        <>
          <SectionToggle
            title={t('workflow.structuredOutput')}
            expanded={expandedSections.output}
            onToggle={() => toggleSection('output')}
          />
          {expandedSections.output ? (
            <pre className="wf-debug-pre">
              {JSON.stringify(result.structured_output, null, 2)}
            </pre>
          ) : null}
        </>
      ) : null}

      {/* Model Response */}
      {result.model_response ? (
        <>
          <SectionToggle
            title={t('workflow.modelResponse')}
            expanded={expandedSections.response}
            onToggle={() => toggleSection('response')}
            icon={<FileText size={12} />}
          />
          {expandedSections.response ? (
            <pre className="wf-debug-pre">{result.model_response}</pre>
          ) : null}
        </>
      ) : null}

      {/* Artifacts */}
      {result.artifacts && result.artifacts.length > 0 ? (
        <>
          <SectionToggle
            title={t('workflow.artifacts')}
            expanded={expandedSections.prompt}
            onToggle={() => toggleSection('prompt')}
          />
          {expandedSections.prompt ? (
            <div className="wf-debug-artifacts">
              {result.artifacts.map((a, i) => (
                <div key={i} className="wf-debug-artifact">
                  <span className="wf-debug-artifact-key">{String(a.key || '')}</span>
                  <code>{String(a.value || a.path || '')}</code>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default DebugPanel
