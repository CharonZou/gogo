import { memo, useMemo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Play } from 'lucide-react'
import NodeCardShell from './NodeCardShell.tsx'
import { RunVarsPanel } from './RunVarsPanel.tsx'
import { useWorkflowStudioOptional } from './WorkflowStudioContext.tsx'
import { useT } from '../../lib/useI18n'

function StartNode({ selected }: NodeProps) {
  const studio = useWorkflowStudioOptional()
  const t = useT()
  const vars = useMemo(() => {
    const list = Array.isArray(studio?.appParameters) ? studio.appParameters : []
    return list
      .map((p) => {
        const name = String(p?.name || '').trim()
        if (!name) return null
        return {
          name,
          label: String(p?.label || name).trim() || name,
          type: String(p?.type || 'text'),
          required: p?.required !== false,
        }
      })
      .filter(Boolean) as { name: string; label: string; type: string; required: boolean }[]
  }, [studio])

  const subtitle =
    vars.length > 0
      ? t('workflow.startSubtitleVars', { n: vars.length })
      : t('workflow.startSubtitleNoVars')

  return (
    <NodeCardShell
      selected={selected}
      kind="start"
      typeLabel={t('workflow.kindStart')}
      icon={<Play size={16} strokeWidth={2.2} />}
      title={t('workflow.flowStartTitle')}
      subtitle={subtitle}
      showInput={false}
      footer={<RunVarsPanel vars={vars} compact />}
    />
  )
}

export default memo(StartNode)
