import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Layers,
  MessageSquareText,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react'
import {
  getStepFieldMap,
  type AppWorkflowStep,
  type StepNodeData,
} from '../../lib/app-workflow-plan.ts'
import { ANSWER_NODE_ID, START_NODE_ID } from '../../lib/app-workflow-flow.ts'
import { parseCsvField, joinCsvField } from '../../lib/workflow-step-csv.ts'
import {
  agentCapabilitySummary,
  normalizeAgentTags,
  tagMetaForLabel,
  type AgentPickerRow,
} from '../../lib/agent-tags.ts'
import { labelSkills, resolveAgentToolsDisplay } from '../../lib/agent-caps-display.ts'
import { useWorkflowResources } from '../../hooks/useWorkflowResources.ts'
import { type SkillSelection } from '../SkillPickerModal.tsx'
import { AgentPickerModal } from './AgentPickerModal.tsx'
import { CapabilityPickerModal } from './CapabilityPickerModal.tsx'
import InsertChipBar from './InsertChipBar.tsx'
import { SlashVarTextarea, type SlashVarItem } from './SlashVarTextarea.tsx'
import { WorkspaceFolderInput } from './WorkspaceFolderInput.tsx'
import { RunVarsPanel } from './RunVarsPanel.tsx'
import AssignedAgentAvatar from '../AssignedAgentAvatar.tsx'
import WorkflowNodeAvatar from './WorkflowNodeAvatar.tsx'
import { resolveWorkflowAgent } from './WorkflowStepAgentHead.tsx'
import { useT } from '../../lib/useI18n'

type TabId = 'library' | 'config'
/** library = 左侧节点库；config = 右侧上下文配置（无 Tab） */
export type WorkflowDrawerPanelRole = 'library' | 'config'

export type AppParamSlot = {
  name: string
  label?: string
  type?: string
  required?: boolean
}

export type UpstreamStepRef = {
  ref: string
  name: string
}

type Props = {
  open: boolean
  onToggle: () => void
  /** @deprecated 使用 panelRole；保留以兼容旧调用 */
  tab?: TabId
  onTabChange?: (tab: TabId) => void
  /** 固定面板角色：左侧库 / 右侧配置 */
  panelRole?: WorkflowDrawerPanelRole
  selectedId: string | null
  selectedStep: StepNodeData | null
  workflowGoal: string
  onWorkflowGoalChange: (goal: string) => void
  onStepChange: (patch: Partial<AppWorkflowStep>) => void
  onAddStep: () => void
  onAddStepWithAgent?: (agentCode: string) => void
  onAddAnswer?: () => void
  onDeleteSelected: () => void
  hasSelection: boolean
  onOpenAppSettings?: () => void
  /** HTML5 DnD mime type for dragging Agent step onto canvas */
  dndType?: string
  /** Step ref currently wired into the answer node (if any) */
  answerSourceRef?: string
  /** App-level run parameters (filled on 运行页 / OpenAPI variables) */
  appParameters?: AppParamSlot[]
  /** Direct upstream steps for the selected node */
  upstreamSteps?: UpstreamStepRef[]
}

function appendBlock(current: string | undefined, insert: string): string {
  const cur = String(current || '')
  const piece = String(insert || '').trim()
  if (!piece) return cur
  if (!cur.trim()) return piece
  const needsGap = !/\s$/.test(cur)
  return `${cur}${needsGap ? '\n' : ''}${piece}`
}

function appendInline(current: string | undefined, insert: string): string {
  const cur = String(current || '')
  const piece = String(insert || '').trim()
  if (!piece) return cur
  if (!cur.trim()) return piece
  return `${cur}${/\s$/.test(cur) ? '' : ' '}${piece}`
}

function hasText(v?: string | null) {
  return !!(v && String(v).trim())
}

function DrawerPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wf-drawer-panel">
      <h4 className="wf-drawer-panel-title">{title}</h4>
      {children}
    </section>
  )
}

function FieldBadge({ kind }: { kind: 'suggest' | 'optional' }) {
  const t = useT()
  return (
    <span className={`wf-field-badge wf-field-badge--${kind}`}>
      {kind === 'suggest' ? t('workflow.badgeSuggest') : t('workflow.badgeOptional')}
    </span>
  )
}

function FoldSection({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string
  subtitle?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="wf-drawer-panel wf-drawer-panel--fold">
      <button
        type="button"
        className="wf-drawer-fold-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="wf-drawer-fold-title-wrap">
          <span>{title}</span>
          {subtitle ? <small className="wf-drawer-fold-sub">{subtitle}</small> : null}
        </span>
        <ChevronRight size={14} className={`wf-drawer-fold-icon${open ? ' is-open' : ''}`} />
      </button>
      {open ? <div className="wf-drawer-fold-body">{children}</div> : null}
    </section>
  )
}

function ResourceRow({
  icon,
  label,
  summary,
  badge,
  onClick,
}: {
  icon: ReactNode
  label: string
  summary: string
  badge?: 'suggest' | 'optional'
  onClick: () => void
}) {
  return (
    <button type="button" className="wf-drawer-resource" onClick={onClick}>
      <span className="wf-drawer-resource-icon">{icon}</span>
      <span className="wf-drawer-resource-copy">
        <strong>
          {label}
          {badge ? <FieldBadge kind={badge} /> : null}
        </strong>
        <small>{summary}</small>
      </span>
      <ChevronRight size={14} className="wf-drawer-resource-arrow" />
    </button>
  )
}

/** 高级设置字段（新手基本不用，默认收起） */
const ADVANCED_DETAIL_KEYS = [
  'instruction',
  'inputs',
  'outputs',
  'acceptance',
  'failure',
  'description',
  'model',
  'project_path',
] as const

export function WorkflowDrawer({
  open,
  onToggle,
  tab: tabProp,
  onTabChange: _onTabChange,
  panelRole,
  selectedId,
  selectedStep,
  workflowGoal,
  onWorkflowGoalChange,
  onStepChange,
  onAddStep,
  onAddStepWithAgent,
  onAddAnswer,
  onDeleteSelected,
  hasSelection,
  onOpenAppSettings,
  dndType = 'application/gogo-wf-node',
  answerSourceRef = '',
  appParameters = [],
  upstreamSteps = [],
}: Props) {
  const role: WorkflowDrawerPanelRole = panelRole || tabProp || 'library'
  const tab: TabId = role
  // 命名 tr：文件内已有局部变量/回调参数 t（tools for 循环、toolDisplay.tags map）
  const tr = useT()
  const { agents, skills, tools, mcpServers, loading } = useWorkflowResources(open)
  const [agentOpen, setAgentOpen] = useState(false)
  const [capOpen, setCapOpen] = useState(false)
  const [libSearch, setLibSearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  /** 本智能体自带能力区域折叠 */
  const [capsFold, setCapsFold] = useState(true)
  /** 能力配置折叠区（默认展开，相对常用） */
  const [capSectionOpen, setCapSectionOpen] = useState(true)
  /** 高级设置折叠区（默认收起，新手基本不用） */
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const agentSummary = useMemo(() => {
    if (!selectedStep?.assigned_agent) return tr('workflow.agentSummaryEmpty')
    return resolveWorkflowAgent(agents, selectedStep.assigned_agent).label
  }, [agents, selectedStep, tr])

  const selectedAgentRow = useMemo(() => {
    const code = String(selectedStep?.assigned_agent || '').trim()
    if (!code) return null
    return agents.find((a) => String(a.agent_code || '') === code) || null
  }, [agents, selectedStep])

  const selectedAgentCaps = useMemo(
    () => agentCapabilitySummary(selectedAgentRow, 24),
    [selectedAgentRow],
  )

  const skillTags = useMemo(
    () => labelSkills(selectedAgentCaps.skills, skills),
    [selectedAgentCaps.skills, skills],
  )
  const toolDisplay = useMemo(
    () => resolveAgentToolsDisplay(selectedAgentRow, tools, 24),
    [selectedAgentRow, tools],
  )

  const paramChips = useMemo(
    () =>
      (appParameters || [])
        .map((p) => {
          const name = String(p?.name || '').trim()
          if (!name) return null
          const label = String(p?.label || name).trim() || name
          return {
            id: name,
            label,
            insert: `{{${name}}}`,
            // i18n: 保留中文提示词（chip title 与 insert 文案配套，面向运行页中文语境）
            title: `插入 {{${name}}}（运行页由用户填写）`,
          }
        })
        .filter(Boolean) as { id: string; label: string; insert: string; title: string }[],
    [appParameters],
  )

  const slashVarItems = useMemo(() => {
    const vars: SlashVarItem[] = paramChips.map((c) => ({
      id: `var:${c.id}`,
      label: c.label,
      insert: c.insert,
      group: tr('workflow.groupUserInput'),
      hint: c.id,
    }))
    for (const u of upstreamSteps || []) {
      const ref = String(u.ref || '').trim()
      if (!ref) continue
      const name = String(u.name || '').trim() || tr('workflow.stepRef', { ref })
      vars.push({
        id: `up:${ref}`,
        label: name,
        // i18n: 保留中文提示词（会进入消息正文发给 agent）
        insert: `请基于前置步骤 ${ref}（${name}）的产出继续完成当前任务。`,
        group: tr('workflow.groupUpstream'),
        hint: tr('workflow.stepRef', { ref }),
      })
    }
    return vars
  }, [paramChips, upstreamSteps, tr])

  const runVars = useMemo(
    () =>
      (appParameters || [])
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
        .filter(Boolean) as {
        name: string
        label: string
        type: string
        required: boolean
      }[],
    [appParameters],
  )

  const upstreamChips = useMemo(
    () =>
      (upstreamSteps || []).map((u) => {
        const ref = String(u.ref || '').trim()
        const name = String(u.name || '').trim() || tr('workflow.stepRef', { ref })
        return {
          id: ref,
          label: name,
          // i18n: 保留中文提示词（会进入消息正文发给 agent）
          insert: `请基于前置步骤 ${ref}（${name}）的产出继续完成当前任务。`,
          title: tr('workflow.refUpstreamTitle', { ref }),
        }
      }),
    [upstreamSteps, tr],
  )

  const skillSelected = useMemo<SkillSelection[]>(() => {
    if (!selectedStep) return []
    return parseCsvField(selectedStep.skills).map((name) => {
      const hit = skills.find((s) => s.name === name)
      return { name, label: hit?.label || name, icon: hit?.icon || '🧩' }
    })
  }, [selectedStep, skills])
  const toolSelected = useMemo(() => parseCsvField(selectedStep?.tools), [selectedStep?.tools])
  const mcpSelected = useMemo(() => parseCsvField(selectedStep?.mcp_servers), [selectedStep?.mcp_servers])

  const taskText = selectedStep?.goal || selectedStep?.description || ''
  const hasAgent = hasText(selectedStep?.assigned_agent)
  const capCount = skillSelected.length + toolSelected.length + mcpSelected.length
  useEffect(() => {
    // 换节点时：能力配置区默认展开，高级设置区默认收起
    // 已有挂载能力时能力配置区展开，否则也收起保持界面简洁
    if (!selectedStep) {
      queueMicrotask(() => {
        setCapSectionOpen(false)
        setAdvancedOpen(false)
      })
      return
    }
    const caps =
      parseCsvField(selectedStep.skills).length +
      parseCsvField(selectedStep.tools).length +
      parseCsvField(selectedStep.mcp_servers).length
    // 延迟到微任务末尾，等 DOM 尺寸稳定后再切换折叠状态
    queueMicrotask(() => {
      setCapSectionOpen(caps > 0)
      setAdvancedOpen(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const libNodes = useMemo(() => {
    const q = libSearch.trim().toLowerCase()
    const items = [
      {
        id: 'start',
        title: tr('workflow.flowStartTitle'),
        desc: tr('workflow.libStartDesc'),
        tone: 'trigger' as const,
        icon: <Play size={16} />,
        static: true,
      },
      {
        id: 'answer',
        title: tr('workflow.answerTitle'),
        desc: tr('workflow.libAnswerDesc'),
        tone: 'trigger' as const,
        icon: <MessageSquareText size={16} />,
        onClick: onAddAnswer,
        draggable: true,
        dragKind: 'answer',
      },
      {
        id: 'agent',
        title: tr('workflow.agentStepTitle'),
        desc: tr('workflow.libAgentDesc'),
        tone: 'action' as const,
        icon: <Workflow size={16} />,
        onClick: onAddStep,
        draggable: true,
        dragKind: 'agent-step',
      },
    ]
    return q ? items.filter((i) => i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)) : items
  }, [libSearch, onAddStep, onAddAnswer, tr])

  const filteredAgents = useMemo<AgentPickerRow[]>(() => {
    const q = (agentSearch || libSearch).trim().toLowerCase()
    if (!q) return agents
    return agents.filter((a) => {
      const code = String(a.agent_code || '').toLowerCase()
      const name = String(a.agent_name || '').toLowerCase()
      const desc = String(a.description || '').toLowerCase()
      const tagText = normalizeAgentTags(a.tags).join(' ').toLowerCase()
      return code.includes(q) || name.includes(q) || desc.includes(q) || tagText.includes(q)
    })
  }, [agents, agentSearch, libSearch])

  const isStart = selectedId === START_NODE_ID
  const isAnswer = selectedId === ANSWER_NODE_ID
  const isStep = !!selectedStep && !isStart && !isAnswer
  const isConfigPanel = role === 'config'
  const isLibraryPanel = role === 'library'

  const skillSummary =
    skillSelected.length > 0
      ? skillSelected.map((s) => s.label).join('、')
      : ''
  const toolLabelByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tools) map.set(t.value, t.label || t.value)
    return map
  }, [tools])
  const toolSummary =
    toolSelected.length > 0
      ? toolSelected.map((n) => toolLabelByName.get(n) || n).join('、')
      : ''
  const capSummary =
    skillSelected.length || toolSelected.length
      ? [
          skillSelected.length ? tr('workflow.miniCapSkills', { list: skillSelected.length }) : '',
          toolSelected.length ? tr('workflow.miniCapTools', { list: toolSelected.length }) : '',
        ]
          .filter(Boolean)
          .join(' · ') +
        (skillSummary || toolSummary
          ? `（${[skillSummary, toolSummary].filter(Boolean).join('；')}）`
          : '')
      : tr('workflow.capSummaryEmpty')

  const body = open ? (
    <>
      <div className="wf-drawer-body">
        {tab === 'library' ? (
          <>
            <div className="wf-drawer-search-wrap">
              <Search size={15} className="wf-drawer-search-icon" aria-hidden />
              <input
                className="wf-drawer-search"
                placeholder={tr('workflow.searchNodeOrAgent')}
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
              />
            </div>

            <div className="wf-drawer-section">
              <div className="wf-drawer-section-head">
                <span className="wf-drawer-section-title">{tr('workflow.systemNodes')}</span>
                <span className="wf-drawer-section-badge">
                  {libNodes.filter((n) => n.tone === 'trigger').length}
                </span>
              </div>
              {libNodes
                .filter((n) => n.tone === 'trigger')
                .map((n) =>
                  n.static ? (
                    <div key={n.id} className="wf-drawer-lib-card wf-drawer-lib-row wf-drawer-lib-card--static">
                      <WorkflowNodeAvatar tone={n.tone} size="md">
                        {n.icon}
                      </WorkflowNodeAvatar>
                      <div className="wf-drawer-lib-copy">
                        <span className="wf-drawer-lib-name">{n.title}</span>
                        <span className="wf-drawer-lib-desc">{n.desc}</span>
                      </div>
                      <span className="wf-drawer-lib-tag">{tr('workflow.fixedTag')}</span>
                    </div>
                  ) : (
                    <button
                      key={n.id}
                      type="button"
                      className="wf-drawer-lib-card wf-drawer-lib-row"
                      draggable={!!n.draggable}
                      onDragStart={(e) => {
                        if (!n.dragKind) return
                        e.dataTransfer.setData(dndType, n.dragKind)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onClick={n.onClick}
                    >
                      <WorkflowNodeAvatar tone={n.tone} size="md">
                        {n.icon}
                      </WorkflowNodeAvatar>
                      <div className="wf-drawer-lib-copy">
                        <span className="wf-drawer-lib-name">{n.title}</span>
                        <span className="wf-drawer-lib-desc">{n.desc}</span>
                      </div>
                      <span className="wf-drawer-lib-add" aria-hidden>
                        <Plus size={14} />
                      </span>
                    </button>
                  ),
                )}
            </div>

            <div className="wf-drawer-section">
              <div className="wf-drawer-section-head">
                <span className="wf-drawer-section-title">{tr('workflow.executableSteps')}</span>
                <span className="wf-drawer-section-badge">
                  {libNodes.filter((n) => n.tone === 'action').length}
                </span>
              </div>
              {libNodes
                .filter((n) => n.tone === 'action')
                .map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="wf-drawer-lib-card wf-drawer-lib-row"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(dndType, 'agent-step')
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={n.onClick}
                  >
                    <WorkflowNodeAvatar tone={n.tone} size="md">
                      {n.icon}
                    </WorkflowNodeAvatar>
                    <div className="wf-drawer-lib-copy">
                      <span className="wf-drawer-lib-name">{n.title}</span>
                      <span className="wf-drawer-lib-desc">{n.desc}</span>
                    </div>
                    <span className="wf-drawer-lib-add" aria-hidden>
                      <Plus size={14} />
                    </span>
                  </button>
                ))}
            </div>

            <div className="wf-drawer-section wf-drawer-section--agents">
              <div className="wf-drawer-section-head">
                <span className="wf-drawer-section-title">{tr('workflow.kindAgent')}</span>
                <span className="wf-drawer-section-badge">
                  {filteredAgents.length}
                </span>
              </div>
              <p className="wf-drawer-section-hint">{tr('workflow.agentDragHint')}</p>
              <div className="wf-drawer-agent-search-wrap">
                <Search size={13} className="wf-drawer-agent-search-icon" aria-hidden />
                <input
                  className="wf-drawer-agent-search"
                  placeholder={tr('workflow.searchAgents')}
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  aria-label={tr('workflow.searchAgentsAria')}
                />
              </div>
              {loading ? (
                <div className="wf-drawer-lib-empty">{tr('workflow.agentsLoading')}</div>
              ) : filteredAgents.length === 0 ? (
                <div className="wf-drawer-lib-empty">
                  {agentSearch.trim() ? tr('workflow.agentNotFound', { q: agentSearch.trim() }) : tr('workflow.noMatchingAgents')}
                </div>
              ) : (
                <div className="wf-drawer-agent-list">
                  {filteredAgents.map((a) => {
                    const code = String(a.agent_code || '')
                    const name = String(a.agent_name || code)
                    const caps = agentCapabilitySummary(a, 3)
                    const tags = normalizeAgentTags(a.tags).slice(0, 1)
                    return (
                      <button
                        key={code}
                        type="button"
                        className="wf-drawer-lib-card wf-drawer-lib-row wf-drawer-agent-item"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(dndType, `agent:${code}`)
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                        onClick={() => {
                          if (onAddStepWithAgent) {
                            onAddStepWithAgent(code)
                          } else {
                            onAddStep()
                            requestAnimationFrame(() => {
                              onStepChange({ assigned_agent: code })
                            })
                          }
                        }}
                        title={name}
                      >
                        <span className="wf-drawer-agent-avatar" aria-hidden>
                          <AssignedAgentAvatar agentCode={code} agents={agents} size={32} />
                        </span>
                        <div className="wf-drawer-lib-copy">
                          <div className="wf-drawer-lib-title-row">
                            <span className="wf-drawer-lib-name" title={name}>
                              {name}
                            </span>
                            {tags.length > 0 ? (
                              <span className="react-chat-skill-item-tags wf-drawer-lib-tags">
                                {tags.map((label) => {
                                  const meta = tagMetaForLabel(label)
                                  return (
                                    <span
                                      key={label}
                                      className="react-chat-skill-item-tag"
                                      style={
                                        {
                                          ['--tag-color' as string]: meta.color || '#64748b',
                                        } as CSSProperties
                                      }
                                      title={label}
                                    >
                                      {meta.icon ? `${meta.icon} ` : ''}
                                      {label}
                                    </span>
                                  )
                                })}
                              </span>
                            ) : null}
                          </div>
                          <span className="wf-drawer-lib-desc">
                            {caps.description || code}
                          </span>
                        </div>
                        <span className="wf-drawer-lib-add" aria-hidden>
                          <Plus size={14} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}

        {tab === 'config' ? (
          <>
            {!selectedId ? (
              <div className="wf-drawer-empty">
                <div className="wf-drawer-empty-icon">
                  <Sparkles size={20} />
                </div>
                <p>{tr('workflow.configEmptyHint')}</p>
                <span>{tr('workflow.configEmptySub')}</span>
              </div>
            ) : null}

            {(isStart || !selectedId) && (
              <DrawerPanel title={tr('workflow.panelWorkflow')}>
                <label className="wf-drawer-label" htmlFor="wf-drawer-goal">
                  {tr('workflow.overallGoal')}
                </label>
                <textarea
                  id="wf-drawer-goal"
                  className="wf-drawer-control wf-drawer-control--area"
                  rows={3}
                  value={workflowGoal}
                  placeholder={tr('workflow.goalPlaceholder')}
                  onChange={(e) => onWorkflowGoalChange(e.target.value)}
                />
              </DrawerPanel>
            )}

            {(isStart || !selectedId) && (
              <DrawerPanel title={tr('workflow.userInputsTitle')}>
                <RunVarsPanel vars={runVars} onManage={onOpenAppSettings} />
              </DrawerPanel>
            )}

            {isStart ? (
              <p className="wf-drawer-tip">{tr('workflow.startTip')}</p>
            ) : null}

            {isAnswer ? (
              <DrawerPanel title={tr('workflow.answerTitle')}>
                <p className="wf-drawer-tip" style={{ margin: 0 }}>
                  {tr('workflow.answerTipPre')}<strong>{tr('workflow.agentStepTitle')}</strong>{tr('workflow.answerTipPost')}
                </p>
                <p className="wf-drawer-tip" style={{ marginTop: 10 }}>
                  {answerSourceRef
                    ? tr('workflow.answerFromStep', { ref: answerSourceRef })
                    : tr('workflow.answerNotLinked')}
                </p>
              </DrawerPanel>
            ) : null}

            {isStep && selectedStep ? (
              <>
                {upstreamSteps.length > 0 ? (
                  <div className="wf-drawer-upstream-banner" role="note">
                    {tr('workflow.upstreamBanner')}
                  </div>
                ) : null}

                <DrawerPanel title={tr('workflow.basicInfo')}>
                  <ResourceRow
                    icon={<Bot size={15} />}
                    label={tr('workflow.whoDoesIt')}
                    summary={agentSummary}
                    badge="suggest"
                    onClick={() => setAgentOpen(true)}
                  />
                  {hasAgent ? (
                    <div className="wf-drawer-agent-caps wf-drawer-agent-caps--panel">
                      <div
                        className="wf-drawer-agent-caps-head"
                        onClick={() => setCapsFold((v) => !v)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCapsFold((v) => !v) } }}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <span>{tr('workflow.agentBundledCaps')}</span>
                        {capsFold ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </div>
                      {!capsFold && (<>
                      {selectedAgentCaps.description ? (
                        <p className="wf-drawer-agent-caps-desc">
                          {selectedAgentCaps.description}
                        </p>
                      ) : (
                        <p className="wf-drawer-agent-caps-desc is-muted">{tr('workflow.noTextDesc')}</p>
                      )}
                      <div className="wf-drawer-cap-block">
                        <div className="wf-drawer-cap-block-label">
                          {tr('workflow.skillsTab')}
                          {selectedAgentCaps.skillTotal
                            ? ` · ${selectedAgentCaps.skillTotal}`
                            : ''}
                        </div>
                        {skillTags.length ? (
                          <div className="wf-drawer-cap-tags">
                            {skillTags.map((s) => (
                              <span key={s.id} className="wf-drawer-cap-tag" title={s.id}>
                                {s.label}
                              </span>
                            ))}
                            {selectedAgentCaps.skillsMore > 0 ? (
                              <span className="wf-drawer-cap-tag is-more">
                                +{selectedAgentCaps.skillsMore}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <p className="wf-drawer-tip" style={{ margin: 0 }}>
                            {tr('workflow.noSkillsSeparate')}
                          </p>
                        )}
                      </div>
                      <div className="wf-drawer-cap-block">
                        <div className="wf-drawer-cap-block-label">
                          {tr('workflow.toolsTab')}
                          {toolDisplay.total ? ` · ${toolDisplay.total}` : ''}
                          {toolDisplay.mode === 'default' ? tr('workflow.defaultPackSuffix') : ''}
                        </div>
                        {toolDisplay.tags.length ? (
                          <div className="wf-drawer-cap-tags">
                            {toolDisplay.tags.map((t) => (
                              <span key={t.id} className="wf-drawer-cap-tag" title={t.id}>
                                {t.label}
                              </span>
                            ))}
                            {toolDisplay.more > 0 ? (
                              <span className="wf-drawer-cap-tag is-more">+{toolDisplay.more}</span>
                            ) : null}
                          </div>
                        ) : (
                          <p className="wf-drawer-tip" style={{ margin: 0 }}>
                            {tr('workflow.toolsLoading')}
                          </p>
                        )}
                        {toolDisplay.mode === 'default' ? (
                          <p className="wf-drawer-tip" style={{ margin: '6px 0 0' }}>
                            {tr('workflow.defaultToolsNote')}
                          </p>
                        ) : null}
                      </div>
                      </>
                      )}
                      <button
                        type="button"
                        className="wf-drawer-text-btn"
                        onClick={() => setAgentOpen(true)}
                      >
                        {tr('workflow.changeAgentFull')}
                      </button>
                      <p className="wf-drawer-tip" style={{ margin: '6px 0 0' }}>
                        {tr('workflow.optionalCapsNote')}
                      </p>
                    </div>
                  ) : (
                    <p className="wf-drawer-tip" style={{ marginTop: 8 }}>
                      {tr('workflow.pickAgentFirst')}
                    </p>
                  )}

                  <div className="wf-drawer-field" style={{ marginTop: 14 }}>
                    <label className="wf-drawer-label" htmlFor="wf-drawer-task">
                      {tr('workflow.whatToDo')}
                      <FieldBadge kind="suggest" />
                    </label>
                    <SlashVarTextarea
                      id="wf-drawer-task"
                      className="wf-drawer-control wf-drawer-control--area wf-drawer-control--task"
                      rows={7}
                      value={taskText}
                      placeholder={tr('workflow.taskPlaceholder')}
                      items={slashVarItems}
                      onChange={(next) => onStepChange({ goal: next })}
                    />
                    <InsertChipBar
                      label={tr('workflow.runVarsLabel')}
                      hint={tr('workflow.runVarsHint')}
                      chips={paramChips}
                      onInsert={(text) =>
                        onStepChange({ goal: appendInline(selectedStep.goal || taskText, text) })
                      }
                      emptyText={tr('workflow.noUserInputs')}
                      emptyActionLabel={tr('workflow.goAdd')}
                      onEmptyAction={onOpenAppSettings}
                    />
                    {upstreamChips.length ? (
                      <InsertChipBar
                        label={tr('workflow.refUpstreamLabel')}
                        hint={tr('workflow.refUpstreamHint')}
                        chips={upstreamChips}
                        showToken={false}
                        onInsert={(text) =>
                          onStepChange({ goal: appendBlock(selectedStep.goal || taskText, text) })
                        }
                      />
                    ) : null}
                  </div>
                </DrawerPanel>

                <FoldSection
                  title={tr('workflow.capConfig')}
                  subtitle={
                    capCount > 0 ? tr('workflow.capsMounted', { n: capCount }) : tr('workflow.capsEmptySub')
                  }
                  open={capSectionOpen}
                  onToggle={() => setCapSectionOpen((v) => !v)}
                >
                  <p className="wf-drawer-tip" style={{ marginTop: 0 }}>
                    {tr('workflow.capTipPre')}<strong>{tr('workflow.capTipEm')}</strong>{tr('workflow.capTipPost')}
                  </p>
                  <ResourceRow
                    icon={<Sparkles size={15} />}
                    label={tr('workflow.capPickerTitle')}
                    summary={capSummary}
                    badge="optional"
                    onClick={() => setCapOpen(true)}
                  />
                  {mcpServers.length > 0 ? (
                    <div className="wf-drawer-field wf-drawer-field--mcp">
                      <label className="wf-drawer-label">
                        {tr('workflow.mcpServices')}
                        <FieldBadge kind="optional" />
                      </label>
                      <div className="wf-drawer-mcp-grid">
                        {mcpServers.map((m) => {
                          const checked = mcpSelected.includes(m.name)
                          return (
                            <button
                              key={m.name}
                              type="button"
                              className={`wf-drawer-mcp-pill${checked ? ' is-on' : ''}`}
                              title={m.description || m.name}
                              onClick={() => {
                                const next = checked
                                  ? mcpSelected.filter((n) => n !== m.name)
                                  : [...mcpSelected, m.name]
                                onStepChange({ mcp_servers: joinCsvField(next) })
                              }}
                            >
                              {m.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </FoldSection>

                <FoldSection
                  title={tr('workflow.advancedSettings')}
                  subtitle={tr('workflow.advancedSub')}
                  open={advancedOpen}
                  onToggle={() => setAdvancedOpen((v) => !v)}
                >
                  <p className="wf-drawer-tip" style={{ marginTop: 0 }}>
                    {tr('workflow.advancedTip')}
                  </p>
                  {ADVANCED_DETAIL_KEYS.map((key) => {
                    const field = getStepFieldMap()[key]
                    if (!field) return null
                    const labels: Record<(typeof ADVANCED_DETAIL_KEYS)[number], string> = {
                      description: tr('workflow.advLabelDescription'),
                      instruction: tr('workflow.advLabelInstruction'),
                      inputs: tr('workflow.advLabelInputs'),
                      outputs: tr('workflow.advLabelOutputs'),
                      acceptance: tr('workflow.advLabelAcceptance'),
                      failure: tr('workflow.advLabelFailure'),
                      model: tr('workflow.advLabelModel'),
                      project_path: tr('workflow.advLabelProjectPath'),
                    }
                    const multiline = key !== 'model' && key !== 'project_path'
                    return (
                      <div key={key} className="wf-drawer-field">
                        <label className="wf-drawer-label" htmlFor={`wf-drawer-opt-${key}`}>
                          {labels[key]}
                          <FieldBadge kind="optional" />
                        </label>
                        {key === 'instruction' ? (
                          <>
                            <SlashVarTextarea
                              id={`wf-drawer-opt-${key}`}
                              className="wf-drawer-control wf-drawer-control--area"
                              rows={3}
                              value={String(selectedStep.instruction ?? '')}
                              placeholder={tr('workflow.instructionPlaceholder')}
                              items={slashVarItems.filter((i) => i.id.startsWith('var:'))}
                              onChange={(next) => onStepChange({ instruction: next })}
                            />
                            <InsertChipBar
                              label={tr('workflow.groupUserInput')}
                              chips={paramChips}
                              onInsert={(text) =>
                                onStepChange({
                                  instruction: appendInline(selectedStep.instruction, text),
                                })
                              }
                            />
                          </>
                        ) : multiline ? (
                          <textarea
                            id={`wf-drawer-opt-${key}`}
                            className="wf-drawer-control wf-drawer-control--area"
                            rows={2}
                            value={String(selectedStep[key] ?? '')}
                            placeholder={field.placeholder || tr('workflow.optionalPlaceholder')}
                            onChange={(e) => onStepChange({ [key]: e.target.value })}
                          />
                        ) : key === 'project_path' ? (
                          <WorkspaceFolderInput
                            id={`wf-drawer-opt-${key}`}
                            className="wf-drawer-control"
                            value={String(selectedStep[key] ?? '')}
                            placeholder={field.placeholder || tr('workflow.optionalPlaceholder')}
                            onChange={(next) => onStepChange({ [key]: next })}
                          />
                        ) : (
                          <input
                            id={`wf-drawer-opt-${key}`}
                            className="wf-drawer-control"
                            value={String(selectedStep[key] ?? '')}
                            placeholder={field.placeholder || tr('workflow.optionalPlaceholder')}
                            onChange={(e) => onStepChange({ [key]: e.target.value })}
                          />
                        )}
                      </div>
                    )
                  })}
                </FoldSection>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {tab === 'library' ? (
        <div className="wf-drawer-foot">
          <button
            type="button"
            className="wf-drawer-foot-btn"
            disabled={!hasSelection}
            onClick={onDeleteSelected}
          >
            <Trash2 size={14} />
            {tr('workflow.deleteSelectedNodes')}
          </button>
        </div>
      ) : isStep ? (
        <div className="wf-drawer-foot">
          <button type="button" className="wf-drawer-foot-btn" onClick={onDeleteSelected}>
            <Trash2 size={14} />
            {tr('workflow.deleteThisNode')}
          </button>
        </div>
      ) : null}

      <AgentPickerModal
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        agents={agents}
        tools={tools}
        skills={skills}
        loading={loading}
        selected={selectedStep?.assigned_agent}
        onConfirm={(code) => {
          onStepChange({ assigned_agent: code })
          setAgentOpen(false)
        }}
      />
      <CapabilityPickerModal
        open={capOpen}
        onClose={() => setCapOpen(false)}
        skills={skills}
        tools={tools}
        loading={loading}
        selectedSkills={skillSelected}
        selectedTools={toolSelected}
        onConfirm={(next) => {
          onStepChange({
            skills: joinCsvField(next.skills.map((s) => s.name)),
            tools: joinCsvField(next.tools),
          })
          setCapOpen(false)
        }}
      />
    </>
  ) : null

  return (
    <>
      <aside
        className={`wf-drawer${open ? ' is-open' : ''}${
          isConfigPanel ? ' is-config wf-drawer--config' : ' wf-drawer--library'
        }`}
      >
        <div className="wf-drawer-top">
          {isLibraryPanel ? (
            <>
              <div className="wf-drawer-panel-heading">
                <Layers size={15} />
                <span>{tr('workflow.nodeLibraryTitle')}</span>
              </div>
              <button
                type="button"
                className="wf-drawer-collapse"
                onClick={onToggle}
                title={tr('workflow.collapseLibrary')}
              >
                <ChevronLeft size={16} />
              </button>
            </>
          ) : (
            <div className="wf-drawer-panel-heading">
              <Settings2 size={15} />
              <span>
                {isStart
                  ? tr('workflow.startNodeTitle')
                  : isAnswer
                    ? tr('workflow.outputNodeTitle')
                    : tr('workflow.nodeConfigTitle')}
              </span>
            </div>
          )}
        </div>
        {body}
      </aside>
      {isLibraryPanel && !open ? (
        <button type="button" className="wf-drawer-expand" onClick={onToggle} title={tr('workflow.expandLibrary')}>
          <ChevronRight size={16} />
        </button>
      ) : null}
    </>
  )
}
