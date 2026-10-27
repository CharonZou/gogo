import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { MessageSquareText } from 'lucide-react'
import NodeCardShell from './NodeCardShell.tsx'
import { useT } from '../../lib/useI18n'

export type AnswerNodeData = {
  sourceRef?: string
}

function AnswerNode({ selected, data }: NodeProps & { data?: AnswerNodeData }) {
  const t = useT()
  const sourceRef = String((data as AnswerNodeData | undefined)?.sourceRef || '').trim()
  return (
    <NodeCardShell
      selected={selected}
      kind="answer"
      typeLabel={t('workflow.kindOutput')}
      icon={<MessageSquareText size={16} strokeWidth={2.2} />}
      title={t('workflow.answerTitle')}
      subtitle={
        sourceRef
          ? t('workflow.answerSubtitleLinked', { ref: sourceRef })
          : t('workflow.answerSubtitleHint')
      }
      showInput
      showOutput={false}
    />
  )
}

export default memo(AnswerNode)
