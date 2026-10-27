import { memo, useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  isProcessingNodeStatus,
  nodeStatusLabel,
  normalizeNodeStatus,
} from '../../lib/knowledge-map-tree.js'
import { nodeHasDiagram } from '../../lib/knowledge-map-diagram.js'
import { patchSessionKnowledgeMapNodeStatus } from '../../lib/knowledge-map-fetch.js'
import {
  canUserEditNodeStatus,
  isArchivedNodeStatus,
  isCollapsedNodeStatus,
  isParkedNodeStatus,
  shouldDisplayNodeStatus,
} from '../../lib/knowledge-map-node-status.js'
import { useKnowledgeMap, type KnowledgeMapEdge, type KnowledgeMapNode } from '../hooks/useKnowledgeMap.js'
import { useT } from '../lib/useI18n'
import { KnowledgeMapExpandedModal } from './KnowledgeMapExpandedModal.js'
import { KnowledgeMapNodeBodyContent } from './KnowledgeMapNodeBodyContent.js'
import {
  KnowledgeMapNodeStatusMenu,
  statusMenuAnchorFromElement,
  statusMenuAnchorFromPoint,
  type StatusMenuAnchor,
} from './KnowledgeMapNodeStatusMenu.js'
import { KnowledgeMapTreeView } from './KnowledgeMapTreeView.js'

export type KnowledgeMapViewMode = 'tree' | 'list'

export interface KnowledgeMapPanelProps {
  sessionKey: string | null
  isOpen: boolean
  refreshKey?: number
  onClose: () => void
}

// i18n: 类型标签只存稳定 kind → 词典键映射，文案渲染期取词（原模块级 KIND_LABEL 中文常量）
const KIND_LABEL_KEY: Record<string, string> = {
  file: 'chatUi.kmKindFile',
  symbol: 'chatUi.kmKindSymbol',
  module: 'chatUi.kmKindModule',
  flow: 'chatUi.kmKindFlow',
  gap: 'chatUi.kmKindGap',
  note: 'chatUi.kmKindNote',
  hypothesis: 'chatUi.kmKindHypothesis',
  doc: 'chatUi.kmKindDoc',
  section: 'chatUi.kmKindSection',
  claim: 'chatUi.kmKindClaim',
  source: 'chatUi.kmKindSource',
  task: 'chatUi.kmKindTask',
  decision: 'chatUi.kmKindDecision',
  goal: 'chatUi.kmKindGoal',
  diagram: 'chatUi.kmKindDiagram',
}

function kindLabel(t: ReturnType<typeof useT>, kind: string | undefined): string {
  const k = String(kind || 'note').trim().toLowerCase()
  const key = KIND_LABEL_KEY[k]
  return (key ? t(key) : '') || k || t('chatUi.kmKindFallback')
}

function groupNodes(nodes: KnowledgeMapNode[]) {
  const gaps: KnowledgeMapNode[] = []
  const flows: KnowledgeMapNode[] = []
  const artifacts: KnowledgeMapNode[] = []
  const notes: KnowledgeMapNode[] = []
  const parked: KnowledgeMapNode[] = []
  const archived: KnowledgeMapNode[] = []
  for (const n of nodes) {
    const status = normalizeNodeStatus(n.status)
    // collapsed nodes are hidden entirely (mirrors backend injection)
    if (status === 'collapsed') continue
    if (isArchivedNodeStatus(status)) {
      archived.push(n)
      continue
    }
    if (isParkedNodeStatus(status)) {
      parked.push(n)
      continue
    }
    const k = String(n.kind || '').trim().toLowerCase()
    if (k === 'gap') gaps.push(n)
    else if (k === 'flow') flows.push(n)
    else if (k === 'note' || k === 'hypothesis') notes.push(n)
    else artifacts.push(n)
  }
  return { gaps, flows, artifacts, notes, parked, archived }
}

function NodeCard({
  node,
  onPatchNodeStatus,
}: {
  node: KnowledgeMapNode
  onPatchNodeStatus?: (nodeId: string, status: string) => Promise<void>
}) {
  const t = useT()
  const id = String(node.external_id || '').trim()
  const title = String(node.title || id || t('chatUi.kmUntitled')).trim()
  const body = String(node.body || '').trim()
  const hasDiagram = nodeHasDiagram(node)
  const parent = String(node.parent_external_id || '').trim()
  const status = normalizeNodeStatus(node.status)
  const editable = canUserEditNodeStatus(id, node.kind)
  const statusTracked = shouldDisplayNodeStatus(node.kind, id)
  const isProcessing = statusTracked && isProcessingNodeStatus(status)
  const statusLabel = nodeStatusLabel(status)
  const showStatus = statusTracked && status && status !== 'collapsed'
  const [statusMenu, setStatusMenu] = useState<StatusMenuAnchor | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)

  const openStatusMenuFromTarget = (e: ReactMouseEvent<HTMLElement>) => {
    if (!editable || !onPatchNodeStatus) return
    e.preventDefault()
    e.stopPropagation()
    setStatusMenu(statusMenuAnchorFromElement(e.currentTarget, 'left'))
  }

  const openStatusMenuFromContext = (e: ReactMouseEvent) => {
    if (!editable || !onPatchNodeStatus) return
    e.preventDefault()
    e.stopPropagation()
    setStatusMenu(statusMenuAnchorFromPoint(e.clientX, e.clientY, 'auto'))
  }

  const handleStatusSelect = async (next: string) => {
    if (!onPatchNodeStatus || !id) return
    setSavingStatus(true)
    try {
      await onPatchNodeStatus(id, next)
      setStatusMenu(null)
    } finally {
      setSavingStatus(false)
    }
  }

  return (
    <article
      className={`km-node-card${isProcessing ? ' is-processing' : ''}`}
      data-kind={node.kind || 'note'}
      data-status={showStatus ? status : undefined}
      data-has-diagram={hasDiagram ? 'true' : undefined}
      onContextMenu={editable ? openStatusMenuFromContext : undefined}
    >
      <div className="km-node-card-head">
        {isProcessing ? <span className="km-xmind-topic-status-light" aria-hidden="true" title={statusLabel} /> : null}
        <span className="km-node-kind">{kindLabel(t, node.kind)}</span>
        <span className="km-node-title" title={title}>
          {title}
        </span>
        {showStatus ? (
          <button
            type="button"
            className={`km-node-status km-node-status-btn${editable ? ' is-editable' : ''}`}
            title={editable ? t('chatUi.kmStatusEditTitle') : statusLabel}
            onClick={openStatusMenuFromTarget}
          >
            {statusLabel}
          </button>
        ) : null}
      </div>
      {id ? (
        <div className="km-node-id" title={id}>
          {id}
        </div>
      ) : null}
      {parent ? <div className="km-node-parent">↑ {parent}</div> : null}
      {body || hasDiagram ? (
        <KnowledgeMapNodeBodyContent node={node} compact fallbackEmpty="" />
      ) : null}
      {statusMenu ? (
        <KnowledgeMapNodeStatusMenu
          nodeId={id}
          currentStatus={status}
          anchor={statusMenu}
          saving={savingStatus}
          onSelect={(next) => void handleStatusSelect(next)}
          onClose={() => setStatusMenu(null)}
        />
      ) : null}
    </article>
  )
}

function CollapsibleEdgeSection({ edges }: { edges: KnowledgeMapEdge[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <section className={`km-section is-collapsible${open ? ' is-open' : ''}`}>
      <h3 className="km-section-title" onClick={() => setOpen((v) => !v)}>
        {t('chatUi.kmEdgesSection')}
        <span className="km-section-count">{edges.length}</span>
      </h3>
      <ul className="km-edge-list">
        {edges.map((e) => {
          const id = String(e.external_id || '').trim()
          const fromId = String(e.from_external_id || '').trim()
          const toId = String(e.to_external_id || '').trim()
          const rel = String(e.rel || 'depends').trim()
          const label = String(e.label || '').trim()
          return (
            <li key={id || `${fromId}-${rel}-${toId}`} className="km-edge-item">
              <span className="km-edge-from" title={fromId}>
                {fromId || '?'}
              </span>
              <span className="km-edge-rel">{rel}</span>
              <span className="km-edge-to" title={toId}>
                {toId || '?'}
              </span>
              {label ? <span className="km-edge-label">{label}</span> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string
  count: number
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!count) return null
  return (
    <section className={`km-section is-collapsible${open ? ' is-open' : ''}`}>
      <h3 className="km-section-title" onClick={() => setOpen((v) => !v)}>
        {title}
        <span className="km-section-count">{count}</span>
      </h3>
      <div className="km-section-body">{children}</div>
    </section>
  )
}

function KnowledgeMapPanelContent({
  viewMode,
  treeLayout,
  loading,
  error,
  empty,
  goal,
  summary,
  nodes,
  edges,
  grouped,
  onPatchNodeStatus,
}: {
  viewMode: KnowledgeMapViewMode
  treeLayout: 'panel' | 'modal'
  loading: boolean
  error: string | null
  empty: boolean
  goal: string
  summary: string
  nodes: KnowledgeMapNode[]
  edges: KnowledgeMapEdge[]
  grouped: ReturnType<typeof groupNodes>
  onPatchNodeStatus?: (nodeId: string, status: string) => Promise<void>
}) {
  const t = useT()
  return (
    <>
      {loading && nodes.length === 0 && edges.length === 0 && !goal ? (
        <div className="collab-exec-dag-empty">{t('chatUi.kmLoading')}</div>
      ) : null}
      {error ? <div className="km-error">{error}</div> : null}
      {empty ? <div className="collab-exec-dag-empty">{t('chatUi.kmEmptyContent')}</div> : null}
      {goal && viewMode === 'list' ? (
        <section className="km-goal-block">
          <h3 className="km-section-title">{t('chatUi.goalLabel')}</h3>
          <p className="km-goal-text">{goal}</p>
        </section>
      ) : null}
      {summary && viewMode === 'list' ? (
        <section className="km-summary-block">
          <h3 className="km-section-title">{t('chatUi.detailSummary')}</h3>
          <p className="km-summary-text">{summary}</p>
        </section>
      ) : null}
      {viewMode === 'tree' && !empty ? (
        <KnowledgeMapTreeView
          goal={goal}
          nodes={nodes}
          edges={edges}
          layout={treeLayout}
          onPatchNodeStatus={onPatchNodeStatus}
        />
      ) : null}
      {viewMode === 'list' ? (
        <>
          <Section title={t('chatUi.kmSectionGaps')} count={grouped.gaps.length}>
            {grouped.gaps.map((n) => (
              <NodeCard key={n.external_id || n.title} node={n} onPatchNodeStatus={onPatchNodeStatus} />
            ))}
          </Section>
          <Section title={t('chatUi.kmSectionFlows')} count={grouped.flows.length}>
            {grouped.flows.map((n) => (
              <NodeCard key={n.external_id || n.title} node={n} onPatchNodeStatus={onPatchNodeStatus} />
            ))}
          </Section>
          <Section title={t('chatUi.kmSectionArtifacts')} count={grouped.artifacts.length}>
            {grouped.artifacts.map((n) => (
              <NodeCard key={n.external_id || n.title} node={n} onPatchNodeStatus={onPatchNodeStatus} />
            ))}
          </Section>
          <Section title={t('chatUi.kmKindNote')} count={grouped.notes.length} defaultOpen={grouped.notes.length <= 8}>
            {grouped.notes.map((n) => (
              <NodeCard key={n.external_id || n.title} node={n} onPatchNodeStatus={onPatchNodeStatus} />
            ))}
          </Section>
          <Section title={t('chatUi.kmSectionParked')} count={grouped.parked.length} defaultOpen={false}>
            {grouped.parked.map((n) => (
              <NodeCard key={n.external_id || n.title} node={n} onPatchNodeStatus={onPatchNodeStatus} />
            ))}
          </Section>
          <Section title={t('chatUi.kmSectionArchived')} count={grouped.archived.length} defaultOpen={false}>
            {grouped.archived.map((n) => (
              <NodeCard key={n.external_id || n.title} node={n} onPatchNodeStatus={onPatchNodeStatus} />
            ))}
          </Section>
          {edges.length > 0 ? <CollapsibleEdgeSection edges={edges} /> : null}
        </>
      ) : null}
    </>
  )
}

function KnowledgeMapHeaderActions({
  viewMode,
  onViewModeChange,
  onRefresh,
  onExpand,
  showExpand,
}: {
  viewMode: KnowledgeMapViewMode
  onViewModeChange: (mode: KnowledgeMapViewMode) => void
  onRefresh: () => void
  onExpand?: () => void
  showExpand?: boolean
}) {
  const t = useT()
  return (
    <>
      <div className="km-view-toggle" role="tablist" aria-label={t('chatUi.kmViewToggleAria')}>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'tree'}
          className={viewMode === 'tree' ? 'is-active' : ''}
          onClick={() => onViewModeChange('tree')}
        >
          {t('chatUi.kmViewTree')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'list'}
          className={viewMode === 'list' ? 'is-active' : ''}
          onClick={() => onViewModeChange('list')}
        >
          {t('chatUi.kmViewList')}
        </button>
      </div>
      {showExpand ? (
        <button type="button" className="km-icon-btn" title={t('chatUi.kmExpandView')} aria-label={t('chatUi.kmExpandView')} onClick={onExpand}>
          ⤢
        </button>
      ) : null}
      <button type="button" className="km-icon-btn" title={t('chatUi.kmRefresh')} aria-label={t('chatUi.kmRefresh')} onClick={onRefresh}>
        ↻
      </button>
    </>
  )
}

function KnowledgeMapPanelInner({ sessionKey, isOpen, refreshKey = 0, onClose }: KnowledgeMapPanelProps) {
  const t = useT()
  const sk = String(sessionKey || '').trim()
  const [viewMode, setViewMode] = useState<KnowledgeMapViewMode>('tree')
  const [expandedOpen, setExpandedOpen] = useState(false)
  const { data, loading, error, refresh } = useKnowledgeMap(sk, {
    enabled: (isOpen || expandedOpen) && !!sk,
    refreshKey,
    pollMs: isOpen || expandedOpen ? 6000 : 0,
  })

  const nodes = useMemo(
    () => (Array.isArray(data?.nodes) ? data!.nodes! : []).filter((n) => !isCollapsedNodeStatus(n.status)),
    [data],
  )
  const edges = useMemo(() => (Array.isArray(data?.edges) ? data!.edges! : []), [data])
  const grouped = useMemo(() => groupNodes(nodes), [nodes])
  const summary = String(data?.header?.render_summary || '').trim()
  const goal = String(data?.header?.goal || '').trim()
  const empty = !loading && !error && !goal && nodes.length === 0 && edges.length === 0

  const handlePatchNodeStatus = useCallback(
    async (nodeId: string, status: string) => {
      if (!sk) return
      await patchSessionKnowledgeMapNodeStatus(sk, nodeId, status)
      await refresh()
    },
    [sk, refresh],
  )

  const contentProps = {
    viewMode,
    loading,
    error,
    empty,
    goal,
    summary,
    nodes,
    edges,
    grouped,
    onPatchNodeStatus: sk ? handlePatchNodeStatus : undefined,
  }

  if (!isOpen && !expandedOpen) return null

  return (
    <>
      {isOpen ? (
        <aside className="react-chat-collab-exec-panel react-chat-knowledge-map-panel" role="region" aria-label={t('chatUi.kmPanelTitle')}>
          <header className="react-chat-collab-exec-panel-header">
            <div className="react-chat-collab-exec-panel-title-wrap">
              <div className="react-chat-collab-exec-panel-title-row">
                <span className="react-chat-collab-exec-panel-title">{t('chatUi.kmPanelTitle')}</span>
              </div>
            </div>
            <div className="km-header-actions">
              <KnowledgeMapHeaderActions
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={() => void refresh()}
                onExpand={() => setExpandedOpen(true)}
                showExpand={!empty}
              />
              <span className="km-header-actions-divider" aria-hidden="true" />
              <button type="button" className="km-icon-btn" title={t('chatUi.closeAria')} aria-label={t('chatUi.closeAria')} onClick={onClose}>
                ×
              </button>
            </div>
          </header>
          <div className="react-chat-collab-exec-panel-body km-panel-body">
            <KnowledgeMapPanelContent {...contentProps} treeLayout="panel" />
          </div>
        </aside>
      ) : null}

      <KnowledgeMapExpandedModal
        open={expandedOpen}
        title={t('chatUi.kmPanelTitle')}
        onClose={() => setExpandedOpen(false)}
        headerActions={
          <KnowledgeMapHeaderActions
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onRefresh={() => void refresh()}
            showExpand={false}
          />
        }
      >
        <div className="km-expanded-content">
          <KnowledgeMapPanelContent {...contentProps} treeLayout="modal" />
        </div>
      </KnowledgeMapExpandedModal>
    </>
  )
}

export const KnowledgeMapPanel = memo(KnowledgeMapPanelInner)
