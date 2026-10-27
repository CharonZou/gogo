import {
  bodyTextWithoutMermaid,
  diagramTypeLabel,
  extractMermaidFromNode,
  nodeHasDiagram,
  resolveNodeDiagramType,
} from '../../lib/knowledge-map-diagram.js'
import type { KnowledgeMapNode } from '../hooks/useKnowledgeMap.js'
import { useT } from '../lib/useI18n'
import { KnowledgeMapDiagramView } from './KnowledgeMapDiagramView.js'

export function KnowledgeMapNodeBodyContent({
  node,
  compact = false,
  fallbackEmpty,
}: {
  node: KnowledgeMapNode | Record<string, unknown> | null | undefined
  compact?: boolean
  fallbackEmpty?: string
}) {
  const t = useT()
  // i18n: 空态兜底文案渲染期取词；调用方显式传入（含空串）时尊重原值
  const emptyText = fallbackEmpty ?? t('chatUi.kmEmptyDetail')
  const body = String(node?.body || '').trim()
  const hasDiagram = nodeHasDiagram(node)
  const mermaidCode = extractMermaidFromNode(node)
  const textOnly = bodyTextWithoutMermaid(body)
  const title = String(node?.title || '').trim()
  const showText = Boolean(textOnly && textOnly !== title)
  const diagramLabel = hasDiagram ? diagramTypeLabel(resolveNodeDiagramType(node)) : ''

  if (!hasDiagram && !showText) {
    return <p className="km-node-body-empty">{emptyText}</p>
  }

  return (
    <div className={`km-node-body-content${compact ? ' km-node-body-content--compact' : ''}`}>
      {hasDiagram ? (
        <KnowledgeMapDiagramView code={mermaidCode} compact={compact} label={diagramLabel} />
      ) : null}
      {showText ? <p className="km-node-body-text">{textOnly}</p> : null}
    </div>
  )
}
