import { useMemo } from 'react'
import type { IndexRelation } from '../types/code-index'
import { useT } from '../../lib/useI18n'

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 2) return p
  return `…/${parts.slice(-2).join('/')}`
}

type GraphNode = { id: string; label: string; x: number; y: number; degree: number }
type GraphEdge = { from: string; to: string; kind: string; symbol?: string }

export function CodeIndexGraph({
  relations,
  focusPath,
}: {
  relations: IndexRelation[]
  focusPath?: string | null
}) {
  const t = useT() // 局部遮蔽
  // KIND_STYLE 渲染期组装，以便切换语言时更新
  const KIND_STYLE: Record<string, { label: string; color: string }> = {
    imported_by: { label: t('obs.obsIdxKindImportedBy'), color: '#3b82f6' },
    imports: { label: t('obs.obsIdxKindImports'), color: '#22c55e' },
    internal_ref: { label: t('obs.obsIdxKindInternalRef'), color: '#a855f7' },
    supertype: { label: t('obs.obsIdxKindSupertype'), color: '#f59e0b' },
    subtype: { label: t('obs.obsIdxKindSubtype'), color: '#ef4444' },
    type_supertype: { label: t('obs.obsIdxKindSupertype'), color: '#f59e0b' },
    type_subtype: { label: t('obs.obsIdxKindSubtype'), color: '#ef4444' },
  }

  const { nodes, edges, width, height, pos } = useMemo(() => {
    const edgeList: GraphEdge[] = relations.slice(0, 48).map((r) => ({
      from: r.from_path,
      to: r.to_path,
      kind: r.kind,
      symbol: r.symbol,
    }))
    const degree = new Map<string, number>()
    for (const e of edgeList) {
      degree.set(e.from, (degree.get(e.from) || 0) + 1)
      degree.set(e.to, (degree.get(e.to) || 0) + 1)
    }
    const ids = [...degree.keys()].sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0)).slice(0, 20)
    const idSet = new Set(ids)
    const filteredEdges = edgeList.filter((e) => idSet.has(e.from) && idSet.has(e.to))

    const w = 720
    const h = 420
    const cx = w / 2
    const cy = h / 2
    const r = Math.min(w, h) * 0.36
    const nodeList: GraphNode[] = ids.map((id, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, ids.length) - Math.PI / 2
      return {
        id,
        label: shortPath(id),
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        degree: degree.get(id) || 0,
      }
    })
    if (focusPath && idSet.has(focusPath)) {
      const n = nodeList.find((x) => x.id === focusPath)
      if (n) {
        n.x = cx
        n.y = cy
      }
    }
    const posMap = new Map(nodeList.map((n) => [n.id, n]))
    return { nodes: nodeList, edges: filteredEdges, width: w, height: h, pos: posMap }
  }, [relations, focusPath])

  if (!relations.length) {
    return (
      <div className="code-index-graph-empty">
        {t('obs.obsIdxEmptyTip')}
      </div>
    )
  }

  const kindStats = relations.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] || 0) + 1
    return acc
  }, {})

  return (
    <div className="code-index-graph-panel">
      <div className="code-index-graph-legend">
        {Object.entries(kindStats).map(([kind, count]) => {
          const st = KIND_STYLE[kind] || { label: kind, color: 'var(--text-muted)' }
          return (
            <span key={kind} className="code-index-graph-legend-item">
              <span className="code-index-graph-legend-dot" style={{ background: st.color }} />
              {st.label} ({count})
            </span>
          )
        })}
        <span className="code-index-graph-legend-item muted">{t('obs.obsIdxLegendNodes', { nodes: nodes.length, edges: edges.length })}</span>
      </div>
      <svg className="code-index-graph-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('obs.obsIdxGraphAria')}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
        {edges.map((e, idx) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (!a || !b) return null
          const col = KIND_STYLE[e.kind]?.color || 'var(--text-muted)'
          return (
            <line
              key={`${e.from}-${e.to}-${idx}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={col}
              strokeWidth={1.2}
              strokeOpacity={0.55}
              markerEnd="url(#arrow)"
            />
          )
        })}
        {nodes.map((n) => (
          <g key={n.id} className="code-index-graph-node">
            <circle cx={n.x} cy={n.y} r={10 + Math.min(8, n.degree)} fill="var(--obs-surface-muted)" stroke="var(--blue)" strokeWidth={1.5} />
            <text x={n.x} y={n.y + 22} textAnchor="middle" className="code-index-graph-node-label">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
