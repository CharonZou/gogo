import { memo, type ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X } from 'lucide-react'
import { useT } from '../../lib/useI18n'

/** 语义节点类型：用于顶条色与标签 */
export type NodeVisualKind = 'start' | 'agent' | 'tool' | 'condition' | 'answer' | 'trigger' | 'action'

type Props = {
  selected?: boolean
  kind?: NodeVisualKind
  icon: ReactNode
  iconVariant?: 'default' | 'agent'
  title: string
  titleMuted?: boolean
  subtitle?: string
  showInput?: boolean
  showOutput?: boolean
  onClose?: () => void
  /** 点击头像/标题打开智能体选择 */
  onAgentPick?: () => void
  /**
   * row：整行可点选智能体（未分配时）
   * avatar：仅点头像更换（已有智能体，避免点节点误触）
   */
  agentPickMode?: 'row' | 'avatar'
  /** 调试运行态：pending | running | done | failed | skipped | paused */
  execStatus?: string | null
  /** 底部轻量类型标签或 IO 摘要 */
  typeLabel?: string
  footer?: ReactNode
  children?: ReactNode
}

function resolveKindClass(kind: NodeVisualKind): string {
  if (kind === 'trigger') return 'start'
  if (kind === 'action') return 'agent'
  return kind
}

/** 执行态码 → 词典键（展示文案在组件内按当前语言解析） */
const EXEC_LABEL_KEY: Record<string, string> = {
  running: 'workflow.execRunning',
  done: 'workflow.execDone',
  failed: 'workflow.execFailed',
  skipped: 'workflow.execSkipped',
  paused: 'workflow.execPaused',
  pending: 'workflow.execPending',
}

/** 节点语义类型 → 底部类型标签词典键 */
const KIND_LABEL_KEY: Record<string, string> = {
  start: 'workflow.kindStart',
  answer: 'workflow.kindOutput',
  condition: 'workflow.kindCondition',
  tool: 'workflow.kindTool',
}

/** 画布节点壳：白卡片 + 语义色顶条 + 输入/输出端口 */
function NodeCardShell({
  selected,
  kind = 'agent',
  icon,
  iconVariant = 'default',
  title,
  titleMuted = false,
  subtitle,
  showInput = true,
  showOutput = true,
  onClose,
  onAgentPick,
  agentPickMode = 'row',
  execStatus,
  typeLabel,
  footer,
  children,
}: Props) {
  const t = useT()
  const visual = resolveKindClass(kind)
  const avatarClass = `wf-node-avatar wf-node-avatar--${
    iconVariant === 'agent' ? 'agent' : visual === 'start' ? 'trigger' : 'action'
  }`
  const titleEl = (
    <div className={`wf-node-title${titleMuted ? ' is-muted' : ''}`} title={title}>
      {title}
    </div>
  )
  const exec = String(execStatus || '').trim()
  const execLabel = EXEC_LABEL_KEY[exec] ? t(EXEC_LABEL_KEY[exec]) : ''

  const avatarOnlyPick = !!(onAgentPick && agentPickMode === 'avatar')
  const rowPick = !!(onAgentPick && agentPickMode === 'row')
  const footLabel = typeLabel || t(KIND_LABEL_KEY[visual] || 'workflow.kindAgent')

  return (
    <div
      className={`wf-node wf-node--${visual}${selected ? ' is-selected' : ''}${
        exec ? ` is-exec is-exec-${exec}` : ''
      }`}
    >
      {showInput ? (
        <Handle className="wf-handle wf-handle--in" type="target" position={Position.Left} id="in" />
      ) : null}

      <div className="wf-node-card">
        <div className={`wf-node-gradient wf-node-gradient--${visual}`} aria-hidden />
        {execLabel ? (
          <span className={`wf-node-exec-badge wf-node-exec-badge--${exec}`} aria-label={execLabel}>
            {execLabel}
          </span>
        ) : null}
        <div className="wf-node-body">
          <div className="wf-node-head">
            {rowPick ? (
              <button
                type="button"
                className="wf-node-agent-hit nodrag nopan"
                title={t('workflow.pickAgent')}
                aria-label={t('workflow.pickAgent')}
                onClick={(e) => {
                  e.stopPropagation()
                  onAgentPick?.()
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className={avatarClass}>{icon}</div>
                {titleEl}
              </button>
            ) : (
              <>
                {avatarOnlyPick ? (
                  <button
                    type="button"
                    className="wf-node-agent-avatar-hit nodrag nopan"
                    title={t('workflow.changeAgent')}
                    aria-label={t('workflow.changeAgent')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAgentPick?.()
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className={avatarClass}>{icon}</div>
                  </button>
                ) : (
                  <div className={avatarClass}>{icon}</div>
                )}
                {titleEl}
              </>
            )}
            {onClose ? (
              <button
                type="button"
                className="wf-node-close nodrag nopan"
                title={t('workflow.deleteNode')}
                aria-label={t('workflow.deleteNode')}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X size={14} strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
          {subtitle ? (
            <div className="wf-node-intro" title={subtitle}>
              {subtitle}
            </div>
          ) : null}
          {children ? <div className="wf-node-extra">{children}</div> : null}
        </div>
        <div className="wf-node-foot">
          <span className={`wf-node-type-tag wf-node-type-tag--${visual}`}>{footLabel}</span>
          {footer}
        </div>
      </div>

      {showOutput ? (
        <Handle className="wf-handle wf-handle--out" type="source" position={Position.Right} id="out" />
      ) : null}
    </div>
  )
}

export default memo(NodeCardShell)
