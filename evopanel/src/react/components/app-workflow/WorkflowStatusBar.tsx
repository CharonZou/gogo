import { useT } from '../../lib/useI18n'

type Props = {
  stepCount: number
  edgeCount: number
  dirty?: boolean
  selectedLabel?: string | null
}

/** 底栏：节点/连线计数 + 保存状态（无常驻教学文案） */
export function WorkflowStatusBar({ stepCount, edgeCount, dirty }: Props) {
  const t = useT()
  const nodeTotal = Math.max(0, stepCount)
  return (
    <div className="wf-status-bar" role="status" aria-live="polite">
      <div className="wf-status-bar-left">
        <span className="wf-status-summary">
          {t('workflow.statusSummary', { nodes: nodeTotal, edges: edgeCount })}
        </span>
      </div>
      <div className="wf-status-bar-right">
        {dirty ? (
          <span className="wf-status-dirty">{t('workflow.unsaved')}</span>
        ) : (
          <span className="wf-status-saved">{t('workflow.saved')}</span>
        )}
      </div>
    </div>
  )
}
