import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnMove,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import StepNode, { type StepNodeData } from './app-workflow/StepNode.tsx'
import StartNode from './app-workflow/StartNode.tsx'
import AnswerNode from './app-workflow/AnswerNode.tsx'
import DeletableSmoothStepEdge from './app-workflow/DeletableSmoothStepEdge.tsx'
import { WorkflowDrawer } from './app-workflow/WorkflowDrawer.tsx'
import { AgentPickerModal } from './app-workflow/AgentPickerModal.tsx'
import {
  WorkflowStudioProvider,
  type StepExecStatus,
} from './app-workflow/WorkflowStudioContext.tsx'
import { WorkflowToolbar } from './app-workflow/WorkflowToolbar.tsx'
import { WorkflowStatusBar } from './app-workflow/WorkflowStatusBar.tsx'
import { WorkflowOnboardingBanner } from './app-workflow/WorkflowOnboardingBanner.tsx'
import { DebugPanel } from './app-workflow/DebugPanel.tsx'
import { useWorkflowResources } from '../hooks/useWorkflowResources.ts'
import { useT } from '../lib/useI18n'
import { toast } from '../../components/toast.js'
import {
  ANSWER_NODE_ID,
  START_NODE_ID,
  answerFromRefFromEdges,
  applyFlowPatch,
  createAnswerNode,
  flowToSteps,
  realEdges,
} from '../lib/app-workflow-flow.ts'
import {
  canvasJsonToFlowSeed,
  flowToCanvasJson,
  normalizeCanvasRaw,
  type AppCanvasJson,
} from '../lib/app-workflow-canvas-json.ts'
import {
  defaultNodePosition,
  nextStepRef,
  normalizeSteps,
  stepToNodeData,
  stepsToExport,
  wouldCreateCycle,
  type AppWorkflowPlan,
  type AppWorkflowStep,
} from '../lib/app-workflow-plan.ts'

const nodeTypes = { stepNode: StepNode, startNode: StartNode, answerNode: AnswerNode }
const edgeTypes = { wfEdge: DeletableSmoothStepEdge, smoothstep: DeletableSmoothStepEdge }

const PALETTE_DND_TYPE = 'application/gogo-wf-node'

/** 空画布快速模板：点击一键填充，降低上手门槛（模块级文案改为渲染期取词） */
function buildQuickTemplates(t: (key: string, params?: Record<string, unknown>) => string) {
  return [
    {
      id: 'simple-3step',
      name: t('workflow.tplSimpleName'),
      desc: t('workflow.tplSimpleDesc'),
      icon: '📝',
      steps: [
        { name: t('workflow.tplSimpleStep1Name'), goal: t('workflow.tplSimpleStep1Goal') },
        { name: t('workflow.tplSimpleStep2Name'), goal: t('workflow.tplSimpleStep2Goal') },
        { name: t('workflow.tplSimpleStep3Name'), goal: t('workflow.tplSimpleStep3Goal') },
      ],
    },
    {
      id: 'content-creation',
      name: t('workflow.tplContentName'),
      desc: t('workflow.tplContentDesc'),
      icon: '✍️',
      steps: [
        { name: t('workflow.tplContentStep1Name'), goal: t('workflow.tplContentStep1Goal') },
        { name: t('workflow.tplContentStep2Name'), goal: t('workflow.tplContentStep2Goal') },
        { name: t('workflow.tplContentStep3Name'), goal: t('workflow.tplContentStep3Goal') },
        { name: t('workflow.tplContentStep4Name'), goal: t('workflow.tplContentStep4Goal') },
      ],
    },
    {
      id: 'data-analysis',
      name: t('workflow.tplDataName'),
      desc: t('workflow.tplDataDesc'),
      icon: '📊',
      steps: [
        { name: t('workflow.tplDataStep1Name'), goal: t('workflow.tplDataStep1Goal') },
        { name: t('workflow.tplDataStep2Name'), goal: t('workflow.tplDataStep2Goal') },
        { name: t('workflow.tplDataStep3Name'), goal: t('workflow.tplDataStep3Goal') },
        { name: t('workflow.tplDataStep4Name'), goal: t('workflow.tplDataStep4Goal') },
      ],
    },
  ]
}

const EDGE_STROKE = '#B8BDCA'
const EDGE_STYLE = { stroke: EDGE_STROKE, strokeWidth: 2 }
const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: EDGE_STROKE,
} as const
const DEFAULT_EDGE_OPTS = {
  type: 'wfEdge' as const,
  style: EDGE_STYLE,
  markerEnd: EDGE_MARKER,
  interactionWidth: 24,
}

export type AppWorkflowCanvasHandle = {
  getPlan: () => AppWorkflowPlan
  isDirty: () => boolean
  saveDraft: () => Promise<void>
  publishApp: () => Promise<void>
  addStep: () => void
  deleteSelected: () => void
  getGoal: () => string
  setGoal: (goal: string) => void
  setExecStatus: (byRef: Record<string, StepExecStatus>) => void
  clearExecStatus: () => void
}

type Props = {
  goal: string
  steps: Array<Record<string, unknown>>
  canvas?: AppCanvasJson | Record<string, unknown> | null
  onSave: (plan: AppWorkflowPlan) => Promise<void>
  /** Return false to abort (e.g. user dismissed soft publish warnings). */
  onPublish: (plan: AppWorkflowPlan) => Promise<void | boolean>
  variant?: 'default' | 'fullscreen'
  onOpenAppSettings?: () => void
  onOpenHistory?: () => void
  onOpenVersions?: () => void
  onOpenApiAccess?: () => void
  appName?: string
  appStatus?: string
  appIcon?: string
  /** App run-time parameter slots (for insert chips in step editor) */
  appParameters?: Array<{ name?: string; label?: string; type?: string; required?: boolean }>
  onBack?: () => void
  onRun?: () => void
  onRename?: (name: string) => void
  /** 调试运行中点击步骤节点 → 查看该步执行详情（不离开应用页） */
  onInspectStep?: (stepRef: string) => void
  appId?: string
  runId?: string
  parameters?: Record<string, string>
}

function trimOptionalFields(patch: Partial<AppWorkflowStep>): Partial<AppWorkflowStep> {
  const next = { ...patch }
  for (const key of Object.keys(next) as (keyof AppWorkflowStep)[]) {
    if (key === 'name' || key === 'ref' || key === 'depends_on' || key === 'canvas') continue
    const v = next[key]
    // 只 trim，保留空字符串（用户清空字段后需要能保存为空）
    if (typeof v === 'string') next[key] = v.trim() as never
  }
  if (typeof next.name === 'string') next.name = next.name.trim() || undefined
  return next
}

function FlowViewportBridge({
  initialViewport,
  onViewportChange,
}: {
  initialViewport?: Viewport
  onViewportChange: (vp: Viewport) => void
}) {
  const { setViewport, getViewport } = useReactFlow()
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current) return
    if (!initialViewport) return
    applied.current = true
    setViewport(initialViewport, { duration: 0 })
  }, [initialViewport, setViewport])

  useEffect(() => {
    onViewportChange(getViewport())
  }, [getViewport, onViewportChange])

  return null
}

function FitViewActionBridge({
  actionRef,
}: {
  actionRef: React.MutableRefObject<(() => void) | null>
}) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    actionRef.current = () => {
      void fitView({ padding: 0.24, duration: 280 })
    }
    return () => {
      actionRef.current = null
    }
  }, [fitView, actionRef])
  return null
}

function FlowInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  onNodeClick,
  onPaneClick,
  onMoveEnd,
  markDirty,
  setEdges,
  seedViewport,
  onViewportPersist,
  fitViewOnInit,
  isFullscreen,
  addStep,
  deleteSelected,
  busy,
  runAction,
  onDropAgent,
  onDropAnswer,
  dragOver,
  setDragOver,
  arrangeActionRef,
  stepCount,
  onApplyTemplate,
}: {
  nodes: Node<StepNodeData>[]
  edges: Edge[]
  onNodesChange: ReturnType<typeof useNodesState<Node<StepNodeData>>>[2]
  onEdgesChange: ReturnType<typeof useEdgesState>[2]
  onConnect: (conn: Connection) => void
  isValidConnection?: (conn: Connection) => boolean
  onNodeClick: (e: React.MouseEvent, node: Node<StepNodeData>) => void
  onPaneClick: () => void
  onMoveEnd: OnMove
  markDirty: () => void
  setEdges: ReturnType<typeof useEdgesState>[1]
  seedViewport?: Viewport
  onViewportPersist: (vp: Viewport) => void
  fitViewOnInit: boolean
  isFullscreen: boolean
  addStep: () => void
  deleteSelected: () => void
  busy: 'save' | 'publish' | null
  runAction: (kind: 'save' | 'publish') => void
  onDropAgent: (pos: { x: number; y: number }) => void
  onDropAnswer: (pos: { x: number; y: number }) => void
  dragOver: boolean
  setDragOver: (v: boolean) => void
  arrangeActionRef?: React.MutableRefObject<(() => void) | null>
  /** 步骤节点数量，用于判断是否显示空状态 */
  stepCount: number
  /** 应用模板的回调 */
  onApplyTemplate?: (templateId: string) => void
}) {
  const { screenToFlowPosition } = useReactFlow()
  const t = useT()
  const quickTemplates = buildQuickTemplates(t)

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes(PALETTE_DND_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [setDragOver])

  const onDragLeave = useCallback(() => setDragOver(false), [setDragOver])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      setDragOver(false)
      const kind = e.dataTransfer.getData(PALETTE_DND_TYPE)
      if (kind !== 'agent-step' && kind !== 'answer' && !kind.startsWith('agent:')) return
      e.preventDefault()
      const raw = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const pos = {
        x: Math.round(raw.x / 20) * 20,
        y: Math.round(raw.y / 20) * 20,
      }
      if (kind === 'answer') onDropAnswer?.(pos)
      else if (kind.startsWith('agent:')) {
        const agentCode = kind.slice('agent:'.length)
        onDropAgent?.(pos, agentCode)
      } else onDropAgent?.(pos)
    },
    [onDropAgent, onDropAnswer, screenToFlowPosition, setDragOver],
  )

  return (
    <div
      className={`app-rf-flow-wrap${dragOver ? ' is-drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes) => {
          onNodesChange(changes)
          // 仅拖拽落点算脏；选中/尺寸等交互不算未保存
          if (changes.some((c) => c.type === 'position' && c.dragging === false)) markDirty()
        }}
        onEdgesChange={(changes) => {
          onEdgesChange(changes)
          // select 会随点选节点/边频繁触发，不能当未保存
          const structural = changes.some(
            (c) => c.type === 'remove' || c.type === 'add',
          )
          if (structural) {
            markDirty()
            // 用函数式更新保证拿到最新 edges，避免 setTimeout 陈旧闭包
            setEdges((eds) => applyFlowPatch(nodes, eds, {}).edges)
          }
        }}
        onKeyDown={(e) => {
          // 接管 Delete/Backspace 删除，统一走 deleteSelected 走完整清理逻辑
          if (e.key === 'Delete' || e.key === 'Backspace') {
            // 避免在输入框中误删
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
              return
            }
            e.preventDefault()
            deleteSelected()
          }
        }}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        fitView={fitViewOnInit}
        fitViewOptions={{ padding: 0.24, includeHiddenNodes: false }}
        snapToGrid
        snapGrid={[20, 20]}
        edgesFocusable
        edgesReconnectable={false}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#5B5FEF', strokeWidth: 2 }}
        defaultEdgeOptions={DEFAULT_EDGE_OPTS}
        proOptions={{ hideAttribution: true }}
      >
        <FlowViewportBridge
          initialViewport={seedViewport}
          onViewportChange={onViewportPersist}
        />
        {arrangeActionRef ? <FitViewActionBridge actionRef={arrangeActionRef} /> : null}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="var(--wf-grid-dot, #dde1eb)"
          bgColor="var(--wf-studio-bg, #f7f8fc)"
        />
        <Controls showInteractive={false} position="bottom-left" className="wf-controls" />
        <MiniMap
          className="wf-minimap"
          position="bottom-right"
          nodeColor={(n) =>
            n.type === 'startNode' ? '#22A06B' : n.type === 'answerNode' ? '#8B90A0' : '#5B5FEF'
          }
          nodeStrokeWidth={0}
          maskColor="var(--wf-minimap-mask)"
          pannable
          zoomable
        />

        {!isFullscreen ? (
          <>
            <Panel position="top-left" className="wf-float-panel">
              <button type="button" className="btn btn-secondary btn-sm" onClick={addStep}>
                {t('workflow.addStep')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={deleteSelected}>
                {t('workflow.deleteTitle')}
              </button>
            </Panel>
            <Panel position="top-right" className="wf-float-panel">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!!busy}
                onClick={() => runAction('save')}
              >
                {busy === 'save' ? t('workflow.saving') : t('workflow.saveDraft')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!!busy}
                onClick={() => runAction('publish')}
              >
                {busy === 'publish' ? t('workflow.publishing') : t('workflow.publish')}
              </button>
            </Panel>
          </>
        ) : null}

        {/* 空画布模板引导：只有 0 个步骤节点时显示 */}
        {stepCount === 0 && onApplyTemplate ? (
          <Panel position="center" className="wf-empty-templates">
            <div className="wf-empty-templates-header">
              <h3>{t('workflow.tplHeaderTitle')}</h3>
              <p>{t('workflow.tplHeaderDesc')}</p>
            </div>
            <div className="wf-empty-templates-grid">
              {quickTemplates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  className="wf-empty-template-card"
                  onClick={() => onApplyTemplate(tmpl.id)}
                >
                  <div className="wf-empty-template-icon">{tmpl.icon}</div>
                  <div className="wf-empty-template-name">{tmpl.name}</div>
                  <div className="wf-empty-template-desc">{tmpl.desc}</div>
                  <div className="wf-empty-template-meta">{t('workflow.tplStepsMeta', { n: tmpl.steps.length })}</div>
                </button>
              ))}
            </div>
            <div className="wf-empty-templates-footer">
              {t('workflow.tplFooterHint')}
            </div>
          </Panel>
        ) : null}
      </ReactFlow>
    </div>
  )
}

export const AppWorkflowCanvas = forwardRef<AppWorkflowCanvasHandle, Props>(function AppWorkflowCanvas(
  {
    goal: initialGoal,
    steps: initialSteps,
    canvas: initialCanvas,
    onSave,
    onPublish,
    variant = 'default',
    onOpenAppSettings,
    onOpenHistory,
    onOpenVersions,
    onOpenApiAccess,
    appName = '',
    appStatus = 'draft',
    appIcon = '◇',
    appParameters = [],
    onBack,
    onRun,
    onRename,
    onInspectStep,
    appId,
    runId,
    parameters = {},
  },
  ref,
) {
  const isFullscreen = variant === 'fullscreen'
  const t = useT()
  const normalized = useMemo(() => normalizeSteps(initialSteps), [initialSteps])
  const canvasNorm = useMemo(() => normalizeCanvasRaw(initialCanvas), [initialCanvas])
  const seed = useMemo(
    () => canvasJsonToFlowSeed(normalized, canvasNorm),
    [normalized, canvasNorm],
  )

  const [goal, setGoal] = useState(initialGoal || '')
  const [nodes, setNodes, onNodesChange] = useNodesState(seed.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(seed.edges)
  const [viewport, setViewportState] = useState<Viewport | null>(seed.viewport || null)
  const [dirty, setDirty] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [titleDraft, setTitleDraft] = useState(appName)
  const arrangeActionRef = useRef<(() => void) | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [agentPickerNodeId, setAgentPickerNodeId] = useState<string | null>(null)
  const [debugPanelOpen, setDebugPanelOpen] = useState(false)
  const [execByRef, setExecByRef] = useState<Record<string, StepExecStatus>>({})
  const { agents, tools: toolCatalog, loading: agentsLoading } = useWorkflowResources(true)

  useEffect(() => {
    queueMicrotask(() => setTitleDraft(appName))
  }, [appName])

  const markDirty = useCallback(() => setDirty(true), [])

  const setExecStatus = useCallback((byRef: Record<string, StepExecStatus>) => {
    setExecByRef(byRef && typeof byRef === 'object' ? { ...byRef } : {})
  }, [])

  const clearExecStatus = useCallback(() => setExecByRef({}), [])

  const onViewportPersist = useCallback((vp: Viewport) => {
    setViewportState(vp)
  }, [])

  const exportPlan = useCallback((): AppWorkflowPlan => {
    const steps = flowToSteps(nodes, edges)
    const canvas = flowToCanvasJson(nodes, edges, viewport)
    return stepsToExport(goal, steps, canvas)
  }, [goal, nodes, edges, viewport])

  const patchFlow = useCallback(
    (patch: { nodes?: Node<StepNodeData>[]; edges?: typeof edges }) => {
      const next = applyFlowPatch(nodes, edges, patch)
      setNodes(next.nodes)
      setEdges(next.edges)
    },
    [nodes, edges, setNodes, setEdges],
  )

  const toggleDrawer = useCallback(() => {
    setDrawerOpen((open) => !open)
  }, [])

  const selectNode = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      setNodes((ns) => ns.map((n) => ({ ...n, selected: id != null && n.id === id })))
    },
    [setNodes],
  )

  const openAgentPicker = useCallback(
    (nodeId: string) => {
      if (!nodeId || nodeId === START_NODE_ID) return
      selectNode(nodeId)
      setAgentPickerNodeId(nodeId)
    },
    [selectNode],
  )

  const agentPickerSelected = useMemo(() => {
    if (!agentPickerNodeId) return null
    const node = nodes.find((n) => n.id === agentPickerNodeId && n.type === 'stepNode')
    return node?.data?.assigned_agent ?? null
  }, [agentPickerNodeId, nodes])

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node<StepNodeData>) => {
      const ref = String(node.data?.ref || '').trim()
      const inspecting = !!(ref && onInspectStep && Object.keys(execByRef).length > 0)
      // 调试中点节点只看执行详情，不抢开配置侧栏
      if (inspecting) {
        setSelectedId(node.id)
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === node.id })))
        onInspectStep?.(ref)
        return
      }
      selectNode(node.id)
    },
    [selectNode, onInspectStep, execByRef, setNodes],
  )

  const onPaneClick = useCallback(() => selectNode(null), [selectNode])

  const selectedStep = useMemo(() => {
    if (!selectedId || selectedId === START_NODE_ID) return null
    const node = nodes.find((n) => n.id === selectedId && n.type === 'stepNode')
    return node?.data ?? null
  }, [nodes, selectedId])

  const selectedDependsOn = useMemo(() => {
    if (!selectedId || selectedId === START_NODE_ID || selectedId === ANSWER_NODE_ID) {
      return [] as string[]
    }
    return edges
      .filter(
        (e) =>
          e.target === selectedId &&
          e.source !== START_NODE_ID &&
          e.source !== ANSWER_NODE_ID,
      )
      .map((e) => e.source)
  }, [edges, selectedId])

  const paramSlots = useMemo(
    () =>
      (appParameters || [])
        .map((p) => ({
          name: String(p?.name || '').trim(),
          label: String(p?.label || p?.name || '').trim(),
          type: String(p?.type || 'text'),
          required: p?.required !== false,
        }))
        .filter((p) => p.name),
    [appParameters],
  )

  const upstreamStepRefs = useMemo(() => {
    const steps = flowToSteps(nodes, edges)
    const byRef = new Map(steps.map((s) => [s.ref, s]))
    return selectedDependsOn.map((ref) => {
      const step = byRef.get(ref)
      return {
        ref,
        name: String(step?.name || step?.goal || t('workflow.stepRef', { ref })).trim() || t('workflow.stepRef', { ref }),
      }
    })
  }, [nodes, edges, selectedDependsOn, t])

  const hasStepSelection = useMemo(
    () => nodes.some((n) => n.selected && n.id !== START_NODE_ID),
    [nodes],
  )

  const nodeCount = useMemo(() => nodes.length, [nodes])
  const stepCount = useMemo(
    () => nodes.filter((n) => n.type === 'stepNode').length,
    [nodes],
  )
  const edgeCount = useMemo(() => realEdges(edges).length, [edges])

  const updateStep = useCallback(
    (nodeId: string, patch: Partial<AppWorkflowStep>) => {
      if (nodeId === START_NODE_ID) return
      const normalizedPatch = trimOptionalFields(patch)
      markDirty()
      patchFlow({
        nodes: nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...normalizedPatch,
                  name: normalizedPatch.name ?? n.data.name,
                },
              }
            : n,
        ),
      })
    },
    [markDirty, nodes, patchFlow],
  )

  const updateSelectedStep = useCallback(
    (patch: Partial<AppWorkflowStep>) => {
      if (!selectedId || selectedId === START_NODE_ID) return
      updateStep(selectedId, patch)
    },
    [selectedId, updateStep],
  )

  const isValidConnection = useCallback(
    (conn: Connection): boolean => {
      if (!conn.source || !conn.target || conn.source === conn.target) return false
      if (conn.target === START_NODE_ID) return false
      if (conn.source === ANSWER_NODE_ID) return false
      // 答案节点只接受 Agent 步骤连入；不允许「开始」直连
      if (conn.target === ANSWER_NODE_ID) {
        if (conn.source === START_NODE_ID) return false
        if (!nodes.some((n) => n.id === conn.source && n.type === 'stepNode')) return false
        return true
      }
      if (conn.source === START_NODE_ID) {
        if (conn.target === ANSWER_NODE_ID) return false
        return true
      }
      const real = edges.filter((e) => e.source !== START_NODE_ID)
      if (real.some((e) => e.source === conn.source && e.target === conn.target)) return false
      if (wouldCreateCycle(real, conn.source, conn.target)) return false
      return true
    },
    [edges, nodes],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) {
        toast.warning(t('workflow.errConnectSelf'), { duration: 2000 })
        return
      }
      if (conn.target === START_NODE_ID) {
        toast.warning(t('workflow.errStartNoIn'), { duration: 2000 })
        return
      }
      if (conn.source === ANSWER_NODE_ID) {
        toast.warning(t('workflow.errAnswerNoOut'), { duration: 2000 })
        return
      }
      // 答案节点只接受 Agent 步骤连入；不允许「开始」直连
      if (conn.target === ANSWER_NODE_ID) {
        if (conn.source === START_NODE_ID) {
          toast.warning(t('workflow.errStartToAnswerNeedStep'), { duration: 2500 })
          return
        }
        if (!nodes.some((n) => n.id === conn.source && n.type === 'stepNode')) {
          toast.warning(t('workflow.errOnlyStepToAnswer'), { duration: 2000 })
          return
        }
        markDirty()
        const cleared = edges.filter((e) => e.target !== ANSWER_NODE_ID)
        const link = {
          id: `${conn.source}->${ANSWER_NODE_ID}`,
          source: conn.source,
          target: ANSWER_NODE_ID,
          sourceHandle: conn.sourceHandle || 'out',
          targetHandle: conn.targetHandle || 'in',
          ...DEFAULT_EDGE_OPTS,
        }
        patchFlow({ edges: [...cleared.filter((e) => e.source !== START_NODE_ID || e.target !== ANSWER_NODE_ID), link] })
        toast.success(t('workflow.okFinalOutputSet'), { duration: 1500 })
        return
      }

      if (conn.source === START_NODE_ID) {
        if (conn.target === ANSWER_NODE_ID) {
          toast.warning(t('workflow.errStartToAnswer'), { duration: 2000 })
          return
        }
        markDirty()
        // 接到「开始」：清掉该节点其它上游依赖，并确保存在 start → target
        const cleared = edges.filter(
          (e) =>
            !(e.target === conn.target && e.source !== START_NODE_ID) &&
            !(e.source === START_NODE_ID && e.target === conn.target),
        )
        const startLink = {
          id: `${START_NODE_ID}->${conn.target}`,
          source: START_NODE_ID,
          target: conn.target,
          sourceHandle: conn.sourceHandle || 'out',
          targetHandle: conn.targetHandle || 'in',
          ...DEFAULT_EDGE_OPTS,
        }
        patchFlow({ edges: [...cleared, startLink] })
        toast.success(t('workflow.okStartStepSet'), { duration: 1500 })
        return
      }

      const real = edges.filter((e) => e.source !== START_NODE_ID)
      if (real.some((e) => e.source === conn.source && e.target === conn.target)) {
        toast.warning(t('workflow.errDupEdge'), { duration: 2000 })
        return
      }
      if (conn.target !== ANSWER_NODE_ID && wouldCreateCycle(real, conn.source!, conn.target!)) {
        toast.warning(t('workflow.errCycle'), { duration: 2500 })
        return
      }
      markDirty()
      const next = addEdge(
        {
          ...conn,
          sourceHandle: conn.sourceHandle || 'out',
          targetHandle: conn.targetHandle || 'in',
          ...DEFAULT_EDGE_OPTS,
        },
        real,
      )
      patchFlow({ edges: next })
    },
    [edges, nodes, markDirty, patchFlow, t],
  )

  const addStepAt = useCallback(
    (position?: { x: number; y: number }, dependsOnPrev = true) => {
      const steps = flowToSteps(nodes, edges)
      const refId = nextStepRef(steps)
      const prevRef = dependsOnPrev && steps.length ? steps[steps.length - 1].ref : null
      const prevNode = prevRef ? nodes.find((n) => n.id === prevRef) : null
      const pos =
        position ||
        (prevNode
          ? { x: prevNode.position.x + 348, y: prevNode.position.y }
          : defaultNodePosition(steps.length))
      const newStep: AppWorkflowStep = {
        ref: refId,
        name: '',
        description: '',
        depends_on: prevRef ? [prevRef] : [],
      }
      const newNode: Node<StepNodeData> = {
        id: refId,
        type: 'stepNode',
        position: pos,
        data: stepToNodeData(newStep),
      }
      const nextNodes = [...nodes, newNode]
      let nextEdges: Edge[] = edges.filter((e) => e.source !== START_NODE_ID)
      if (prevRef) {
        nextEdges = addEdge(
          {
            id: `${prevRef}->${refId}`,
            source: prevRef,
            sourceHandle: 'out',
            target: refId,
            targetHandle: 'in',
            ...DEFAULT_EDGE_OPTS,
          },
          nextEdges,
        )
      }
      markDirty()
      patchFlow({ nodes: nextNodes, edges: nextEdges })
      selectNode(refId)
      return refId
    },
    [nodes, edges, markDirty, patchFlow, selectNode],
  )

  const addStep = useCallback(() => {
    addStepAt(undefined, true)
  }, [addStepAt])

  /**
   * 应用空画布快速模板：一键生成串联步骤，降低上手门槛
   * 仅在 stepCount === 0 时可用（空画布）
   */
  const applyTemplate = useCallback(
    (templateId: string) => {
      const tmpl = buildQuickTemplates(t).find((item) => item.id === templateId)
      if (!tmpl) return

      const startX = 280
      const startY = 180
      const gapX = 360

      const newNodes: Node<StepNodeData>[] = []
      const newEdges: Edge[] = []

      tmpl.steps.forEach((s, i) => {
        const ref = String(i + 1)
        const step: AppWorkflowStep = {
          ref,
          name: s.name,
          goal: s.goal,
          description: '',
          depends_on: i === 0 ? [] : [String(i)],
        }
        newNodes.push({
          id: ref,
          type: 'stepNode',
          position: { x: startX + i * gapX, y: startY },
          data: stepToNodeData(step),
        })
        if (i > 0) {
          newEdges.push({
            id: `${String(i)}->${ref}`,
            source: String(i),
            sourceHandle: 'out',
            target: ref,
            targetHandle: 'in',
            ...DEFAULT_EDGE_OPTS,
          })
        }
      })

      markDirty()
      patchFlow({ nodes: newNodes, edges: newEdges })
      // 选中第一个节点，引导用户开始配置
      if (newNodes.length > 0) selectNode(newNodes[0].id)
    },
    [markDirty, patchFlow, selectNode, t],
  )

  const addAnswerAt = useCallback(
    (position?: { x: number; y: number }) => {
      const existing = nodes.find((n) => n.id === ANSWER_NODE_ID || n.type === 'answerNode')
      if (existing) {
        selectNode(ANSWER_NODE_ID)
        return ANSWER_NODE_ID
      }
      const steps = flowToSteps(nodes, edges)
      const last = steps.length ? nodes.find((n) => n.id === steps[steps.length - 1].ref) : null
      const pos =
        position ||
        (last
          ? { x: last.position.x + 348, y: last.position.y }
          : { x: 720, y: 140 })
      markDirty()
      patchFlow({
        nodes: [...nodes, createAnswerNode(pos) as Node<StepNodeData>],
        edges,
      })
      selectNode(ANSWER_NODE_ID)
      return ANSWER_NODE_ID
    },
    [nodes, edges, markDirty, patchFlow, selectNode],
  )

  const addAnswer = useCallback(() => {
    addAnswerAt(undefined)
  }, [addAnswerAt])

  const deleteSelected = useCallback(() => {
    const selectedIds = new Set(
      nodes.filter((n) => n.selected && n.id !== START_NODE_ID).map((n) => n.id),
    )
    if (!selectedIds.size) return
    if (selectedId && selectedIds.has(selectedId)) selectNode(null)
    markDirty()
    patchFlow({
      nodes: nodes.filter((n) => !selectedIds.has(n.id)),
      edges: edges.filter(
        (e) => !e.selected && !selectedIds.has(e.source) && !selectedIds.has(e.target),
      ),
    })
  }, [nodes, edges, markDirty, patchFlow, selectNode, selectedId])

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!nodeId || nodeId === START_NODE_ID) return
      if (selectedId === nodeId) selectNode(null)
      markDirty()
      patchFlow({
        nodes: nodes.filter((n) => n.id !== nodeId),
        edges: edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      })
    },
    [nodes, edges, markDirty, patchFlow, selectNode, selectedId],
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      if (!edgeId) return
      const target = edges.find((e) => e.id === edgeId)
      if (!target || target.source === START_NODE_ID) return
      markDirty()
      patchFlow({ edges: edges.filter((e) => e.id !== edgeId) })
    },
    [edges, markDirty, patchFlow],
  )

  const onMoveEnd: OnMove = useCallback((_event, vp) => {
    // 视口只写入内存，随下次显式保存落入 canvas；平移/缩放不弹「未保存」
    setViewportState(vp)
  }, [])

  const onDropAgent = useCallback(
    (pos: { x: number; y: number }, agentCode?: string) => {
      const refId = addStepAt(pos, false)
      if (refId && agentCode?.trim()) {
        updateStep(refId, { assigned_agent: agentCode.trim() })
      }
      return refId
    },
    [addStepAt, updateStep],
  )

  const onDropAnswer = useCallback(
    (pos: { x: number; y: number }) => {
      addAnswerAt(pos)
    },
    [addAnswerAt],
  )

  const validatePublish = useCallback((): string[] => {
    const problems: string[] = []
    const stepNodes = nodes.filter((n) => n.type === 'stepNode')

    // 1. 至少有一个步骤
    if (stepNodes.length === 0) {
      problems.push(t('workflow.pubNoSteps'))
    }

    // 2. 工作流目标不能为空
    if (!goal.trim()) {
      problems.push(t('workflow.pubNoGoal'))
    }

    // 3. 每个步骤都要有执行 Agent
    const noAgentSteps = stepNodes.filter((n) => !n.data?.assigned_agent?.trim())
    if (noAgentSteps.length > 0) {
      const names = noAgentSteps
        .map((n) => n.data?.name || n.data?.goal || t('workflow.stepRef', { ref: n.id }))
        .slice(0, 3)
        .join('、')
      const more = noAgentSteps.length > 3 ? t('workflow.pubMoreSuffix', { n: noAgentSteps.length }) : ''
      problems.push(
        t('workflow.pubNoAgent', { n: noAgentSteps.length, names, more }),
      )
    }

    // 4. 最终答案要有连线（只有 1 个步骤时可选提示，不强制）
    const hasAnswerEdge = edges.some((e) => e.target === ANSWER_NODE_ID)
    if (stepNodes.length > 0 && !hasAnswerEdge) {
      problems.push(t('workflow.pubNoAnswer'))
    }

    // 5. 检查孤立节点（没有任何入边也没有出边的步骤）
    const realEdges = edges.filter((e) => e.source !== START_NODE_ID && e.target !== ANSWER_NODE_ID)
    const orphanSteps = stepNodes.filter((n) => {
      const hasIn = realEdges.some((e) => e.target === n.id) || edges.some((e) => e.source === START_NODE_ID && e.target === n.id)
      const hasOut = realEdges.some((e) => e.source === n.id) || edges.some((e) => e.source === n.id && e.target === ANSWER_NODE_ID)
      return !hasIn && !hasOut
    })
    if (orphanSteps.length > 0) {
      const names = orphanSteps
        .map((n) => n.data?.name || n.data?.goal || t('workflow.stepRef', { ref: n.id }))
        .slice(0, 3)
        .join('、')
      const more = orphanSteps.length > 3 ? t('workflow.pubMoreSuffix', { n: orphanSteps.length }) : ''
      problems.push(t('workflow.pubOrphan', { n: orphanSteps.length, names, more }))
    }

    return problems
  }, [nodes, edges, goal, t])

  /** 直接添加带指定智能体的步骤（点击智能体列表项用） */
  const addStepWithAgent = useCallback(
    (agentCode: string) => {
      const refId = addStepAt(undefined, true)
      if (refId && agentCode.trim()) {
        updateStep(refId, { assigned_agent: agentCode.trim() })
      }
      return refId
    },
    [addStepAt, updateStep],
  )

  const runAction = useCallback(
    async (kind: 'save' | 'publish') => {
      if (kind === 'publish') {
        const problems = validatePublish()
        if (problems.length > 0) {
          const msg = `${t('workflow.publishIssuesIntro', { n: problems.length })}\n${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
          toast.warning(msg, { duration: 6000 })
          return
        }
      }
      setBusy(kind)
      try {
        const plan = exportPlan()
        if (kind === 'publish') {
          const ok = await onPublish(plan)
          if (ok === false) return
        } else {
          await onSave(plan)
        }
        setDirty(false)
        if (kind === 'publish') {
          toast.success(t('workflow.publishSuccess'), { duration: 2000 })
        } else {
          toast.success(t('workflow.saved'), { duration: 1500 })
        }
      } catch (e) {
        // P0.5 Final Closure: Show the actual error message (including
        // validator errors from 422 responses) instead of a generic label.
        const errDetail = e instanceof Error ? e.message : String(e)
        if (kind === 'publish') {
          toast.error(errDetail || t('workflow.publishFailed'), { duration: 6000 })
        } else {
          toast.error(errDetail || t('workflow.saveFailed'), { duration: 3000 })
        }
        throw e
      } finally {
        setBusy(null)
      }
    },
    [exportPlan, onPublish, onSave, validatePublish, t],
  )

  useImperativeHandle(
    ref,
    () => ({
      getPlan: exportPlan,
      isDirty: () => dirty,
      saveDraft: () => runAction('save'),
      publishApp: () => runAction('publish'),
      addStep,
      deleteSelected,
      getGoal: () => goal,
      setGoal: (next: string) => {
        setGoal(next)
        markDirty()
      },
      setExecStatus,
      clearExecStatus,
    }),
    [
      addStep,
      clearExecStatus,
      deleteSelected,
      dirty,
      exportPlan,
      goal,
      markDirty,
      runAction,
      setExecStatus,
    ],
  )

  const studioValue = useMemo(
    () => ({
      selectedId,
      updateStep,
      deleteNode,
      deleteEdge,
      goal,
      setGoal: (next: string) => {
        setGoal(next)
        markDirty()
      },
      onOpenAppSettings,
      drawerOpen,
      setDrawerOpen,
      onOpenConfig: () => {
        /* 配置已迁至右侧面板：选中节点即显示 */
      },
      openAgentPicker,
      agents,
      appParameters,
      execByRef,
    }),
    [
      selectedId,
      updateStep,
      deleteNode,
      deleteEdge,
      goal,
      markDirty,
      onOpenAppSettings,
      drawerOpen,
      openAgentPicker,
      agents,
      appParameters,
      execByRef,
    ],
  )

  const agentPickerModal = (
    <AgentPickerModal
      open={!!agentPickerNodeId}
      onClose={() => setAgentPickerNodeId(null)}
      agents={agents}
      tools={toolCatalog}
      loading={agentsLoading}
      selected={agentPickerSelected}
      onConfirm={(code) => {
        if (agentPickerNodeId) updateStep(agentPickerNodeId, { assigned_agent: code })
        setAgentPickerNodeId(null)
      }}
    />
  )

  const flowCanvas = (
    <ReactFlowProvider>
      <FlowInner
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        markDirty={markDirty}
        setEdges={setEdges}
        seedViewport={seed.viewport}
        onViewportPersist={onViewportPersist}
        fitViewOnInit={!seed.viewport}
        isFullscreen={isFullscreen}
        addStep={addStep}
        deleteSelected={deleteSelected}
        busy={busy}
        runAction={runAction}
        onDropAgent={onDropAgent}
        onDropAnswer={onDropAnswer}
        dragOver={dragOver}
        setDragOver={setDragOver}
        arrangeActionRef={arrangeActionRef}
        stepCount={stepCount}
        onApplyTemplate={applyTemplate}
      />
    </ReactFlowProvider>
  )

  const sharedDrawerProps = {
    selectedId,
    selectedStep,
    workflowGoal: goal,
    onWorkflowGoalChange: (next: string) => {
      setGoal(next)
      markDirty()
    },
    onStepChange: updateSelectedStep,
    onAddStep: addStep,
    onAddStepWithAgent: addStepWithAgent,
    onAddAnswer: addAnswer,
    onDeleteSelected: deleteSelected,
    hasSelection: hasStepSelection || selectedId === ANSWER_NODE_ID || selectedId === START_NODE_ID,
    onOpenAppSettings,
    dndType: PALETTE_DND_TYPE,
    answerSourceRef: answerFromRefFromEdges(edges),
    appParameters: paramSlots,
    upstreamSteps: upstreamStepRefs,
  }

  if (isFullscreen) {
    const showConfig = !!selectedId
    return (
      <WorkflowStudioProvider value={studioValue}>
        <div className="app-rf-root app-rf-root--fullscreen">
          <div className={`app-wf-studio${showConfig ? ' has-config' : ''}`}>
            <WorkflowToolbar
              appIcon={appIcon}
              appName={appName}
              appStatus={appStatus}
              dirty={dirty}
              busy={busy}
              drawerOpen={drawerOpen}
              titleDraft={titleDraft}
              onTitleChange={setTitleDraft}
              onTitleBlur={() => onRename?.(titleDraft)}
              onBack={onBack}
              onRun={onRun}
              onSave={() => runAction('save')}
              onPublish={() => runAction('publish')}
              onToggleDrawer={toggleDrawer}
              onOpenSettings={onOpenAppSettings}
              onOpenHistory={onOpenHistory}
              onOpenVersions={onOpenVersions}
              onOpenApiAccess={onOpenApiAccess}
              onOpenDebug={() => setDebugPanelOpen((v) => !v)}
              debugActive={debugPanelOpen}
              onAutoArrange={() => arrangeActionRef.current?.()}
            />
            <div className="app-wf-studio-body">
              <WorkflowDrawer
                panelRole="library"
                open={drawerOpen}
                onToggle={toggleDrawer}
                {...sharedDrawerProps}
              />
              <div className="app-wf-studio-center">
                <WorkflowOnboardingBanner stepCount={stepCount} />
                {flowCanvas}
                <WorkflowStatusBar
                  stepCount={nodeCount}
                  edgeCount={edgeCount}
                  dirty={dirty}
                />
              </div>
              {showConfig ? (
                <WorkflowDrawer
                  panelRole="config"
                  open
                  onToggle={() => selectNode(null)}
                  {...sharedDrawerProps}
                />
              ) : null}
            </div>
          </div>
          {agentPickerModal}
          {debugPanelOpen && appId ? (
            <DebugPanel
              appId={appId}
              selectedStep={selectedStep}
              runId={runId}
              parameters={parameters}
              onClose={() => setDebugPanelOpen(false)}
            />
          ) : null}
        </div>
      </WorkflowStudioProvider>
    )
  }

  return (
    <div className="app-rf-root">
      <div className="app-rf-goal">
        <label className="app-rf-goal-label" htmlFor="app-rf-goal-input">
          {t('workflow.workflowGoalTitle')}
        </label>
        <textarea
          id="app-rf-goal-input"
          className="input app-rf-goal-input"
          rows={2}
          value={goal}
          placeholder={t('workflow.canvasGoalPlaceholder')}
          onChange={(e) => {
            setGoal(e.target.value)
            markDirty()
          }}
        />
      </div>
      {flowCanvas}
    </div>
  )
})
