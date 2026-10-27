/**
 * 任务详情页 - 任务观测数据（工作流见 /workflow/:id；主控对话回主对话查看）
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { renderMarkdown } from '../lib/markdown.js'
import {
  formatTaskStatusZh,
  formatUnifiedStatusZh,
  normalizeTaskStatusKey,
  toTaskStatusGroup,
  toUnifiedTaskStatus,
  computeTaskExecutionProgress,
  isTaskPausableStatus,
  isTaskRunningStatus,
  isTaskPlanningStatus,
  isTaskQueuedStatus,
  isTaskWaitingConfirmation,
  isTaskCancellableStatus,
  taskStatusTagClass,
} from '../lib/task-status-label.js'
import { formatCompactNum, formatDurationMs, formatSubtaskObsLine } from '../lib/task-observability-format.js'
import { showModal, showConfirm } from '../components/modal.js'
import { promptSaveTaskAsApp } from '../lib/save-task-as-app.js'
import { mountTaskPlanModalBridge, unmountTaskPlanModalBridge, openTaskPlanModal } from './task-detail-workbench.js'
import { taskDescriptionForDisplay } from '../lib/task-placeholder.js'
import { resolveAssignedAgentDisplayName } from '../lib/tool-display.js'
import { normalizeSubtaskResultForDisplay } from '../lib/subtask-result-display.js'
import { taskSummaryText, renderTaskOutputCardsHtml, renderTaskInputRefsCardsHtml, parseTaskResultSections, resolveTaskOutputItems, taskInputRefsOf } from '../lib/task-summary.js'
import {
  taskHandlersOf,
  normalizeTaskHandlers,
  handlerDisplayName,
  renderHandlersEditorHtml,
  renderHandlersReadonlyHtml,
  collectHandlersFromEditor,
  bindHandlersEditor,
} from '../lib/task-handlers.js'
import { bindTaskOutputCardActions } from '../lib/task-output-preview.js'
import { normalizeTaskSource, formatTaskSourceZh } from '../lib/task-source.js'
import { formatRaisedByLabel } from '../lib/task-raised-by.js'
import { getLang, t as i18nT } from '../lib/i18n.js'

/**
 * 页面文案本地化：zh 直返原文（不经过词典，保证 zh 侧与改造前逐字一致）；
 * en 查词典，缺键（t() 原样返回 key）时回退中文。params 支持 {name} 插值。
 */
function _l(zh, key, params) {
  if (getLang() !== 'en') return _interp(zh, params)
  const v = i18nT(key, params)
  return v && v !== key ? v : _interp(zh, params)
}

function _interp(s, params) {
  if (!params) return s
  let out = s
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return out
}

/** key（小写/数字）→ camelCase，用于拼词典 key 后缀 */
function _camelKey(k) {
  const s = String(k || '')
  return s.replace(/[-_]([a-z0-9])/gi, (_, c) => c.toUpperCase())
}

/** 首字母大写（词典 key 为扁平 camelCase，如 dtlRiskLow；t() 按点分层无法解析 key 内的点） */
function _upperFirst(s) {
  const str = String(s || '')
  return str ? str[0].toUpperCase() + str.slice(1) : str
}

/** 常量映射本地化：map 值为 zh 原文，en 按 前缀+key 查词典；未命中返回 '' */
function _mapLabel(map, key, prefix) {
  const zh = map[key]
  if (zh == null) return ''
  return _l(zh, `tasks.${prefix}${_upperFirst(_camelKey(key))}`)
}

const DETAIL_RISK_LABEL = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极高风险',
}

const DETAIL_ACTION_TYPE_LABEL = {
  code_change: '代码变更',
  analysis: '分析',
  report: '报告',
  task_delegation: '任务委派',
  alert: '告警',
  optimization: '优化',
}

const DETAIL_SOURCE_CHANNEL_ZH = {
  proactive_patrol: '岗位值班',
  proactive_dispatch: '跨岗/派发',
  employee_page: '员工页派发',
  chat_mention: '主聊天 @',
  xiaomi: '小V催办',
  role: '岗位协作',
  manual: '手动',
}

function debugTaskDetailEnabled() {
  try {
    return localStorage.getItem('gogo_DEBUG_TASK_DETAIL') === '1'
  } catch {
    return false
  }
}

/** 员工任务会话 key：``proactive:{code}:task:{taskId}`` */
function proactiveTaskSessionKey(agentCode, taskId) {
  const code = String(agentCode || '').trim()
  const tid = String(taskId || '')
    .trim()
    .replace(/[:/\\]/g, '-')
  if (!code || !tid) return ''
  return `proactive:${code}:task:${tid}`
}

/** 跳转主聊天并打开指定员工任务会话 */
function openProactiveTaskChat(agentCode, taskId) {
  const sk = proactiveTaskSessionKey(agentCode, taskId)
  if (!sk) {
    toast(_l('无法打开续聊：缺少执行岗位或任务 ID', 'tasks.dtlResumeNoAgent'), 'error')
    return
  }
  try {
    sessionStorage.setItem('evopanel_pending_shell_session', sk)
    sessionStorage.setItem('evopanel_pending_shell_task_id', String(taskId || '').trim())
    sessionStorage.removeItem('evopanel_pending_shell_processed')
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent('evopanel:shell-select-session', { detail: { sessionKey: sk } }),
    )
  } catch {
    /* ignore */
  }
  window.location.hash = '#/chat'
}

function logTaskDetail(tag, payload) {
  if (!debugTaskDetailEnabled()) return
  try {
    console.info(`[task-detail][${tag}]`, payload)
  } catch {}
}

/** router 切换路由时调用，停止轮询与事件订阅 */
let _pageCleanup = null
/** 应用编辑器内嵌时的清理（与路由页互斥） */
let _embedCleanup = null

export function cleanup() {
  if (_pageCleanup) {
    try {
      _pageCleanup()
    } catch {}
    _pageCleanup = null
  }
}

function destroyTaskDetailEmbed() {
  if (_embedCleanup) {
    try {
      _embedCleanup()
    } catch {}
    _embedCleanup = null
  }
}

/**
 * 创建任务详情视图（整页与应用内嵌共用同一套 UI / 观测；主控对话仅内嵌调试可选展开）。
 * @param {string} taskId
 * @param {{ mode?: 'page'|'embed', onClose?: () => void }} [opts]
 * @returns {{ page: HTMLElement, destroy: () => void }}
 */
export function createTaskDetailView(taskId, opts = {}) {
  const mode = opts.mode === 'embed' ? 'embed' : 'page'
  const isEmbed = mode === 'embed'

  const page = document.createElement('div')
  page.className = `page task-detail-page${isEmbed ? ' task-detail-page--embed' : ''}`

  // 整页不展示主控对话（内容在主对话里）；应用内嵌调试保留折叠面板
  const conversationHtml = isEmbed ? `
    <div class="task-detail-content task-detail-content--single is-conversation-collapsed" id="task-conversation-section" data-td-panel="logs">
      <div class="task-output-panel task-output-panel--primary">
        <div class="output-header">
          <button type="button" class="task-conv-toggle" id="btn-toggle-conversation" aria-expanded="false">
            <span class="output-title">💬 ${_l('主控对话', 'tasks.dtlConvTitle')}</span>
            <span class="task-conv-toggle-hint" data-role="conv-toggle-hint">${_l('展开', 'tasks.dtlConvExpand')}</span>
          </button>
          <button class="btn btn-xs btn-ghost" id="btn-refresh-output" title="${_l('刷新对话', 'tasks.dtlConvRefresh')}" hidden>🔄</button>
        </div>
        <div class="output-content" id="conversation-content" hidden>
          <div class="output-empty">${_l('暂无对话记录', 'tasks.dtlConvEmpty')}<br><span style="font-size:11px;color:var(--text-tertiary)">${_l('主控 Agent 执行后将显示对话', 'tasks.dtlConvEmptyHint')}</span></div>
        </div>
      </div>
    </div>` : ''

  page.innerHTML = `
    <div class="td-shell">
      <header class="td-topbar">
        <div class="td-topbar-main">
          <button class="btn btn-ghost task-detail-back" id="btn-back" type="button" title="${isEmbed ? _l('返回画布', 'tasks.dtlBackCanvas') : _l('返回任务列表', 'tasks.dtlBackList')}" aria-label="${isEmbed ? _l('返回画布', 'tasks.dtlBackCanvas') : _l('返回任务列表', 'tasks.dtlBackList')}">
            <span>←</span>
          </button>
          <div class="td-title-block">
            <h1 class="td-title" id="task-title">${_l('加载中...', 'tasks.dtlLoading')}</h1>
            <p class="td-meta-line" id="task-meta-line" hidden></p>
            <p class="td-status-line" id="task-status-line"></p>
          </div>
        </div>
        <div class="td-topbar-actions">
          <button class="btn btn-warning btn-sm" id="btn-pause" type="button" style="display:none">${_l('暂停', 'tasks.actStop')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-cancel-task" type="button" style="display:none">${_l('取消', 'tasks.actCancel')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-refresh" type="button">${_l('刷新', 'tasks.pageRefresh')}</button>
          <div class="td-more" id="td-more">
            <button type="button" class="btn btn-secondary btn-sm td-more-btn" id="btn-td-more" aria-haspopup="menu" aria-expanded="false">${_l('⋯ 更多', 'tasks.dtlMore')}</button>
            <div class="td-more-panel" id="td-more-panel" role="menu" hidden>
              <button type="button" class="td-more-item" role="menuitem" data-more="resume-chat" id="btn-resume-employee-chat" hidden>${_l('续聊该任务', 'tasks.dtlResumeChat')}</button>
              <button type="button" class="td-more-item" role="menuitem" data-more="work-item" id="btn-open-work-item" hidden>${_l('打开员工工作项', 'tasks.dtlOpenWorkItem')}</button>
              <button type="button" class="td-more-item td-more-item--danger" role="menuitem" data-more="delete" id="btn-delete-task">${_l('删除任务', 'tasks.dtlDeleteTask')}</button>
            </div>
          </div>
        </div>
      </header>

      <div class="td-status-banner" id="task-status-banner" hidden role="status"></div>

      <div class="td-progress" id="task-progress-wrap" hidden>
        <div class="td-progress-head">
          <span class="td-progress-label" id="task-progress-label">${_l('进行中', 'tasks.runTaskInProgress')}</span>
          <span class="td-progress-value" id="task-progress-value">0%</span>
        </div>
        <div class="td-progress-bar"><div class="td-progress-fill" id="task-progress-fill" style="width:0%"></div></div>
        <div class="td-progress-sub" id="task-progress-sub" hidden></div>
      </div>

      <nav class="td-section-tabs" id="td-section-tabs" aria-label="${_l('详情分区', 'tasks.dtlTabsAria')}">
        <button type="button" class="td-section-tab is-active" data-td-tab="overview">${_l('概览', 'tasks.dtlTabOverview')}</button>
        <button type="button" class="td-section-tab" data-td-tab="logs">${_l('执行过程', 'tasks.dtlTabLogs')}</button>
      </nav>

      <div class="td-layout">
        <main class="td-main">
          <section class="task-decision-panel" id="task-decision-panel" hidden aria-label="${_l('待你处理', 'tasks.dtlDecisionAria')}" data-td-panel="overview"></section>
          <section class="td-card" id="task-brief-panel" hidden aria-label="${_l('简要说明', 'tasks.dtlBriefTitle')}" data-td-panel="overview"></section>
          <section class="td-exec-timeline" id="task-exec-timeline" hidden aria-label="${_l('执行步骤', 'tasks.dtlStepsTitle')}" data-td-panel="overview logs"></section>
          <section class="td-result" id="task-outcome-panel" hidden aria-label="${_l('任务结果', 'tasks.dtlResultAria')}" data-td-panel="overview"></section>
          <section class="task-obs-panel" id="task-obs-panel" hidden aria-label="${_l('执行过程', 'tasks.dtlTabLogs')}" data-td-panel="logs">
            <header class="task-obs-panel-header">
              <h2 class="task-obs-panel-title" id="task-obs-panel-title">${_l('执行过程', 'tasks.dtlTabLogs')}</h2>
              <span class="task-obs-panel-count" id="task-obs-panel-count"></span>
            </header>
            <div class="task-obs-panel-body" id="task-obs-strip"></div>
          </section>
          ${conversationHtml}
        </main>
        <aside class="td-aside" data-td-panel="overview">
          <section class="td-aside-card" id="task-info"></section>
          <section class="td-aside-card td-aside-card--meta" id="task-meta" hidden></section>
          <div class="task-detail-app-provenance" id="task-app-provenance" hidden></div>
        </aside>
      </div>
    </div>
    <div id="task-plan-modal-host" hidden aria-hidden="true"></div>
  `

  const state = {
    taskId,
    projectId: null,
    task: null,
    subtasks: [],
    facts: [],
    agents: [],
    conversationMessages: [],
    eventSubscription: null,
    outputRefreshInterval: null,
    executionHistory: [],
    currentThreadId: null,
    currentSessionKey: null,
    /** 仅应用内嵌调试可展开主控对话；整页不展示 */
    embedMode: isEmbed,
    conversationExpanded: false,
    detailTab: 'overview',
    /** @type {ReturnType<typeof import('../components/proactive-live-process.js').mountProactiveLiveProcess> | null} */
    workProcessLive: null,
  }

  page.querySelector('#btn-back').addEventListener('click', () => {
    if (isEmbed && typeof opts.onClose === 'function') {
      opts.onClose()
      return
    }
    window.location.hash = '#/tasks'
  })

  page.querySelector('#btn-pause').addEventListener('click', () => {
    handlePauseButton(page, state)
  })

  page.querySelector('#btn-cancel-task')?.addEventListener('click', () => {
    void handleCancelTaskFromDetail(page, state)
  })

  page.querySelector('#td-section-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-td-tab]')
    if (!btn) return
    const next = btn.dataset.tdTab || 'overview'
    // 员工任务：点「执行过程」直接弹窗，不再切到整页日志区
    if (next === 'logs' && canOpenTaskWorkProcessPopup(state.task)) {
      void openTaskWorkProcessPopup(page, state)
      return
    }
    state.detailTab = next
    applyDetailTab(page, state)
  })

  page.querySelector('#task-obs-strip')?.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="open-work-process"]')) return
    void openTaskWorkProcessPopup(page, state)
  })

  page.querySelector('#btn-refresh').addEventListener('click', async () => {
    await loadTaskDetail(page, state)
    toast(_l('已刷新', 'tasks.pageRefreshed'), 'success')
  })

  const moreBtn = page.querySelector('#btn-td-more')
  const morePanel = page.querySelector('#td-more-panel')
  const closeMore = () => {
    if (morePanel) morePanel.hidden = true
    moreBtn?.setAttribute('aria-expanded', 'false')
  }
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = morePanel?.hasAttribute('hidden')
    if (open) {
      morePanel.removeAttribute('hidden')
      moreBtn.setAttribute('aria-expanded', 'true')
    } else {
      closeMore()
    }
  })
  document.addEventListener('click', (e) => {
    if (!page.contains(e.target)) return
    if (!e.target.closest?.('#td-more')) closeMore()
  })

  page.querySelector('#td-more-panel')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-more]')
    if (!btn || btn.hidden) return
    const act = btn.dataset.more
    closeMore()
    if (act === 'work-item') {
      const href = btn.dataset.href
      if (href) window.location.hash = href
    } else if (act === 'resume-chat') {
      openProactiveTaskChat(btn.dataset.agentCode, btn.dataset.taskId)
    } else if (act === 'delete') void handleDeleteTaskFromDetail(page, state)
  })

  page.addEventListener('click', (e) => {
    const resumeBtn = e.target.closest?.('[data-act="resume-employee-chat"]')
    if (!resumeBtn) return
    e.preventDefault()
    openProactiveTaskChat(resumeBtn.dataset.agentCode, resumeBtn.dataset.taskId)
  })

  page.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-act="copy-path"]')
    if (!copyBtn) return
    // Handled by bindTaskOutputCardActions when present on card actions
    if (copyBtn.closest?.('.td-output-cards')) return
    e.preventDefault()
    const path = copyBtn.getAttribute('data-path') || ''
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      toast(_l('路径已复制', 'tasks.dtlPathCopied'), 'success')
    } catch {
      toast(_l('复制失败', 'tasks.dtlCopyFailed'), 'error')
    }
  })

  bindTaskOutputCardActions(page, {
    workspaceRoot: () => {
      const t = state.task
      return String(
        page.dataset.workspaceRoot ||
          t?.workspace_path ||
          t?.project_path ||
          t?.local_workspace_root ||
          t?.extra?.workspace_path ||
          '',
      ).trim()
    },
    agentCode: () =>
      String(page.dataset.agentCode || state.task?.assigned_to || '').trim(),
  })

  // Resolve employee workspace for role-sourced tasks (authoritative for preview).
  void (async () => {
    try {
      const code = String(state.task?.assigned_to || '').trim()
      if (code) page.dataset.agentCode = code
      if (!code) return
      const role = await api.proactiveGetRole(code).catch(() => null)
      const ws = String(role?.config?.workspace_path || role?.workspace_path || '').trim()
      if (ws) page.dataset.workspaceRoot = ws
    } catch {
      /* ignore */
    }
  })()

  const planModalHost = page.querySelector('#task-plan-modal-host')
  if (planModalHost) {
    mountTaskPlanModalBridge(planModalHost, { taskId })
  }

  const btnRefreshOutput = page.querySelector('#btn-refresh-output')
  if (btnRefreshOutput) {
    btnRefreshOutput.addEventListener('click', async () => {
      await loadTaskConversation(page, state)
      toast(_l('对话已刷新', 'tasks.dtlConvRefreshed'), 'success')
    })
  }

  const btnToggleConversation = page.querySelector('#btn-toggle-conversation')
  if (btnToggleConversation && isEmbed) {
    btnToggleConversation.addEventListener('click', async () => {
      state.conversationExpanded = !state.conversationExpanded
      syncConversationPanelUi(page, state)
      if (state.conversationExpanded) {
        await loadTaskConversation(page, state)
      }
    })
  }

  void loadTaskDetail(page, state).catch((e) => {
    logTaskDetail('initialLoad:error', { taskId, error: String(e) })
  })

  let destroyed = false
  const releasePageResources = () => {
    if (destroyed) return
    destroyed = true
    if (state.outputRefreshInterval) {
      clearInterval(state.outputRefreshInterval)
      state.outputRefreshInterval = null
    }
    if (state.eventSubscription) {
      state.eventSubscription.close()
      state.eventSubscription = null
    }
    unmountTaskPlanModalBridge()
    if (state.workProcessLive) {
      try {
        state.workProcessLive.destroy()
      } catch {
        /* ignore */
      }
      state.workProcessLive = null
    }
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((node) => {
        if (node === page || (node.contains && node.contains(page))) {
          releasePageResources()
          observer.disconnect()
        }
      })
    })
  })

  setTimeout(() => {
    if (page.parentNode) {
      observer.observe(page.parentNode, { childList: true, subtree: true })
    }
  }, 0)

  window.addEventListener('beforeunload', releasePageResources, { once: true })

  return {
    page,
    destroy: () => {
      releasePageResources()
      observer.disconnect()
      page.remove()
    },
  }
}

/**
 * 嵌入任务详情到指定容器（应用调试坞等）。
 * @returns {{ destroy: () => void }}
 */
export function mountTaskDetailInto(container, { taskId, onClose } = {}) {
  destroyTaskDetailEmbed()
  const id = String(taskId || '').trim()
  if (!container || !id) {
    return { destroy: () => {} }
  }
  const view = createTaskDetailView(id, { mode: 'embed', onClose })
  container.innerHTML = ''
  container.appendChild(view.page)
  _embedCleanup = () => {
    view.destroy()
  }
  return {
    destroy: () => {
      if (_embedCleanup) {
        _embedCleanup()
        _embedCleanup = null
      }
    },
  }
}

export async function render() {
  cleanup()
  destroyTaskDetailEmbed()
  const taskId = extractTaskId()
  if (!taskId) {
    const page = document.createElement('div')
    page.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-tertiary)">${_l('无效的任务 ID，<a href="#/tasks">返回任务列表</a>', 'tasks.dtlInvalidId')}</div>`
    return page
  }

  const view = createTaskDetailView(taskId, { mode: 'page' })
  _pageCleanup = view.destroy
  return view.page
}

function shouldLoadConversation(state) {
  // 整页任务详情不展示主控对话（回主对话看）；仅应用内嵌调试展开时加载
  return !!state.embedMode && !!state.conversationExpanded
}

/** 任务结果：结论 / 产出卡片 / 发现 / 下一步 */
function renderTaskOutcomePanel(page, state) {
  const el = page.querySelector('#task-outcome-panel')
  if (!el) return
  const task = state.task
  if (!task) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  const group = toTaskStatusGroup(task.status)
  const showResult = ['reviewed', 'completed', 'failed', 'executing', 'paused', 'cancelled'].includes(group)
  if (!showResult) {
    el.hidden = true
    el.innerHTML = ''
    return
  }

  const result = taskSummaryText(task)
  const error = String(task.error || task.error_text || '').trim()
  const sections = parseTaskResultSections(group === 'failed' ? (error || result) : result)
  const outputs = resolveTaskOutputItems(task)
  const inputRefs = taskInputRefsOf(task)
  const agentCode = String(task.assigned_to || '').trim()
  const sourceKey = normalizeTaskSource(task.source)
  const workHref = sourceKey === 'role' && agentCode
    ? `#/proactive/${encodeURIComponent(agentCode)}/work/${encodeURIComponent(state.taskId)}`
    : ''
  const canResumeChat = sourceKey === 'role' && !!agentCode && !!state.taskId

  const cards = []
  const workflow = isWorkflowAppTask(task)
  const { subtaskCount, completedCount } = taskProgressMeta(task, state.subtasks)
  const failedNodes = (state.subtasks || [])
    .filter((s) => toTaskStatusGroup(s?.status) === 'failed')
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean)

  if (group === 'completed' || group === 'reviewed') {
    let headline = sections.conclusion
    if (!headline) {
      if (workflow) headline = _l('工作流运行完成', 'tasks.dtlHeadWorkflowDone')
      else if (group === 'reviewed') headline = _l('员工已交工，等待你确认。', 'tasks.dtlHeadReviewed')
      else headline = _l('任务已完成。', 'tasks.dtlHeadDone')
    }
    const bits = []
    if (workflow && subtaskCount > 0) bits.push(_l('{done} / {total} 个节点全部成功', 'tasks.dtlBitsNodesAllOk', { done: completedCount, total: subtaskCount }))
    if (outputs.length) bits.push(_l('共生成 {n} 个产出', 'tasks.dtlBitsOutputs', { n: outputs.length }))
    if (inputRefs.length) bits.push(_l('{n} 项上游参考', 'tasks.dtlBitsInputs', { n: inputRefs.length }))
    if (sections.findings.length) bits.push(_l('{n} 项发现', 'tasks.dtlBitsFindings', { n: sections.findings.length }))
    cards.push(`
      <section class="td-card td-card--result">
        <h2 class="td-card-title">${workflow ? _l('运行结果', 'tasks.dtlResultRun') : (group === 'reviewed' ? _l('交工结果', 'tasks.dtlResultReview') : _l('完成结果', 'tasks.dtlResultDone'))}</h2>
        <p class="td-card-lead">${escapeHtml(headline)}</p>
        ${bits.length ? `<p class="td-card-sub">${escapeHtml(bits.join(' · '))}</p>` : ''}
        <div class="td-card-actions">
          ${canResumeChat
            ? `<button type="button" class="btn btn-sm btn-primary" data-act="resume-employee-chat" data-agent-code="${escapeHtml(agentCode)}" data-task-id="${escapeHtml(state.taskId)}">${_l('续聊', 'tasks.dtlResumeShort')}</button>`
            : ''}
          ${workHref ? `<a class="btn btn-sm btn-secondary" href="${workHref}">${_l('查看工作项', 'tasks.dtlViewWorkItem')}</a>` : ''}
          ${outputs[0] && (/^https?:\/\//i.test(outputs[0].value))
            ? `<a class="btn btn-sm btn-primary" href="${escapeHtml(outputs[0].value)}" target="_blank" rel="noopener noreferrer">${_l('查看产出', 'tasks.dtlViewOutput')}</a>`
            : ''}
        </div>
      </section>`)
  } else if (group === 'failed') {
    const failLead = workflow && failedNodes.length
      ? _l('「{name}」节点执行失败', 'tasks.dtlFailNodeLead', { name: failedNodes[0] }) + (completedCount > 0 ? _l('，前 {n} 个节点已成功', 'tasks.dtlFailNodePrevOk', { n: completedCount }) : '')
      : (error || sections.conclusion || result || _l('执行失败', 'tasks.runExecFailed'))
    cards.push(`
      <section class="td-card td-card--fail">
        <h2 class="td-card-title">${workflow ? _l('工作流运行失败', 'tasks.dtlFailTitleWorkflow') : _l('失败原因', 'tasks.dtlFailTitle')}</h2>
        <p class="td-card-lead">${escapeHtml(failLead)}</p>
        ${workflow && error && error !== failLead ? `<p class="td-card-sub">${escapeHtml(error.slice(0, 280))}</p>` : ''}
      </section>`)
  } else if (group === 'cancelled') {
    const lead = sections.conclusion || result || _l('任务已取消，不再继续推进。', 'tasks.dtlCancelledLead')
    cards.push(`
      <section class="td-card">
        <h2 class="td-card-title">${_l('关闭说明', 'tasks.dtlCloseTitle')}</h2>
        <p class="td-card-lead">${escapeHtml(lead)}</p>
      </section>`)
  } else if (result || (workflow && subtaskCount > 0)) {
    const lead = workflow && subtaskCount > 0
      ? (sections.conclusion || result?.slice(0, 280) || nodeProgressLabel(completedCount, subtaskCount))
      : (sections.conclusion || result.slice(0, 280))
    cards.push(`
      <section class="td-card">
        <h2 class="td-card-title">${_l('当前进展', 'tasks.dtlProgressTitle')}</h2>
        <p class="td-card-lead">${escapeHtml(lead)}</p>
      </section>`)
  }

  if (inputRefs.length) {
    cards.push(`
      <section class="td-card td-card--input-refs">
        <h2 class="td-card-title">${_l('上游参考产物', 'tasks.dtlUpstreamTitle')}</h2>
        <p class="td-card-sub">${_l('来自上游交工指定，请先阅读；不是本岗交付物。', 'tasks.dtlUpstreamSub')}</p>
        ${renderTaskInputRefsCardsHtml(task, escapeHtml, { enablePreview: true })}
      </section>`)
  }

  if (outputs.length) {
    cards.push(`
      <section class="td-card">
        <h2 class="td-card-title">${_l('本岗交付物', 'tasks.dtlDeliverablesTitle')}</h2>
        ${renderTaskOutputCardsHtml(task, escapeHtml, { enablePreview: true })}
      </section>`)
  }

  if (sections.findings.length) {
    cards.push(`
      <section class="td-card">
        <h2 class="td-card-title">${_l('关键发现', 'tasks.dtlFindingsTitle')}</h2>
        <ul class="td-findings">${sections.findings.slice(0, 12).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      </section>`)
  }

  if (sections.nextSteps.length) {
    cards.push(`
      <section class="td-card">
        <h2 class="td-card-title">${_l('建议下一步', 'tasks.dtlNextTitle')}</h2>
        <ol class="td-next-steps">${sections.nextSteps.slice(0, 10).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      </section>`)
  }

  if (!sections.findings.length && !sections.nextSteps.length && !outputs.length && !inputRefs.length && result
      && (group === 'completed' || group === 'reviewed' || group === 'executing')
      && result.length > 400 && result !== sections.conclusion) {
    cards.push(`
      <details class="td-card td-card--fold">
        <summary>${_l('查看完整总结', 'tasks.dtlFullSummary')}</summary>
        <pre class="td-raw-summary">${escapeHtml(result)}</pre>
      </details>`)
  }

  if (!cards.length) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  el.hidden = false
  el.innerHTML = cards.join('')
}

/** 去掉「处理：」前缀，长标题取业务名一段 */
function cleanTaskHeroTitle(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^处理[：:]\s*/u, '')
  const parts = s.split(/\s*[·•|]\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1 && parts.slice(1).some((p) => /转交|审核|风险|工程师|岗位/.test(p))) {
    return parts[0] || s
  }
  return s
}

/** 展示层：把验收长文排成列表，抽出文档链接；不改原文语义 */
function formatHandoffAcceptanceHtml(raw) {
  const text = String(raw || '').trim()
  if (!text) return { bodyHtml: `<p class="td-handoff-empty">${_l('（未写验收内容）', 'tasks.dtlHandoffEmpty')}</p>`, docs: [] }

  const docs = []
  let working = text
  working = working.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    docs.push({ label: String(label).trim() || url, url })
    return '\n'
  })
  working = working.replace(/https?:\/\/[^\s)\]>'"]+/g, (url) => {
    docs.push({ label: url, url })
    return '\n'
  })

  const lines = working
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items = []
  const paras = []
  for (const line of lines) {
    const bullet = line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)、]\s*/, '')
    const isBullet = bullet !== line || /^[-*•]/.test(line) || /^\d+[.)、]/.test(line)
    let html = escapeHtml(isBullet ? bullet : line)
    html = html.replace(
      /(^|[\s，,：:])(\/[A-Za-z0-9_\-./{}:]+)(?=$|[\s，,。；;])/g,
      (_, pre, path) => `${pre}<code>${path}</code>`,
    )
    html = html.replace(
      /\b((?:npm|pnpm|yarn|npx|uvicorn|python|node|curl|git)\s+[^\n<]+)/g,
      '<code>$1</code>',
    )
    if (isBullet || items.length) {
      if (!isBullet && paras.length === 0 && items.length === 0) {
        paras.push(html)
      } else {
        items.push(html)
      }
    } else {
      paras.push(html)
    }
  }

  // 若几乎都是短句且无列表标记，按换行当列表扫读
  if (!items.length && paras.length >= 3 && paras.every((p) => p.length < 80)) {
    const bodyHtml = `<ul class="td-handoff-list">${paras.map((p) => `<li>${p}</li>`).join('')}</ul>`
    return { bodyHtml, docs }
  }

  const parts = []
  if (paras.length) {
    parts.push(paras.map((p) => `<p class="td-handoff-p">${p}</p>`).join(''))
  }
  if (items.length) {
    parts.push(`<ul class="td-handoff-list">${items.map((p) => `<li>${p}</li>`).join('')}</ul>`)
  }
  return {
    bodyHtml: parts.join('') || `<p class="td-handoff-p">${escapeHtml(text)}</p>`,
    docs,
  }
}

function renderHandoffReviewBodyHtml(task, state, { reviewLocked = false } = {}) {
  const handlers = normalizeTaskHandlers(taskHandlersOf(task))
  const roster = Object.values(state.rolesByCode || {})
  const fromRole = resolveDetailRoleLabel(task, state) || _l('当前岗位', 'tasks.dtlCurrentRole')
  if (!handlers.length) {
    return `
      <div class="task-decision-copy">
        <strong>${_l('转交审核', 'tasks.dtlHandoffTitle')}</strong>
        <p class="task-decision-missing-handlers">${_l('未指定下一岗处理人', 'tasks.dtlHandoffNoHandlers')}</p>
      </div>`
  }

  const toNames = handlers.map((h) => handlerDisplayName(h, roster))
  const nameSep = getLang() === 'en' ? ', ' : '、'
  const route = `${fromRole} → ${toNames.join(nameSep)}`
  const blocks = handlers.map((h) => {
    const code = String(h.agent_code || '').trim()
    const name = handlerDisplayName(h, roster)
    const { bodyHtml, docs } = formatHandoffAcceptanceHtml(h.content || '')
    const outs = (h.read_outputs || h.outputs || [])
      .map((o) => {
        const v = String(o?.value || o || '').trim()
        if (!v) return ''
        const label = String(o?.label || '').trim()
        if (/^https?:\/\//i.test(v)) {
          docs.push({ label: label || v, url: v })
          return ''
        }
        return `<li><code>${escapeHtml(v)}</code>${label ? ` · ${escapeHtml(label)}` : ''}</li>`
      })
      .filter(Boolean)
      .join('')
    const uniqDocs = []
    const seen = new Set()
    for (const d of docs) {
      const key = `${d.url}|${d.label}`
      if (seen.has(key)) continue
      seen.add(key)
      uniqDocs.push(d)
    }
    return `
      <div class="td-handoff-assignee-block">
        <div class="td-handoff-k">${_l('转交给', 'tasks.dtlHandoffTo')}</div>
        <div class="td-handoff-who">
          <span class="td-handoff-name">${escapeHtml(name)}</span>
          ${code && code !== name ? `<span class="td-handoff-code">${escapeHtml(code)}</span>` : ''}
        </div>
        <div class="td-handoff-k">${_l('验收内容', 'tasks.dtlHandoffAccept')}</div>
        <div class="td-handoff-acceptance">${bodyHtml}</div>
        ${outs ? `<div class="td-handoff-k">${_l('参考产物', 'tasks.dtlHandoffRefs')}</div><ul class="td-handoff-refs">${outs}</ul>` : ''}
        ${
          uniqDocs.length
            ? `<div class="td-handoff-k">${_l('相关文档', 'tasks.dtlHandoffDocs')}</div>
               <ul class="td-handoff-docs">${uniqDocs
                 .map(
                   (d) =>
                     `<li><a class="td-handoff-doc-link" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.label)} <span aria-hidden="true">↗</span></a></li>`,
                 )
                 .join('')}</ul>`
            : ''
        }
      </div>`
  }).join('<hr class="td-handoff-divider" />')

  return `
    <div class="task-decision-copy">
      <strong>${_l('转交审核', 'tasks.dtlHandoffTitle')}</strong>
      <p class="td-handoff-route">${escapeHtml(route)}</p>
      ${reviewLocked ? `<p class="td-handoff-locked-hint">${_l('任务已结束，无法继续审核。', 'tasks.dtlReviewLocked')}</p>` : `<p>${_l('上一步已完成。同意后下一岗开始；驳回则不派下游。', 'tasks.dtlReviewHint')}</p>`}
    </div>
    ${blocks}`
}

function renderTaskHero(page, state) {
  const task = state.task
  const titleEl = page.querySelector('#task-title')
  const metaEl = page.querySelector('#task-meta-line')
  const bannerEl = page.querySelector('#task-status-banner')
  if (!task) {
    if (titleEl) titleEl.textContent = _l('加载中...', 'tasks.dtlLoading')
    if (metaEl) {
      metaEl.hidden = true
      metaEl.textContent = ''
    }
    if (bannerEl) {
      bannerEl.hidden = true
      bannerEl.innerHTML = ''
    }
    return
  }

  const fullName = taskDetailDisplayName(task)
  const shortName = cleanTaskHeroTitle(fullName)
  if (titleEl) {
    titleEl.textContent = shortName
    titleEl.title = fullName !== shortName ? fullName : ''
  }

  const group = toTaskStatusGroup(task.status)
  const statusKey = normalizeTaskStatusKey(task.status)
  const roster = Object.values(state.rolesByCode || {})
  const fromRole = resolveDetailRoleLabel(task, state)
  const handlers = normalizeTaskHandlers(taskHandlersOf(task))
  const toNames = handlers.map((h) => handlerDisplayName(h, roster)).filter(Boolean)
  const riskKey = String(task.risk_level || '').trim().toLowerCase()
  const riskZh = _mapLabel(DETAIL_RISK_LABEL, riskKey, 'dtlRisk')
  const nameSep = getLang() === 'en' ? ', ' : '、'
  const metaParts = []
  const handoffPending = Boolean(task.handlers_pending_approval) && statusKey !== 'reviewed'
  if (handoffPending) metaParts.push(_l('转交审核', 'tasks.dtlHandoffTitle'))
  if (fromRole && toNames.length) metaParts.push(`${fromRole} → ${toNames.join(nameSep)}`)
  else if (fromRole) metaParts.push(fromRole)
  if (riskZh) metaParts.push(riskZh)
  if (metaEl) {
    if (metaParts.length) {
      metaEl.hidden = false
      metaEl.textContent = metaParts.join(' · ')
    } else {
      metaEl.hidden = true
      metaEl.textContent = ''
    }
  }

  if (bannerEl) {
    if (group === 'cancelled') {
      const when = formatDetailClock(
        task.cancelled_at || task.cancelledAt || task.completed_at || task.completedAt || task.updated_at || task.updatedAt,
      )
      const reason = String(task.cancel_reason || task.cancelReason || task.status_comment || _l('用户取消', 'tasks.dtlUserCancelled')).trim()
      bannerEl.hidden = false
      bannerEl.className = 'td-status-banner td-status-banner--cancelled'
      bannerEl.innerHTML = `<span class="td-status-banner__label">${_l('任务已取消', 'tasks.dtlBannerCancelled')}</span><span class="td-status-banner__sep">·</span><span>${escapeHtml(reason)}</span>${when ? `<span class="td-status-banner__sep">·</span><time>${escapeHtml(when)}</time>` : ''}`
    } else if (group === 'failed') {
      const when = formatDetailClock(task.completed_at || task.updated_at || task.updatedAt)
      const err = String(task.error || _l('执行失败', 'tasks.runExecFailed')).trim().slice(0, 120)
      bannerEl.hidden = false
      bannerEl.className = 'td-status-banner td-status-banner--failed'
      bannerEl.innerHTML = `<span class="td-status-banner__label">${_l('执行失败', 'tasks.runExecFailed')}</span><span class="td-status-banner__sep">·</span><span>${escapeHtml(err)}</span>${when ? `<span class="td-status-banner__sep">·</span><time>${escapeHtml(when)}</time>` : ''}`
    } else {
      bannerEl.hidden = true
      bannerEl.innerHTML = ''
      bannerEl.className = 'td-status-banner'
    }
  }
}

/** 待确认验收 / 开工前审批 — 决策区（完成态删除收进更多菜单） */
function renderTaskDecisionPanel(page, state) {
  const el = page.querySelector('#task-decision-panel')
  if (!el) return
  const task = state.task
  if (!task) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  const group = toTaskStatusGroup(task.status)
  const statusKey = normalizeTaskStatusKey(task.status)
  const waitingConfirm = new Set(['req_confirm', 'waiting_user', 'awaiting_close', 'waiting_confirmation', 'reviewed'])
  const reviewLocked = group === 'cancelled' || group === 'failed'

  // 转交审核：handlers 待批（批准后下一岗开始）
  if (task.handlers_pending_approval && statusKey !== 'reviewed') {
    el.hidden = false
    el.className = `task-decision-panel${reviewLocked ? ' task-decision-panel--locked' : ''}`
    const actionsHtml = reviewLocked
      ? ''
      : `<div class="task-decision-actions">
          <button type="button" class="btn btn-primary" data-gate-act="approve">${_l('同意派发', 'tasks.dtlGateApprove')}</button>
          <button type="button" class="btn btn-danger-outline" data-gate-act="reject">${_l('驳回', 'tasks.dtlGateReject')}</button>
        </div>
        <div class="task-decision-note" data-gate-reject hidden>
          <label class="task-decision-note-label">${_l('驳回原因（必填）', 'tasks.dtlGateRejectLabel')}</label>
          <textarea class="form-input task-decision-note-input" rows="2" placeholder="${_l('简单说明原因，员工下一轮会看到', 'tasks.dtlGateRejectPh')}"></textarea>
          <div class="task-decision-note-actions">
            <button type="button" class="btn btn-sm btn-danger" data-gate-act="reject-confirm">${_l('确认驳回', 'tasks.dtlGateRejectConfirm')}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-gate-act="reject-cancel">${_l('取消', 'tasks.actCancel')}</button>
          </div>
        </div>`
    el.innerHTML = `
      ${renderHandoffReviewBodyHtml(task, state, { reviewLocked })}
      ${actionsHtml}`
    if (!reviewLocked) bindTaskGateActions(page, state)
    return
  }

  // 待确认：执行已结束，确认完成 / 要求修改（不再暂停）
  if (waitingConfirm.has(statusKey)) {
    const handlers = taskHandlersOf(task)
    const roster = Object.values(state.rolesByCode || {})
    el.hidden = false
    el.className = 'task-decision-panel'
    el.innerHTML = `
      <div class="task-decision-copy">
        <strong>${_l('执行已完成，等待确认', 'tasks.dtlReviewTitle')}</strong>
        <p>${_l('员工侧运行已结束。确认完成后任务结案；要求修改将打回继续执行。', 'tasks.dtlReviewBody')}</p>
      </div>
      ${handlers.length ? renderHandlersReadonlyHtml(handlers, escapeHtml, { open: true, roles: roster }) : ''}
      <div class="task-decision-actions">
        <button type="button" class="btn btn-primary" data-review-act="complete">${_l('确认完成', 'tasks.dtlReviewComplete')}</button>
        <button type="button" class="btn btn-secondary" data-review-act="rework">${_l('要求修改', 'tasks.dtlReviewRework')}</button>
      </div>
      <div class="task-decision-note" data-review-note hidden>
        <label class="task-decision-note-label">${_l('修改说明（必填）', 'tasks.dtlReworkLabel')}</label>
        <textarea class="form-input task-decision-note-input" rows="2" placeholder="${_l('说明需要改什么，员工下一轮会看到', 'tasks.dtlReworkPh')}"></textarea>
        <div class="task-decision-note-actions">
          <button type="button" class="btn btn-sm btn-primary" data-review-act="confirm-note">${_l('确认打回', 'tasks.dtlReworkConfirm')}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-review-act="cancel-note">${_l('取消', 'tasks.actCancel')}</button>
        </div>
      </div>`
    bindTaskReviewActions(page, state)
    return
  }

  if (group === 'failed') {
    const isChat = normalizeTaskSource(task.source) === 'chat'
    el.hidden = false
    el.className = 'task-decision-panel task-decision-panel--fail'
    el.innerHTML = `
      <div class="task-decision-copy">
        <strong>${_l('执行失败', 'tasks.runExecFailed')}</strong>
        <p>${_l('可查看失败原因后重试；删除请用右上角「更多」。', 'tasks.dtlFailBody')}</p>
      </div>
      <div class="task-decision-actions">
        <button type="button" class="btn btn-primary" data-review-act="restart">${_l('再跑一次', 'tasks.dtlRerun')}</button>
        ${isChat ? `<button type="button" class="btn btn-secondary" id="btn-view-workflow-fail">${_l('查看工作流', 'tasks.dtlViewWorkflow')}</button>` : ''}
      </div>`
    el.querySelector('[data-review-act="restart"]')?.addEventListener('click', () => {
      void handleRestartTask(page, state)
    })
    el.querySelector('#btn-view-workflow-fail')?.addEventListener('click', () => {
      window.location.hash = `#/workflow/${state.taskId}`
    })
    return
  }

  const handlers = taskHandlersOf(task)
  if (handlers.length && (group === 'completed' || group === 'failed' || group === 'cancelled')) {
    el.hidden = false
    el.className = 'task-decision-panel task-decision-panel--handlers-ro'
    el.innerHTML = renderHandlersReadonlyHtml(handlers, escapeHtml, {
      roles: Object.values(state.rolesByCode || {}),
    })
    return
  }

  el.hidden = true
  el.innerHTML = ''
}

function bindTaskGateActions(page, state) {
  const el = page.querySelector('#task-decision-panel')
  if (!el || el._gateBound) return
  el._gateBound = true

  const rejectBox = () => el.querySelector('[data-gate-reject]')
  const noteInput = () => el.querySelector('.task-decision-note-input')

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-gate-act]')
    if (!btn) return
    const act = btn.dataset.gateAct
    const tid = String(state.taskId || '').trim()
    if (!tid) return

    if (act === 'approve') {
      btn.disabled = true
      try {
        await api.proactiveApprove(tid, 'approved', 'user', '')
        toast(_l('已同意派发', 'tasks.dtlApproved'), 'success')
        await loadTaskDetail(page, state)
      } catch (err) {
        toast(_l('审批失败：{err}', 'tasks.dtlApproveFailed', { err }), 'error')
        btn.disabled = false
      }
      return
    }
    if (act === 'reject') {
      const box = rejectBox()
      if (box) box.hidden = false
      noteInput()?.focus()
      return
    }
    if (act === 'reject-cancel') {
      const box = rejectBox()
      if (box) box.hidden = true
      const ta = noteInput()
      if (ta) ta.value = ''
      return
    }
    if (act === 'reject-confirm') {
      const reason = String(noteInput()?.value || '').trim()
      if (!reason) {
        toast(_l('请填写驳回原因', 'tasks.dtlRejectReasonRequired'), 'warning')
        noteInput()?.focus()
        return
      }
      btn.disabled = true
      try {
        await api.proactiveApprove(tid, 'rejected', 'user', reason, reason)
        toast(_l('已驳回', 'tasks.dtlRejected'), 'info')
        await loadTaskDetail(page, state)
      } catch (err) {
        toast(_l('操作失败：{err}', 'tasks.dtlOpFailed', { err }), 'error')
        btn.disabled = false
      }
    }
  })
}

function bindTaskReviewActions(page, state) {
  const el = page.querySelector('#task-decision-panel')
  if (!el || el._reviewBound) return
  el._reviewBound = true
  let pendingAct = null

  const noteBox = () => el.querySelector('[data-review-note]')
  const noteInput = () => el.querySelector('.task-decision-note-input')

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-review-act]')
    if (!btn) return
    const act = btn.dataset.reviewAct

    if (act === 'complete') {
      const handlersEditor = el.querySelector('[data-handlers-editor]')
      const handlers = handlersEditor ? collectHandlersFromEditor(handlersEditor) : []
      const yes = await showConfirm(
        handlers.length
          ? _l('确认验收通过？将派给 {n} 位处理人开始跟进。', 'tasks.dtlConfirmAcceptWithHandlers', { n: handlers.length })
          : _l('确认该任务已验收通过并标记为「已完成」？（未指定处理人，仅结案）', 'tasks.dtlConfirmAcceptClose'),
      )
      if (!yes) return
      await applyTaskState(page, state, 'completed', '', { handlers })
      return
    }
    if (act === 'delete') {
      await handleDeleteTaskFromDetail(page, state)
      return
    }
    if (act === 'rework' || act === 'fail' || act === 'cancel-task') {
      pendingAct = act
      const box = noteBox()
      if (box) box.hidden = false
      noteInput()?.focus()
      return
    }
    if (act === 'cancel-note') {
      pendingAct = null
      const box = noteBox()
      if (box) box.hidden = true
      const ta = noteInput()
      if (ta) ta.value = ''
      return
    }
    if (act === 'confirm-note') {
      const comment = String(noteInput()?.value || '').trim()
      if ((pendingAct === 'rework' || pendingAct === 'fail') && !comment) {
        toast(_l('请填写说明', 'tasks.dtlNoteRequired'), 'warning')
        noteInput()?.focus()
        return
      }
      const status =
        pendingAct === 'fail' ? 'failed'
          : pendingAct === 'cancel-task' ? 'cancelled'
            : 'executing'
      await applyTaskState(page, state, status, comment)
      pendingAct = null
    }
  })
}

async function applyTaskState(page, state, status, comment = '', extras = {}) {
  try {
    await api.setTaskState(state.taskId, status, comment, '', extras)
    const labels = {
      completed: _l('已确认完成', 'tasks.dtlStatusConfirmed'),
      executing: _l('已打回重做', 'tasks.dtlStatusRework'),
      failed: _l('已标记失败', 'tasks.dtlStatusFailedMarked'),
      cancelled: _l('已取消任务', 'tasks.dtlStatusCancelledTask'),
    }
    const n = Array.isArray(extras.handlers) ? extras.handlers.length : 0
    toast(
      status === 'completed' && n
        ? _l('已确认完成，已派给 {n} 位处理人', 'tasks.dtlConfirmedDispatched', { n })
        : labels[status] || _l('状态已更新', 'tasks.dtlStatusUpdated'),
      status === 'failed' || status === 'cancelled' ? 'warning' : 'success',
    )
    await loadTaskDetail(page, state)
  } catch (e) {
    toast(_l('操作失败：{err}', 'tasks.dtlOpFailed', { err: e }), 'error')
  }
}

async function handleDeleteTaskFromDetail(page, state) {
  const yes = await showConfirm(_l('确定删除此任务及其子任务？删除后不可恢复。', 'tasks.dtlDeleteConfirm'))
  if (!yes) return
  try {
    await api.deleteTask(state.taskId)
    toast(_l('任务已删除', 'tasks.dtlDeleted'), 'success')
    window.location.hash = '#/tasks'
  } catch (e) {
    toast(_l('删除失败：{err}', 'tasks.dtlDeleteFailed', { err: e }), 'error')
  }
}

function applyDetailTab(page, state) {
  let tab = state.detailTab || 'overview'
  // 旧 Tab 兼容：步骤→日志；产出/变更/配置并回概览
  if (tab === 'steps') tab = 'logs'
  if (tab === 'outputs' || tab === 'changelog' || tab === 'config') tab = 'overview'
  if (!['overview', 'logs'].includes(tab)) tab = 'overview'
  // 员工任务不切到日志页，一律弹窗看执行过程
  if (tab === 'logs' && canOpenTaskWorkProcessPopup(state.task)) {
    tab = 'overview'
    state.detailTab = 'overview'
    // 仅在用户主动点 Tab 时弹窗；避免轮询/刷新反复打开
  }
  state.detailTab = tab
  page.dataset.tdTab = tab
  page.classList.toggle('td-tab--logs', tab === 'logs')
  page.classList.toggle('td-tab--overview', tab === 'overview')
  page.classList.remove('td-tab--config')
  page.querySelectorAll('#td-section-tabs [data-td-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tdTab === tab)
  })
  page.querySelectorAll('[data-td-panel]').forEach((el) => {
    const panels = String(el.dataset.tdPanel || '').split(/\s+/).filter(Boolean)
    el.classList.toggle('td-tab-hidden', !panels.includes(tab))
  })
}

function renderExecTimeline(page, state) {
  const el = page.querySelector('#task-exec-timeline')
  if (!el) return
  const task = state.task
  const subtasks = Array.isArray(state.subtasks) ? state.subtasks : []
  const u = toUnifiedTaskStatus(task?.status)
  const show = u === 'running' || u === 'planning' || u === 'queued' || normalizeTaskStatusKey(task?.status) === 'paused'
  if (!task || !show) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  el.hidden = false
  const updated = formatDetailClock(task.updated_at || task.updatedAt) || '—'
  const duration = formatRunningDuration(task) || '—'
  const items = subtasks.length
    ? subtasks.map((s) => {
      const su = toUnifiedTaskStatus(s?.status)
      let phase = 'waiting'
      if (su === 'completed') phase = 'done'
      else if (su === 'running' || su === 'planning') phase = 'current'
      else if (su === 'failed') phase = 'failed'
      else if (su === 'cancelled') phase = 'cancelled'
      const label = {
        done: _l('已完成', 'tasks.statusCompleted'),
        current: _l('当前执行', 'tasks.dtlStepCurrent'),
        waiting: _l('等待', 'tasks.dtlStepWaiting'),
        failed: _l('异常', 'tasks.statusFailed'),
        cancelled: _l('已取消', 'tasks.statusCancelled'),
      }[phase]
      const name = String(s?.name || s?.id || _l('步骤', 'tasks.dtlStepFallback')).trim()
      const step = phase === 'current' ? taskLiveStepText(s) : ''
      return `<li class="td-timeline-item td-timeline-item--${phase}">
        <span class="td-timeline-dot" aria-hidden="true"></span>
        <div class="td-timeline-body">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(step || `${label} · ${formatUnifiedStatusZh(s?.status)}`)}</span>
        </div>
      </li>`
    }).join('')
    : `<li class="td-timeline-item td-timeline-item--${u === 'planning' ? 'current' : 'waiting'}">
        <span class="td-timeline-dot" aria-hidden="true"></span>
        <div class="td-timeline-body">
          <strong>${u === 'planning' ? _l('正在规划', 'tasks.dtlStepPlanning') : (u === 'queued' ? _l('规划已完成，等待执行', 'tasks.execQueuedHint') : _l('等待步骤拆解', 'tasks.dtlStepWaitingSplit'))}</strong>
          <span>${escapeHtml(formatUnifiedStatusZh(task.status))}</span>
        </div>
      </li>`

  el.innerHTML = `
    <header class="td-timeline-head">
      <h2 class="td-card-title">${_l('执行步骤', 'tasks.dtlStepsTitle')}</h2>
      <div class="td-timeline-meta">
        <span>${_l('最近更新 {t}', 'tasks.dtlLastUpdated', { t: updated })}</span>
        <span>${_l('已运行 {d}', 'tasks.dtlRanFor', { d: duration })}</span>
      </div>
    </header>
    <ol class="td-timeline-list">${items}</ol>
    <div class="td-timeline-actions">
      ${isTaskPausableStatus(task.status) || normalizeTaskStatusKey(task.status) === 'paused'
        ? `<button type="button" class="btn btn-sm btn-warning" data-timeline-act="pause">${normalizeTaskStatusKey(task.status) === 'paused' ? _l('继续', 'tasks.dtlResume') : _l('暂停', 'tasks.actStop')}</button>`
        : ''}
      ${isTaskCancellableStatus(task.status)
        ? `<button type="button" class="btn btn-sm btn-secondary" data-timeline-act="cancel">${_l('取消', 'tasks.actCancel')}</button>`
        : ''}
    </div>`

  if (!el._timelineBound) {
    el._timelineBound = true
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-timeline-act]')
      if (!btn) return
      if (btn.dataset.timelineAct === 'pause') void handlePauseButton(page, state)
      if (btn.dataset.timelineAct === 'cancel') void handleCancelTaskFromDetail(page, state)
    })
  }
}

function renderTaskChangelog(page, state) {
  const panel = page.querySelector('#task-changelog-panel')
  const body = page.querySelector('#task-changelog-body')
  if (!panel || !body) return
  const task = state.task
  if (!task) {
    body.innerHTML = `<p class="td-muted">${_l('暂无变更记录', 'tasks.dtlNoChanges')}</p>`
    return
  }
  const entries = []
  const push = (time, text) => {
    if (!text) return
    entries.push({ time: time || '', text })
  }
  push(formatDetailClock(task.created_at || task.createdAt), _l('创建任务', 'tasks.dtlHistCreated'))
  if (task.started_at || task.startedAt) push(formatDetailClock(task.started_at || task.startedAt), _l('开始执行', 'tasks.dtlHistStarted'))
  if (toUnifiedTaskStatus(task.status) === 'cancelled') {
    push(
      formatDetailClock(task.cancelled_at || task.cancelledAt || task.completed_at || task.completedAt),
      _l('取消：{reason}', 'tasks.dtlHistCancelled', { reason: String(task.cancel_reason || task.cancelReason || _l('用户取消', 'tasks.dtlUserCancelled')).trim() }),
    )
  }
  if (toUnifiedTaskStatus(task.status) === 'completed') {
    push(formatDetailClock(task.completed_at || task.completedAt), _l('任务完成', 'tasks.dtlHistCompleted'))
  }
  if (toUnifiedTaskStatus(task.status) === 'failed') {
    push(formatDetailClock(task.completed_at || task.completedAt || task.updated_at), _l('异常：{err}', 'tasks.dtlHistFailed', { err: String(task.error || _l('执行失败', 'tasks.runExecFailed')).trim().slice(0, 80) }))
  }
  const history = Array.isArray(task.status_history) ? task.status_history
    : (Array.isArray(task.change_log) ? task.change_log : [])
  for (const h of history) {
    const t = formatDetailClock(h?.at || h?.time || h?.created_at)
    const text = String(h?.message || h?.comment || h?.status || '').trim()
    if (text) push(t, text)
  }
  if (!entries.length) {
    body.innerHTML = `<p class="td-muted">${_l('暂无变更记录', 'tasks.dtlNoChanges')}</p>`
    panel.hidden = state.detailTab !== 'changelog'
    return
  }
  body.innerHTML = `<ul class="td-changelog-list">${entries.map((e) => `
    <li>
      <time>${escapeHtml(e.time || '—')}</time>
      <span>${escapeHtml(e.text)}</span>
    </li>`).join('')}</ul>`
  panel.hidden = state.detailTab !== 'changelog'
}

async function handleCancelTaskFromDetail(page, state) {
  if (!isTaskCancellableStatus(state.task?.status)) {
    toast(_l('当前状态不可取消', 'tasks.dtlCancelNotAllowed'), 'warning')
    return
  }
  const yes = await showConfirm(_l('确定取消该任务？\n\n取消后任务将停止执行，记录仍保留。', 'tasks.dtlCancelConfirm'))
  if (!yes) return
  try {
    if (typeof api.cancelTask === 'function') await api.cancelTask(state.taskId)
    else await api.setTaskState(state.taskId, 'cancelled', _l('用户在任务详情取消', 'tasks.dtlCancelReason'))
    toast(_l('已取消', 'tasks.statusCancelled'), 'success')
    await loadTaskDetail(page, state)
  } catch (e) {
    toast(_l('取消失败：{err}', 'tasks.dtlCancelFailed', { err: e }), 'error')
  }
}

async function handleEditTaskFromDetail(page, state) {
  const task = state.task
  if (!task) return
  const u = toUnifiedTaskStatus(task.status)
  const fullEdit = u === 'pending'
  const replan = u === 'planning'
  const nameNoteOnly = !fullEdit
  showModal({
    title: replan ? _l('编辑并重新规划', 'tasks.actEditReplan') : (nameNoteOnly ? _l('编辑名称/备注', 'tasks.actEditNameNote') : _l('编辑任务', 'tasks.editTitle')),
    fields: [
      {
        name: 'name',
        label: u === 'completed' ? _l('标题', 'tasks.editNameLabelTitle') : _l('任务名称', 'tasks.createNameLabel'),
        value: String(task.name || ''),
        placeholder: _l('任务名称', 'tasks.createNameLabel'),
      },
      {
        name: 'description',
        label: nameNoteOnly && !replan ? _l('备注', 'tasks.noteLabelNote') : _l('任务描述', 'tasks.createDescLabel'),
        type: 'textarea',
        value: String(task.description || ''),
        placeholder: nameNoteOnly && !replan ? _l('补充备注', 'tasks.dtlNotePhShort') : _l('任务目标、约束与期望产物', 'tasks.notePhDesc'),
        rows: 4,
      },
    ],
    onConfirm: async (result) => {
      const name = String(result.name || '').trim()
      if (!name) {
        toast(_l('请输入任务名称', 'tasks.createNameRequired'), 'error')
        return
      }
      try {
        await api.updateTask(state.taskId, {
          name,
          description: String(result.description || '').trim(),
        })
        if (replan) {
          try {
            await api.startTaskPlanning(state.taskId)
            toast(_l('已保存并重新规划', 'tasks.savedReplan'), 'success')
          } catch (e) {
            toast(_l('已保存，但重新规划失败：{err}', 'tasks.savedReplanFailed', { err: e }), 'warning')
          }
        } else {
          toast(_l('已保存', 'tasks.saved'), 'success')
        }
        await loadTaskDetail(page, state)
      } catch (e) {
        toast(_l('保存失败：{err}', 'tasks.saveFailed', { err: e }), 'error')
      }
    },
  })
}

async function handleCopyRecreateFromDetail(page, state) {
  const task = state.task
  if (!task) return
  const baseName = String(task.name || _l('未命名任务', 'tasks.copyBase')).trim()
  // endsWith 判断针对既有中文数据保持原文；仅追加的后缀随语言走
  const name = baseName.endsWith('（副本）') ? baseName : `${baseName}${_l('（副本）', 'tasks.copySuffix')}`
  const desc = String(task.description || task.goal || '').trim()
  const runMode = String(task.run_mode || task.runMode || 'manual') === 'unattended' ? 'unattended' : 'manual'
  showModal({
    title: _l('复制并重新创建', 'tasks.copyTitle'),
    fields: [
      { name: 'name', label: _l('任务名称', 'tasks.createNameLabel'), value: name, placeholder: _l('任务名称', 'tasks.createNameLabel') },
      { name: 'description', label: _l('任务描述', 'tasks.createDescLabel'), type: 'textarea', value: desc, rows: 4 },
    ],
    onConfirm: async (result) => {
      const nextName = String(result.name || '').trim()
      if (!nextName) {
        toast(_l('请输入任务名称', 'tasks.createNameRequired'), 'error')
        return
      }
      try {
        const created = await api.createTask(nextName, String(result.description || '').trim(), runMode)
        const newId = String(created?.id || created?.data?.id || created?.task_id || '').trim()
        toast(_l('已创建新任务', 'tasks.copyCreated'), 'success')
        if (newId) window.location.hash = `#/task/${encodeURIComponent(newId)}`
        else window.location.hash = '#/tasks'
      } catch (e) {
        toast(_l('创建失败：{err}', 'tasks.dtlCreateFailed', { err: e }), 'error')
      }
    },
  })
}

async function handleRestartTask(page, state) {
  const yes = await showConfirm(_l('将基于当前任务再跑一版（原任务会归档）。确定继续？', 'tasks.dtlRerunConfirm'))
  if (!yes) return
  try {
    toast(_l('正在创建新任务…', 'tasks.dtlRerunCreating'), 'info')
    const result = await api.restartTask(state.taskId)
    const newTaskId = result?.new_task_id || result?.data?.new_task_id
    if (!newTaskId) throw new Error(result?.message || _l('创建新任务失败', 'tasks.dtlRerunFailedMsg'))
    toast(_l('新任务已创建: {id}', 'tasks.dtlRerunCreated', { id: newTaskId }), 'success')
    const newThreadId = result.new_thread_id || result?.data?.new_thread_id || ''
    const newSessionKey = result.new_session_key || result?.data?.new_session_key || `agent:main:task-${newTaskId}`
    sessionStorage.setItem('evopanel_pending_shell_session', newSessionKey)
    sessionStorage.setItem('evopanel_pending_shell_thread', newThreadId)
    sessionStorage.setItem('evopanel_pending_shell_task_id', newTaskId)
    sessionStorage.removeItem('evopanel_pending_shell_processed')
    window.location.hash = '#/chat'
  } catch (e) {
    toast(_l('再跑一次失败：{err}', 'tasks.dtlRerunFailed', { err: e }), 'error')
  }
}

function syncConversationPanelUi(page, state) {
  const section = page.querySelector('#task-conversation-section')
  const content = page.querySelector('#conversation-content')
  const toggle = page.querySelector('#btn-toggle-conversation')
  const hint = page.querySelector('[data-role="conv-toggle-hint"]')
  const refresh = page.querySelector('#btn-refresh-output')
  const expanded = !!state.conversationExpanded
  section?.classList.toggle('is-conversation-collapsed', !expanded)
  if (content) content.hidden = !expanded
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  if (hint) hint.textContent = expanded ? _l('收起', 'tasks.dtlConvCollapse') : _l('展开', 'tasks.dtlConvExpand')
  if (refresh) refresh.hidden = !expanded
}

function unescapeTaskText(raw) {
  return String(raw || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .trim()
}

function renderTaskDescription(page, task) {
  const el = page.querySelector('#task-brief-panel')
  if (!el) return
  if (!task) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  const rationale = unescapeTaskText(task.rationale || '')
  const desc = unescapeTaskText(taskDescriptionForDisplay(task) || task.description || '')
  const goal = unescapeTaskText(task.plan_goal || task.goal || '')
  const expected = unescapeTaskText(task.expected_outcome || '')

  // Prefer employee note (rationale) as lead; fall back to description / goal
  const body = rationale || desc || goal
  if (!body && !expected) {
    el.hidden = true
    el.innerHTML = ''
    return
  }

  // 审批说明与原始需求高度重叠时，只展示一份，避免主栏叠两块同质内容
  const showExtraDesc =
    Boolean(rationale) &&
    Boolean(desc) &&
    desc !== rationale &&
    !textLooksSimilar(rationale, desc)

  el.hidden = false
  el.innerHTML = `
    <h2 class="td-card-title">${_l('简要说明', 'tasks.dtlBriefTitle')}</h2>
    <div class="td-brief-body md-body">${body ? renderMarkdown(body) : `<p>${_l('（暂无说明）', 'tasks.dtlBriefEmpty')}</p>`}</div>
    ${
      showExtraDesc
        ? `<div class="td-brief-extra"><div class="td-aside-k">${_l('原始需求', 'tasks.dtlBriefOriginal')}</div><div class="td-brief-body md-body">${renderMarkdown(desc)}</div></div>`
        : ''
    }
    ${
      expected && expected !== body
        ? `<div class="td-brief-extra"><div class="td-aside-k">${_l('预期结果', 'tasks.dtlBriefExpected')}</div><div class="td-brief-body md-body"><p>${escapeHtml(expected)}</p></div></div>`
        : ''
    }
  `
}

/** Rough overlap check for rationale vs description (avoid duplicate blocks). */
function textLooksSimilar(a, b) {
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, '')
      .replace(/[\\n\\r\\t]/g, '')
      .slice(0, 180)
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x.includes(y.slice(0, Math.min(48, y.length))) || y.includes(x.slice(0, Math.min(48, x.length)))) {
    return true
  }
  // Shared distinctive tokens (file path / title phrase)
  const hits = ['organic-handoff', '有机转交', 'HandoffRequest', 'approval']
  const shared = hits.filter((t) => x.includes(t) && y.includes(t)).length
  return shared >= 2
}

async function loadTaskDetail(page, state) {
  try {
    state.task = await api.getTask(state.taskId)
    state.projectId = state.taskId
    state.subtasks = state.task.subtasks || []

    await ensureTaskDetailMaps(state)
    renderTaskHero(page, state)
    renderTaskDescription(page, state.task)
    updateTaskStatusTag(page, state.task.status)
    syncTaskHeroProgress(page, state)
    updateButtons(page, state)
    updateChatOnlyHeroActions(page, state.task)
    updateAppProvenanceUi(page, state.task)
    renderTaskObsSubtasks(page, state)
    renderTaskOutcomePanel(page, state)
    renderTaskDecisionPanel(page, state)

    // 加载执行历史；主控对话仅内嵌调试展开时加载
    await loadExecutionHistory(page, state)
    if (shouldLoadConversation(state)) {
      await loadTaskConversation(page, state)
    }

    // 根据任务状态管理轮询
    setupOutputPolling(page, state)

    try {
      const runtime = await api.getTaskRuntime(state.taskId)
      state.agents = runtime.agents || []
    } catch {
      state.agents = []
    }

    await loadTaskObservability(page, state)

    logTaskDetail('loadTaskDetail', {
      taskId: state.taskId,
      taskStatus: state.task?.status,
      subtaskCount: Array.isArray(state.subtasks) ? state.subtasks.length : 0,
      subtasks: (state.subtasks || []).map((s) => ({
        id: s?.id,
        status: s?.status,
        progress: s?.progress,
        hasResult: !!String(s?.result || '').trim(),
        resultLen: String(s?.result || '').length,
        hasError: !!String(s?.error || '').trim(),
      })),
    })
  } catch (e) {
    toast(_l('加载任务详情失败: {err}', 'tasks.dtlLoadFailed', { err: e }), 'error')
    logTaskDetail('loadTaskDetail:error', { taskId: state.taskId, error: String(e) })
    const titleEl = page.querySelector('#task-title')
    if (titleEl) titleEl.textContent = _l('加载失败', 'tasks.dtlLoadFailedTitle')
    const descEl = page.querySelector('#task-desc')
    if (descEl) descEl.textContent = String(e?.message || e)
  }
}

function taskDetailNeedsStatusPoll(status) {
  const u = toUnifiedTaskStatus(status)
  if (u === 'completed' || u === 'failed' || u === 'cancelled') return false
  // pending / planning / queued / running / waiting_confirmation / paused
  return true
}

function taskDetailPollIntervalMs(status) {
  const key = normalizeTaskStatusKey(status)
  if (isTaskRunningStatus(key) || isTaskPlanningStatus(key)) return 2000
  if (isTaskQueuedStatus(key) || key === 'paused' || isTaskWaitingConfirmation(key)) return 3000
  return 4000
}

function setupOutputPolling(page, state) {
  // 清除现有轮询
  if (state.outputRefreshInterval) {
    clearInterval(state.outputRefreshInterval)
    state.outputRefreshInterval = null
  }

  const statusKey = normalizeTaskStatusKey(state.task?.status)
  if (!taskDetailNeedsStatusPoll(statusKey)) return

  const pollMs = taskDetailPollIntervalMs(statusKey)
  state.outputRefreshInterval = setInterval(async () => {
    if (state._heroPollInFlight) return
    state._heroPollInFlight = true
    try {
      const prevStatus = normalizeTaskStatusKey(state.task?.status)
      const t = await api.getTask(state.taskId)
      state.task = t
      state.subtasks = t.subtasks || []
      renderTaskHero(page, state)
      renderTaskDescription(page, t)
      updateTaskStatusTag(page, t.status)
      syncTaskHeroProgress(page, state)
      updateButtons(page, state)
      updateChatOnlyHeroActions(page, t)
      updateAppProvenanceUi(page, t)
      renderTaskObsSubtasks(page, state)
      renderTaskOutcomePanel(page, state)
      renderTaskDecisionPanel(page, state)
      if (shouldLoadConversation(state)) {
        await loadTaskConversation(page, state)
      }
      await loadTaskObservability(page, state)
      const nextStatus = normalizeTaskStatusKey(t.status)
      // Re-arm when status class changes (queued→running, running→done, interval change).
      if (
        prevStatus !== nextStatus ||
        taskDetailPollIntervalMs(prevStatus) !== taskDetailPollIntervalMs(nextStatus) ||
        !taskDetailNeedsStatusPoll(nextStatus)
      ) {
        setupOutputPolling(page, state)
      }
    } catch (e) {
      logTaskDetail('heroPoll:error', { taskId: state.taskId, error: String(e) })
    } finally {
      state._heroPollInFlight = false
    }
  }, pollMs)
}

async function loadTaskConversation(page, state) {
  try {
    // 从 Gateway 应用层 transcript 获取对话记录
    const task = state.task || await api.getTask(state.taskId)
    const threadId = task?.thread_id || state.currentThreadId
    
    if (!threadId) {
      state.conversationMessages = []
      renderTaskConversation(page, state)
      return
    }
    
    // 应用层 transcript（gogo_chat_messages），与 LangGraph checkpoint 解耦
    const payload = await api.chatMessagesByThread(threadId, 150)
    const rawMessages = Array.isArray(payload?.messages) ? payload.messages : []
    
    // 转换为统一的消息格式
    state.conversationMessages = rawMessages.map(msg => {
      // 处理 content 可能是数组的情况
      let content = msg.content || ''
      if (Array.isArray(content)) {
        content = content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('')
      }
      
      // 规范化角色
      let role = msg.role || (msg.type === 'human' ? 'user' : msg.type === 'ai' ? 'assistant' : 'unknown')
      
      return {
        role: role,
        content: content,
        timestamp: msg.timestamp,
        type: msg.type,
        name: msg.name,
      }
    })
    
    renderTaskConversation(page, state)
    logTaskDetail('loadTaskConversation', {
      taskId: state.taskId,
      threadId,
      rawCount: Array.isArray(rawMessages) ? rawMessages.length : 0,
      displayCount: Array.isArray(state.conversationMessages) ? state.conversationMessages.length : 0,
    })
  } catch (e) {
    console.error('[loadTaskConversation] Error:', e)
    state.conversationMessages = []
    renderTaskConversation(page, state)
    logTaskDetail('loadTaskConversation:error', { taskId: state.taskId, error: String(e) })
  }
}

function renderTaskConversation(page, state) {
  const container = page.querySelector('#conversation-content')
  if (!container) return

  const messages = state.conversationMessages || []
  
  if (!messages.length) {
    container.innerHTML = `<div class="output-empty">${_l('暂无对话记录', 'tasks.dtlConvEmpty')}<br><span style="font-size:11px;color:var(--text-tertiary)">${_l('主控 Agent 执行后将显示对话', 'tasks.dtlConvEmptyHint')}</span></div>`
    return
  }

  // 过滤消息（隐藏系统消息和工具消息）
  const displayMessages = messages.filter(msg => {
    if (!msg || typeof msg !== 'object') return false
    
    const role = msg.role || ''
    const type = msg.type || ''
    const name = msg.name || ''
    
    // 1. 过滤 tool 类型消息
    if (role === 'tool' || role === 'toolResult' || type === 'tool' || type === 'tool_message') {
      return false
    }
    
    // 2. 过滤系统消息（collab_phase_hint 等中间件注入）
    const injectedNames = ['todo_reminder', 'collab_phase_hint', 'conversation_summary', 'tool_history']
    if (name && injectedNames.includes(name)) return false

    let rawContent = msg.content || ''
    const rawText = typeof rawContent === 'string'
      ? rawContent.trimStart()
      : (Array.isArray(rawContent)
        ? rawContent.map((b) => (b?.type === 'text' ? b.text : '')).join('\n').trimStart()
        : '')
    if (
      rawText.startsWith('[CONTEXT COMPACTION') ||
      rawText.startsWith('[上下文摘要') ||
      rawText.startsWith('[深度压缩摘要') ||
      rawText.startsWith('[tool:history]') ||
      rawText.toLowerCase().startsWith('here is a summary of the conversation to date') ||
      rawText.toLowerCase().startsWith("here's a summary of the conversation to date")
    ) {
      return false
    }
    
    // 3. 过滤空内容的 AI 消息
    let hasRealContent = false
    
    if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (block.type === 'text' && block.text?.trim()) {
          hasRealContent = true
          break
        }
      }
    } else if (typeof rawContent === 'string' && rawContent.trim()) {
      hasRealContent = true
    }
    
    if ((role === 'assistant' || type === 'ai' || type === 'AIMessage') && !hasRealContent) {
      return false
    }
    
    if (!hasRealContent) return false
    
    return true
  })

  if (!displayMessages.length) {
    container.innerHTML = `<div class="output-empty">${_l('暂无对话记录', 'tasks.dtlConvEmpty')}<br><span style="font-size:11px;color:var(--text-tertiary)">${_l('主控 Agent 执行后将显示对话', 'tasks.dtlConvEmptyHint')}</span></div>`
    return
  }

  // 丰富好看的卡片式消息样式，支持 Markdown
  container.innerHTML = displayMessages.map(msg => {
    const role = msg.role || ''
    const type = msg.type || ''
    let content = msg.content || ''
    const timestamp = msg.timestamp
    
    // 处理 content 为数组的情况
    if (Array.isArray(content)) {
      const texts = []
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text)
        }
      }
      content = texts.join('')
    }
    
    // 格式化时间
    let timeStr = ''
    if (timestamp) {
      try {
        const date = new Date(timestamp)
        if (!isNaN(date.getTime())) {
          timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }
      } catch {}
    }
    
    // 根据角色选择样式
    let roleLabel
    let roleClass
    
    // 规范化角色
    let normalizedRole = role
    const typeLower = String(type).toLowerCase()
    if (role === 'user' || typeLower === 'human' || typeLower === 'humanmessage' || type === 'user') {
      normalizedRole = 'user'
    } else if (role === 'assistant' || type === 'ai' || type === 'AIMessage' || type === 'AIMessageChunk') {
      normalizedRole = 'assistant'
    }
    
    switch (normalizedRole) {
      case 'user':
        roleLabel = _l('👤 用户', 'tasks.dtlRoleUser')
        roleClass = 'user-message'
        break
      case 'assistant':
        roleLabel = _l('🧭 主控', 'tasks.dtlRoleLead')
        roleClass = 'ai-message lead-message'
        break
      default:
        roleLabel = _l('🧭 主控', 'tasks.dtlRoleLead')
        roleClass = 'ai-message lead-message'
    }
    
    // 渲染内容（Markdown）
    const contentHtml = content ? renderMarkdown(content) : ''
    
    return `
      <div class="conversation-message ${roleClass}">
        <div class="message-header">
          <span class="message-role">${roleLabel}</span>
          <span class="message-time">${timeStr}</span>
        </div>
        <div class="message-body">
          ${contentHtml}
        </div>
      </div>
    `
  }).join('')
  
  // 滚动到底部
  container.scrollTop = container.scrollHeight
}

async function loadExecutionHistory(page, state) {
  try {
    const response = await api.getExecutionHistory(state.taskId)

    state.executionHistory = response.execution_history || []
    state.currentThreadId = response.current_thread_id
    state.currentSessionKey = response.session_key

    // 更新下拉框
    const select = page.querySelector('#execution-history-select')
    if (select) {
      select.innerHTML = `<option value="current">${_l('当前执行', 'tasks.dtlStepCurrent')}</option>`

      state.executionHistory.forEach(record => {
        const option = document.createElement('option')
        option.value = record.execution_id
        const statusIcon = record.status === 'completed' ? '✅' :
                          record.status === 'failed' ? '❌' :
                          record.status === 'cancelled' ? '⏸️' : '⏳'
        const timeStr = record.started_at ? new Date(record.started_at).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }) : ''
        option.textContent = `${statusIcon} ${record.execution_id} - ${timeStr}`
        select.appendChild(option)
      })
    }
  } catch (e) {
    console.error('[task-detail] 加载执行历史失败:', e)
  }
}

function renderSubtasks(page, state) {
  const container = page.querySelector('#subtasks-list')

  if (!state.subtasks.length) {
    container.innerHTML = `<div class="subtasks-empty">${_l('暂无子任务', 'tasks.dtlSubEmpty')}<br><span style="font-size:11px;color:var(--text-tertiary)">${_l('AI 将自动拆解任务，或手动添加子任务', 'tasks.dtlSubEmptyHint')}</span></div>`
    return
  }

  container.innerHTML = state.subtasks.map(sub => {
    const statusIcon = getSubtaskStatusIcon(sub.status)
    const statusTagClass = getSubtaskStatusTagClass(sub.status)
    const statusText = getSubtaskStatusText(sub.status)
    const progressBar = sub.progress > 0 ? `<div class="task-progress-bar"><div class="task-progress-fill" style="width:${sub.progress}%"></div></div>` : ''
    const assignedName = resolveAssignedAgentDisplayName(sub.assigned_to, state.agents) || sub.assigned_to || _l('未分配', 'tasks.dtlSubUnassigned')

    return `
      <div class="subtask-item" data-subtask-id="${sub.id}">
        <div class="subtask-status-icon">${statusIcon}</div>
        <div class="subtask-info">
          <div class="subtask-info-top">
            <code class="subtask-id-text">${escapeHtml(sub.name || _l('未命名', 'tasks.dtlSubUnnamed'))}</code>
            ${sub.dependencies?.length ? `<span class="tag tag--subtle">${_l('依赖 {n}', 'tasks.dtlSubDeps', { n: sub.dependencies.length })}</span>` : ''}
            ${sub.worker_profile ? `<span class="tag tag--config">${_l('配置', 'tasks.dtlSubConfig')}</span>` : ''}
          </div>
          <div class="subtask-meta">
            🤖 ${escapeHtml(assignedName)}
            ${sub.progress > 0 ? ` · ${sub.progress}%` : ''}
            ${sub.description ? ` · ${escapeHtml(sub.description.slice(0, 30))}${sub.description.length > 30 ? '...' : ''}` : ''}
          </div>
        </div>
        <span class="subtask-status-chip tag ${statusTagClass}" title="${_l('状态：{s}', 'tasks.dtlSubStatusTitle', { s: statusText })}">${escapeHtml(statusText)}</span>
        <div class="subtask-actions">
          <button class="btn btn-xs btn-ghost" data-action="detail" data-id="${sub.id}" title="${_l('详情', 'tasks.dtlSubDetail')}">📄</button>
          <button class="btn btn-xs btn-secondary" data-action="assign" data-id="${sub.id}" title="${_l('分配', 'tasks.dtlSubAssign')}">🤖</button>
          <button class="btn btn-xs btn-danger" data-action="delete" data-id="${sub.id}" title="${_l('删除', 'tasks.dtlSubDelete')}">✕</button>
        </div>
        <div class="subtask-progress-mini">${progressBar}</div>
      </div>
    `
  }).join('')
  logTaskDetail('renderSubtasks', {
    taskId: state.taskId,
    count: state.subtasks.length,
    subtasks: state.subtasks.map((s) => ({
      id: s?.id,
      name: s?.name,
      status: s?.status,
      hasResult: !!String(s?.result || '').trim(),
      resultPreview: String(s?.result || '').slice(0, 120),
      hasError: !!String(s?.error || '').trim(),
      claudeSessionId: s?.claude_session_id || s?.external_session_id || s?.claudeSessionId,
    })),
  })

  container.querySelectorAll('[data-action="detail"]').forEach(btn => {
    btn.addEventListener('click', () => showSubtaskDetail(page, state, btn.dataset.id))
  })

  container.querySelectorAll('[data-action="assign"]').forEach(btn => {
    btn.addEventListener('click', () => showAssignDialog(page, state, btn.dataset.id))
  })

  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteSubtask(page, state, btn.dataset.id))
  })

  container.querySelectorAll('[data-action="view-result"]').forEach(btn => {
    btn.addEventListener('click', () => viewSubtaskResult(page, state, btn.dataset.id))
  })
}

/* 任务记忆面板已隐藏
function renderFacts(page, facts) {
  const container = page.querySelector('#facts-list')

  if (!facts.length) {
    container.innerHTML = '<div class="facts-empty">暂无记忆<br><span style="font-size:11px;color:var(--text-tertiary)">任务执行后会自动提取关键事实</span></div>'
    return
  }

  const categoryLabels = { finding: '发现', decision: '决策', data: '数据', conclusion: '结论' }
  const categoryColors = { finding: '#3b82f6', decision: '#f59e0b', data: '#10b981', conclusion: '#8b5cf6' }

  container.innerHTML = facts.map(fact => `
    <div class="fact-item">
      <div class="fact-header">
        <span class="fact-category" style="background:${categoryColors[fact.category] || '#6b7280'}">${categoryLabels[fact.category] || fact.category}</span>
        <span class="fact-confidence">${Math.round((fact.confidence || 0.5) * 100)}%</span>
      </div>
      <p class="fact-content">${escapeHtml(fact.content || '')}</p>
    </div>
  `).join('')
}
*/

/* 执行者状态面板已隐藏
function renderAgents(page, state) {
  const container = page.querySelector('#agents-list')

  if (!state.agents.length) {
    container.innerHTML = '<div class="agents-empty">暂无执行中的 Agent</div>'
    return
  }

  container.innerHTML = state.agents.map(agent => {
    const statusIcon = agent.status === 'busy' ? '🔴' : agent.status === 'failed' ? '⚫' : '🟢'
    return `
      <div class="agent-item">
        <div class="agent-info">
          <span class="agent-status-icon">${statusIcon}</span>
          <span class="agent-name">${escapeHtml(agent.agent_name || agent.agent_id)}</span>
        </div>
        ${agent.current_subtask_id ? `<div class="agent-task">子任务: ${agent.current_subtask_id}</div>` : ''}
        ${agent.progress > 0 ? `<div class="agent-progress">进度: ${agent.progress}%</div>` : ''}
      </div>
    `
  }).join('')
}
*/

function updateTaskStats(page, state) {
  const container = page.querySelector('#task-stats')
  const stats = {
    total: state.subtasks.length,
    pending: state.subtasks.filter(t => t.status === 'pending').length,
    executing: state.subtasks.filter(t => t.status === 'executing').length,
    completed: state.subtasks.filter(t => t.status === 'completed').length,
    failed: state.subtasks.filter(t => t.status === 'failed').length,
  }

  container.innerHTML = `
    <span class="stat-item">${_l('总计: {n}', 'tasks.dtlStatTotal', { n: stats.total })}</span>
    <span class="stat-item stat-pending">${_l('待处理: {n}', 'tasks.dtlStatPending', { n: stats.pending })}</span>
    <span class="stat-item stat-executing">${_l('执行中: {n}', 'tasks.dtlStatExecuting', { n: stats.executing })}</span>
    <span class="stat-item stat-completed">${_l('完成: {n}', 'tasks.dtlStatCompleted', { n: stats.completed })}</span>
    ${stats.failed > 0 ? `<span class="stat-item stat-failed">${_l('失败: {n}', 'tasks.dtlStatFailed', { n: stats.failed })}</span>` : ''}
  `
  syncTaskHeroProgress(page, state)
}

/** 顶栏进度：仅执行中显示百分比；规划中/待执行不显示伪 100% */
function syncTaskHeroProgress(page, state) {
  const t = state.task
  if (!t) return
  const meta = computeTaskExecutionProgress(t, state.subtasks)
  const u = meta.unified
  const wrap = page.querySelector('#task-progress-wrap')
  const active = u === 'running' || u === 'planning' || normalizeTaskStatusKey(t.status) === 'paused'
  if (wrap) wrap.hidden = !active
  if (active) {
    const fill = page.querySelector('#task-progress-fill')
    const valueEl = page.querySelector('#task-progress-value')
    const labelEl = page.querySelector('#task-progress-label')
    const setFill = (pct, buffering = false) => {
      if (!fill) return
      fill.style.width = `${pct}%`
      fill.classList.toggle('is-buffering', buffering)
    }
    if (u === 'planning') {
      setFill(0, false)
      if (valueEl) valueEl.textContent = ''
      if (labelEl) labelEl.textContent = _l('规划中', 'tasks.statusPlanning')
    } else if (u === 'queued') {
      setFill(0, false)
      if (valueEl) valueEl.textContent = ''
      if (labelEl) labelEl.textContent = _l('规划已完成，等待执行', 'tasks.execQueuedHint')
    } else if (normalizeTaskStatusKey(t.status) === 'paused') {
      const pct = meta.showPercent && meta.progress != null ? meta.progress : 0
      setFill(pct, false)
      if (valueEl) valueEl.textContent = meta.showPercent ? `${pct}%` : '—'
      if (labelEl) labelEl.textContent = _l('已暂停', 'tasks.statusPaused')
    } else {
      const pct = meta.showPercent && meta.progress != null ? meta.progress : 0
      setFill(pct, pct < 100)
      if (valueEl) valueEl.textContent = meta.showPercent ? `${pct}%` : '—'
      if (labelEl) labelEl.textContent = _l('正在执行', 'tasks.dtlProgExecuting')
    }
    const subEl = page.querySelector('#task-progress-sub')
    if (subEl) {
      const activity = latestTaskActivityText(t, state.subtasks)
      if (activity) {
        subEl.hidden = false
        subEl.textContent = activity
      } else if (meta.subtaskCount > 0 && u === 'running') {
        subEl.hidden = false
        subEl.textContent = isWorkflowAppTask(t)
          ? nodeProgressLabel(meta.completedCount, meta.subtaskCount)
          : _l('子任务 {done}/{total} 已完成', 'tasks.dtlProgSubtasks', { done: meta.completedCount, total: meta.subtaskCount })
      } else {
        subEl.hidden = true
        subEl.textContent = ''
      }
    }
  }
  renderTaskHero(page, state)
  renderTaskStatusLine(page, state)
  renderTaskInfoChips(page, state)
  renderExecTimeline(page, state)
  renderTaskChangelog(page, state)
  updateMoreMenu(page, state)
  updateButtons(page, state)
  applyDetailTab(page, state)
}

function taskProgressMeta(task, subtasks) {
  const meta = computeTaskExecutionProgress(task, subtasks)
  return {
    progress: meta.progress ?? 0,
    showPercent: meta.showPercent,
    subtaskCount: meta.subtaskCount,
    completedCount: meta.completedCount,
    unified: meta.unified,
    label: meta.label,
  }
}

async function ensureTaskDetailMaps(state) {
  if (state._mapsLoaded) return
  try {
    const [agents, rolesRes] = await Promise.all([
      api.listAgents().catch(() => []),
      api.proactiveListRoles().catch(() => null),
    ])
    state.agentCatalog = Array.isArray(agents) ? agents : []
    const roles = Array.isArray(rolesRes?.roles) ? rolesRes.roles : (Array.isArray(rolesRes) ? rolesRes : [])
    const map = {}
    for (const r of roles) {
      const code = String(r?.agent_code || '').trim().toLowerCase()
      if (code) map[code] = r
    }
    state.rolesByCode = map
  } catch {
    state.agentCatalog = state.agentCatalog || []
    state.rolesByCode = state.rolesByCode || {}
  }
  state._mapsLoaded = true
}

function resolveDetailRoleLabel(task, state) {
  const role = String(task?.assigned_role || '').trim()
  if (role) return role
  const code = String(task?.assigned_to || '').trim().toLowerCase()
  if (code) {
    const name = String(state?.rolesByCode?.[code]?.role_name || '').trim()
    if (name) return name
  }
  return ''
}

function resolveDetailAgentLabel(task, state) {
  const code = String(task?.assigned_to || '').trim()
  if (!code) return ''
  return resolveAssignedAgentDisplayName(code, state?.agentCatalog || state?.agents || []) || code
}

function taskLiveStepText(obj) {
  return String(obj?.current_step || obj?.currentStep || obj?.progress_summary || '').trim()
}

/** 顶栏/时间线用的一句话最新进度（子任务 current_step 优先） */
function latestTaskActivityText(task, subtasks) {
  const list = Array.isArray(subtasks) ? subtasks : []
  const running = list.filter((s) => {
    const u = toUnifiedTaskStatus(s?.status)
    return u === 'running' || u === 'planning'
  })
  for (const s of running) {
    const step = taskLiveStepText(s)
    if (!step) continue
    const name = String(s?.name || '').trim()
    return running.length === 1 || !name ? step : `${name}：${step}`
  }
  const fromTask = taskLiveStepText(task)
  if (fromTask) return fromTask
  if (running.length === 1) {
    const name = String(running[0]?.name || '').trim()
    return name ? _l('正在执行：{name}', 'tasks.dtlProgRunningStep', { name }) : _l('正在执行', 'tasks.dtlProgExecuting')
  }
  if (running.length > 1) {
    const names = running.map((s) => String(s?.name || '').trim()).filter(Boolean).slice(0, 2)
    // 名单分隔符随语言走：zh 顿号、en 逗号
    const sep = getLang() === 'en' ? ', ' : '、'
    return names.length
      ? _l('并行推进：{names}{more}', 'tasks.dtlProgParallel', { names: names.join(sep), more: running.length > 2 ? '…' : '' })
      : _l('正在并行执行', 'tasks.dtlProgParallelGeneric')
  }
  return ''
}

function formatDetailClock(raw) {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function renderTaskInfoChips(page, state) {
  const el = page.querySelector('#task-info')
  if (!el) return
  const task = state.task
  if (!task) {
    el.innerHTML = ''
    return
  }
  const sourceKey = normalizeTaskSource(task.source)
  const sourceLabel = formatTaskSourceZh(task.source_zh || task.source)
  const channelRaw = String(task.source_channel || '').trim().toLowerCase()
  const channelZh = _mapLabel(DETAIL_SOURCE_CHANNEL_ZH, channelRaw, 'dtlChannel') || (channelRaw && channelRaw !== sourceKey ? channelRaw : '')
  const roleLabel = resolveDetailRoleLabel(task, state)
  const agentLabel = resolveDetailAgentLabel(task, state)
  const progressMeta = taskProgressMeta(task, state.subtasks)
  const { subtaskCount, completedCount } = progressMeta
  const appName = resolveSourceAppName(task) || resolveSourceAppId(task)
  const created = formatDetailClock(task.created_at || task.createdAt)
  const updated = formatDetailClock(task.updated_at || task.updatedAt)
  const started = formatDetailClock(task.started_at || task.startedAt)
  const finished = formatDetailClock(task.completed_at || task.completedAt)
  const desc = unescapeTaskText(taskDescriptionForDisplay(task) || '')
  const goal = unescapeTaskText(task.plan_goal || '') || desc
  const expected = unescapeTaskText(task.expected_outcome || '')
  const workflow = isWorkflowAppTask(task)
  const kindZh = runKindLabelZh(resolveTaskRunKind(task))
  const trigger = String(task.trigger_kind || task.triggerKind || 'manual').trim().toLowerCase()
  const triggerZh = trigger === 'api' ? _l('API 触发', 'tasks.dtlTriggerApi')
    : (trigger === 'schedule' || trigger === 'scheduled' || trigger === 'cron') ? _l('定时触发', 'tasks.dtlKindScheduled')
      : _l('手动触发', 'tasks.dtlTriggerManual')
  const statusZh = formatUnifiedStatusZh(task.status)
  const riskKey = String(task.risk_level || '').trim().toLowerCase()
  const riskZh = _mapLabel(DETAIL_RISK_LABEL, riskKey, 'dtlRisk') || (riskKey || '')
  const actionKey = String(task.action_type || '').trim().toLowerCase()
  const actionZh = _mapLabel(DETAIL_ACTION_TYPE_LABEL, actionKey, 'dtlAction') || (actionKey || '')
  const roster = Object.values(state.rolesByCode || {})
  const raisedRaw = String(task.raised_by || '').trim()
  const raisedZh = raisedRaw ? formatRaisedByLabel(raisedRaw, roster) : ''
  const wokenRaw = String(task.woken_by || '').trim()
  const wokenZh =
    wokenRaw && wokenRaw.toLowerCase() !== raisedRaw.toLowerCase()
      ? formatRaisedByLabel(wokenRaw, roster)
      : ''
  const parentId = String(task.parent_task_id || task.parent?.task_id || '').trim()
  const parentName = String(task.parent?.name || '').trim()
  const childIds = Array.isArray(task.child_task_ids) ? task.child_task_ids.filter(Boolean) : []
  const cancelledAt = formatDetailClock(task.cancelled_at || task.cancelledAt || (toUnifiedTaskStatus(task.status) === 'cancelled' ? (task.completed_at || task.completedAt) : ''))
  const cancelReason = String(task.cancel_reason || task.cancelReason || task.status_comment || '').trim()

  const primary = []
  const more = []
  primary.push([_l('状态', 'tasks.pageStatus'), statusZh])
  if (progressMeta.unified === 'cancelled') {
    if (cancelledAt) primary.push([_l('取消时间', 'tasks.dtlMetaCancelTime'), cancelledAt])
    primary.push([_l('取消原因', 'tasks.dtlMetaCancelReason'), cancelReason || _l('用户取消', 'tasks.dtlUserCancelled')])
    more.push([_l('取消时进度', 'tasks.dtlMetaCancelProgress'), progressMeta.showPercent ? `${progressMeta.progress}%` : '—'])
  } else if (progressMeta.showPercent && progressMeta.progress != null) {
    primary.push([_l('执行进度', 'tasks.dtlMetaProgress'), `${progressMeta.progress}%`])
  } else if (progressMeta.unified === 'queued') {
    primary.push([_l('阶段', 'tasks.dtlMetaStage'), _l('规划已完成，等待执行', 'tasks.execQueuedHint')])
  } else if (progressMeta.unified === 'planning') {
    primary.push([_l('阶段', 'tasks.dtlMetaStage'), _l('规划中', 'tasks.statusPlanning')])
  }
  if (workflow) {
    primary.push([_l('任务类型', 'tasks.dtlMetaTaskType'), _l('工作流运行', 'tasks.dtlTypeWorkflowRun')])
    if (kindZh) more.push([_l('运行模式', 'tasks.dtlMetaRunMode'), kindZh])
    more.push([_l('触发方式', 'tasks.dtlMetaTrigger'), triggerZh])
    if (appName) more.push([_l('来源工作流', 'tasks.dtlMetaSourceWorkflow'), appName])
    if (subtaskCount > 0) primary.push([_l('节点进度', 'tasks.dtlMetaNodeProgress'), `${completedCount} / ${subtaskCount}`])
  } else {
    if (roleLabel) primary.push([_l('执行岗位', 'tasks.dtlMetaRole'), roleLabel])
    if (agentLabel && agentLabel !== roleLabel) primary.push([_l('智能体', 'tasks.pageAgent'), agentLabel])
    if (raisedZh) primary.push([_l('提出人', 'tasks.dtlMetaRaisedBy'), raisedZh])
    if (riskZh) primary.push([_l('风险', 'tasks.dtlMetaRisk'), riskZh])
    if (actionZh) more.push([_l('类型', 'tasks.colType'), actionZh])
    if (sourceLabel && sourceLabel !== formatTaskSourceZh('')) {
      more.push([_l('来源', 'tasks.pageSource'), channelZh ? `${sourceLabel} · ${channelZh}` : sourceLabel])
    } else if (channelZh) {
      more.push([_l('来源', 'tasks.pageSource'), channelZh])
    }
    if (wokenZh) more.push([_l('叫醒', 'tasks.dtlMetaWoken'), wokenZh])
    if (subtaskCount > 0) more.push([_l('子任务', 'tasks.dtlMetaSubtasks'), `${completedCount}/${subtaskCount}`])
  }
  if (started) primary.push([_l('开始时间', 'tasks.dtlMetaStarted'), started])
  if (finished) more.push([_l('完成时间', 'tasks.dtlMetaFinished'), finished])
  if (created) more.push([_l('创建时间', 'tasks.dtlMetaCreated'), created])
  if (updated && updated !== finished && updated !== created) more.push([_l('更新时间', 'tasks.dtlMetaUpdated'), updated])

  const rowHtml = (rows) =>
    rows
      .map(
        ([k, v]) =>
          `<div class="td-aside-row"><dt>${escapeHtml(k)}</dt><dd title="${escapeHtml(String(v))}">${escapeHtml(String(v))}</dd></div>`,
      )
      .join('')

  const agentCode = String(task.assigned_to || '').trim()
  let links = ''
  if (sourceKey === 'role' && agentCode && state.taskId) {
    links += `<button type="button" class="td-aside-link td-aside-link--quiet" data-act="resume-employee-chat" data-agent-code="${escapeHtml(agentCode)}" data-task-id="${escapeHtml(state.taskId)}">${_l('续聊该任务', 'tasks.dtlResumeChat')}</button>`
    const href = `#/proactive/${encodeURIComponent(agentCode)}/work/${encodeURIComponent(state.taskId)}`
    links += `<a class="td-aside-link td-aside-link--quiet" href="${href}">${_l('打开员工工作项', 'tasks.dtlOpenWorkItem')}</a>`
  }
  if (sourceKey === 'chat') {
    links += `<a class="td-aside-link td-aside-link--quiet" href="#/workflow/${encodeURIComponent(state.taskId)}">${_l('打开工作流', 'tasks.dtlOpenWorkflow')}</a>`
  }
  if (workflow && resolveSourceAppId(task)) {
    links += `<a class="td-aside-link td-aside-link--quiet" href="#/apps/${encodeURIComponent(resolveSourceAppId(task))}">${_l('打开工作流', 'tasks.dtlOpenWorkflow')}</a>`
  }
  if (parentId) {
    links += `<a class="td-aside-link td-aside-link--quiet" href="#/task/${encodeURIComponent(parentId)}">${_l('上游任务{name}', 'tasks.dtlUpstreamTask', { name: parentName ? ` · ${escapeHtml(parentName.slice(0, 24))}` : '' })}</a>`
  }
  if (childIds.length === 1) {
    links += `<a class="td-aside-link td-aside-link--quiet" href="#/task/${encodeURIComponent(childIds[0])}">${_l('下游任务', 'tasks.dtlDownstreamTask')}</a>`
  } else if (childIds.length > 1) {
    links += childIds
      .map(
        (cid, i) =>
          `<a class="td-aside-link td-aside-link--quiet" href="#/task/${encodeURIComponent(cid)}">${_l('下游 #{i} · {id}', 'tasks.dtlDownstreamItem', { i: i + 1, id: escapeHtml(String(cid).slice(-8)) })}</a>`,
      )
      .join('')
  }

  const briefVisible = Boolean(page.querySelector('#task-brief-panel') && !page.querySelector('#task-brief-panel')?.hidden)
  const goalBlock =
    !briefVisible && goal
      ? (workflow
        ? `<details class="td-aside-fold"><summary>${_l('运行目标', 'tasks.dtlRunGoal')}</summary><p>${escapeHtml(goal.length > 600 ? goal.slice(0, 600) + '…' : goal)}</p></details>`
        : `<div class="td-aside-block"><div class="td-aside-k">${_l('原始需求', 'tasks.dtlBriefOriginal')}</div><p>${escapeHtml(desc.length > 320 ? desc.slice(0, 320) + '…' : desc)}</p></div>`)
      : ''

  el.innerHTML = `
    <h3 class="td-aside-title">${workflow ? _l('运行信息', 'tasks.dtlAsideTitleRun') : _l('任务信息', 'tasks.dtlAsideTitleTask')}</h3>
    <dl class="td-aside-dl">
      ${rowHtml(primary)}
    </dl>
    ${
      more.length
        ? `<details class="td-aside-more"><summary>${_l('更多信息', 'tasks.dtlMoreInfo')}</summary><dl class="td-aside-dl">${rowHtml(more)}</dl></details>`
        : ''
    }
    ${goalBlock}
    ${!briefVisible && expected ? `<div class="td-aside-block"><div class="td-aside-k">${_l('预期结果', 'tasks.dtlBriefExpected')}</div><p>${escapeHtml(expected.length > 240 ? expected.slice(0, 240) + '…' : expected)}</p></div>` : ''}
    ${links ? `<div class="td-aside-links">${links}</div>` : ''}
  `
}

function renderTaskStatusLine(page, state) {
  const el = page.querySelector('#task-status-line')
  if (!el) return
  const task = state.task
  if (!task) {
    el.textContent = ''
    return
  }
  const u = toUnifiedTaskStatus(task.status)
  const statusZh = formatUnifiedStatusZh(task.status)
  const started = formatDetailClock(task.started_at || task.startedAt || task.created_at)
  const finished = formatDetailClock(task.completed_at || task.completedAt || task.updated_at || task.updatedAt)
  const updated = formatDetailClock(task.updated_at || task.updatedAt)
  const obs = state.observability
  const durMs = Number(obs?.duration_ms)
  const dur = Number.isFinite(durMs) && durMs > 0
    ? formatDurationMs(durMs) + (obs?.duration_running ? '+' : '')
    : formatRunningDuration(task)
  const { subtaskCount, completedCount } = taskProgressMeta(task, state.subtasks)
  const workflow = isWorkflowAppTask(task)
  const kindZh = runKindLabelZh(resolveTaskRunKind(task))

  if (workflow) {
    const parts = []
    if (kindZh) parts.push(kindZh)
    parts.push(statusZh)
    if (started && finished && u !== 'running' && u !== 'planning') {
      parts.push(`${started} → ${finished}`)
    } else if (started) {
      parts.push(_l('{t} 开始', 'tasks.dtlLineStartedAt', { t: started }))
    } else if (finished) {
      parts.push(finished)
    }
    if (dur) parts.push(_l('耗时 {d}', 'tasks.dtlLineDuration', { d: dur }))
    if (updated && u === 'running') parts.push(_l('最近更新 {t}', 'tasks.dtlLastUpdated', { t: updated }))
    if (subtaskCount > 0) {
      const ok = u === 'completed'
      parts.push(ok
        ? _l('{done} / {total} 个节点成功', 'tasks.dtlLineNodesOk', { done: completedCount, total: subtaskCount })
        : nodeProgressLabel(completedCount, subtaskCount))
    }
    el.textContent = parts.join(' · ')
    el.dataset.group = toTaskStatusGroup(task.status)
    return
  }

  const icon = u === 'completed'
    ? '✓'
    : (u === 'failed' ? '✕' : (u === 'cancelled' ? '—' : '●'))
  const parts = [`${icon} ${statusZh}`]
  if (u === 'running' && updated) parts.push(_l('最近更新 {t}', 'tasks.dtlLastUpdated', { t: updated }))
  if (u === 'running' && dur) parts.push(_l('已运行 {d}', 'tasks.dtlRanFor', { d: dur }))
  else if (finished) parts.push(finished)
  else if (dur) parts.push(_l('耗时 {d}', 'tasks.dtlLineDuration', { d: dur }))
  // 取消原因已在顶部 Banner 展示，状态行保持短句
  el.textContent = parts.join(' · ')
  el.dataset.group = toTaskStatusGroup(task.status)
}

function formatRunningDuration(task) {
  const startRaw = task?.started_at || task?.startedAt
  if (!startRaw) return ''
  const start = new Date(startRaw)
  if (Number.isNaN(start.getTime())) return ''
  const endRaw = task?.completed_at || task?.completedAt
  const end = endRaw ? new Date(endRaw) : new Date()
  if (Number.isNaN(end.getTime())) return ''
  const sec = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000))
  if (sec < 60) return _l('{s}秒', 'tasks.dtlDurSec', { s: sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return _l('{m}分', 'tasks.dtlDurMin', { m: min })
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem ? _l('{h}小时{r}分', 'tasks.dtlDurHrMin', { h, r: rem }) : _l('{h}小时', 'tasks.dtlDurHr', { h })
}

function updateMoreMenu(page, state) {
  const task = state.task
  const code = String(task?.assigned_to || '').trim()
  const isRole = normalizeTaskSource(task?.source) === 'role' && !!code
  const workBtn = page.querySelector('#btn-open-work-item')
  if (workBtn) {
    workBtn.hidden = !isRole
    if (isRole) {
      workBtn.textContent = _l('打开员工工作项', 'tasks.dtlOpenWorkItem')
      workBtn.dataset.href = `#/proactive/${encodeURIComponent(code)}/work/${encodeURIComponent(state.taskId)}`
    }
  }
  const resumeBtn = page.querySelector('#btn-resume-employee-chat')
  if (resumeBtn) {
    resumeBtn.hidden = !isRole || !state.taskId
    if (isRole && state.taskId) {
      resumeBtn.dataset.agentCode = code
      resumeBtn.dataset.taskId = state.taskId
    }
  }
}

async function loadTaskObservability(page, state) {
  const metaEl = page.querySelector('#task-meta')
  if (!metaEl || !state.taskId) return
  try {
    const obs = await api.getTaskObservability(state.taskId)
    state.observability = obs && typeof obs === 'object' ? obs : null
    renderTaskObservabilityMeta(metaEl, state.observability)
    renderTaskObsSubtasks(page, state)
    renderTaskStatusLine(page, state)
  } catch (e) {
    logTaskDetail('loadTaskObservability:error', { taskId: state.taskId, error: String(e) })
    state.observability = null
    if (metaEl) {
      metaEl.hidden = true
      metaEl.innerHTML = ''
    }
    renderTaskObsSubtasks(page, state)
  }
}

function renderTaskObservabilityMeta(el, obs) {
  if (!el) return
  if (!obs || obs.enabled === false) {
    el.hidden = true
    el.innerHTML = ''
    return
  }

  const chips = []
  const modelCalls = Number(obs.model_invocations) || 0
  const toolCalls = Number(obs.tool_invocations) || 0
  const tokens = obs.tokens || {}
  const totalTok = Number(tokens.total) || 0

  if (modelCalls > 0) {
    chips.push(
      `<span class="task-meta-chip" title="${_l('主控与子任务 worker 调用大模型 API 的总次数', 'tasks.dtlChipModelCallsTitle')}">`
      + `${_l('模型调用 {n} 次', 'tasks.dtlChipModelCalls', { n: modelCalls })}</span>`,
    )
  }
  if (totalTok > 0) {
    const inTok = Number(tokens.input) || 0
    const outTok = Number(tokens.output) || 0
    chips.push(
      `<span class="task-meta-chip" title="${_l('输入 Token {in} · 输出 Token {out}', 'tasks.dtlChipTokenTitle', { in: inTok.toLocaleString(), out: outTok.toLocaleString() })}">`
      + `Token ${formatCompactNum(totalTok)}</span>`,
    )
  }
  if (toolCalls > 0) {
    const err = Number(obs.tool_errors) || 0
    const errHint = err > 0 ? _l('，其中 {n} 次失败', 'tasks.dtlChipToolErrHint', { n: err }) : ''
    chips.push(
      `<span class="task-meta-chip" title="${_l('Agent 调用内置/外部工具的总次数{hint}', 'tasks.dtlChipToolTitle', { hint: errHint })}">`
      + `${_l('工具 {n} 次', 'tasks.dtlChipTool', { n: toolCalls })}</span>`,
    )
  }
  if (obs.primary_model) {
    chips.push(
      `<span class="task-meta-chip" title="${_l('本任务 Token 消耗最多的模型', 'tasks.dtlChipTopModelTitle')}">`
      + `${_l('模型 {name}', 'tasks.dtlChipTopModel', { name: escapeHtml(obs.primary_model) })}</span>`,
    )
  }
  const durMs = Number(obs.duration_ms)
  if (Number.isFinite(durMs) && durMs > 0) {
    const durText = formatDurationMs(durMs)
    const runningHint = obs.duration_running ? _l('（任务仍在进行，时间为累计值）', 'tasks.dtlChipDurRunningHint') : ''
    chips.push(
      `<span class="task-meta-chip" title="${_l('从任务创建到结束（或当前时刻）的 wall-clock 总耗时{hint}', 'tasks.dtlChipDurTitle', { hint: runningHint })}">`
      + `${_l('耗时 {d}{plus}', 'tasks.dtlChipDur', { d: durText, plus: obs.duration_running ? '+' : '' })}</span>`,
    )
  }
  const runs = Number(obs.run_count) || 0
  if (runs > 0) {
    chips.push(
      `<span class="task-meta-chip" title="${_l('LangGraph 执行轮次（含重试与恢复）', 'tasks.dtlChipRunsTitle')}">`
      + `${_l('轮次 {n}', 'tasks.dtlChipRuns', { n: runs })}</span>`,
    )
  }
  const lead = obs.lead
  if (lead && (lead.model_invocations || lead.tool_invocations || lead.tokens?.total)) {
    const leadLine = formatSubtaskObsLine(lead)
    if (leadLine) {
      chips.push(
        `<span class="task-meta-chip" title="${_l('主控 Lead 线程观测（不含子任务 worker）', 'tasks.dtlChipLeadTitle')}">`
        + `${_l('主控 {line}', 'tasks.dtlChipLead', { line: escapeHtml(leadLine) })}</span>`,
      )
    }
  }

  if (!chips.length) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  el.hidden = false
  el.innerHTML = `<h3 class="td-aside-title">${_l('运行观测', 'tasks.dtlObsTitle')}</h3><div class="td-aside-chips">${chips.join('')}</div>`
}

function canOpenTaskWorkProcessPopup(task) {
  return Boolean(String(task?.assigned_to || '').trim())
}

async function openTaskWorkProcessPopup(page, state) {
  const task = state.task
  const agentCode = String(task?.assigned_to || '').trim()
  if (!agentCode) {
    toast(_l('该任务没有关联员工，无法打开执行过程', 'tasks.dtlNoEmployee'), 'warning')
    return false
  }
  if (!state.workProcessLive) {
    const { mountProactiveLiveProcess } = await import('../components/proactive-live-process.js')
    state.workProcessLive = mountProactiveLiveProcess(page)
  }
  const busy = toTaskStatusGroup(task?.status) === 'executing'
  const roundId = String(task?.round_id || task?.source_ref || '').trim()
  const taskName = String(task?.name || task?.title || '').trim()
  state.workProcessLive.open({
    agentCode,
    roleName: resolveDetailRoleLabel(task, state),
    busy,
    title: taskName || _l('执行过程', 'tasks.dtlTabLogs'),
    roundId,
    taskId: state.taskId,
    pollMs: busy ? 1000 : 4000,
  })
  return true
}

async function renderRoleWorkProcessInline(page, state) {
  const panel = page.querySelector('#task-obs-panel')
  const strip = page.querySelector('#task-obs-strip')
  const titleEl = page.querySelector('#task-obs-panel-title')
  const countEl = page.querySelector('#task-obs-panel-count')
  if (!strip) return

  const task = state.task
  const agentCode = String(task?.assigned_to || '').trim()
  if (!agentCode) {
    renderTaskLogsFallback(page, state)
    return
  }

  if (titleEl) titleEl.textContent = _l('执行过程', 'tasks.dtlTabLogs')
  if (countEl) countEl.textContent = ''
  if (panel) panel.hidden = false

  if (!state.workProcessLive) {
    const { mountProactiveLiveProcess } = await import('../components/proactive-live-process.js')
    state.workProcessLive = mountProactiveLiveProcess(page)
  }

  // 员工任务统一走 SubtaskExecutionDrawer 弹窗，不再内嵌「上班轨迹」事件列表
  strip.innerHTML = `
    <div class="td-logs-empty">
      <p class="td-logs-empty-lead">${_l('与主对话子任务弹窗同款，按轮次展示工具调用与模型回复。', 'tasks.dtlLogsEmptyLead')}</p>
      <p class="td-logs-empty-sub">${_l('点上方「执行过程」Tab 或下方按钮打开。', 'tasks.dtlLogsEmptySub')}</p>
      <div class="td-logs-empty-actions">
        <button type="button" class="btn btn-sm btn-primary" data-act="open-work-process">${_l('查看执行过程', 'tasks.dtlLogsOpen')}</button>
      </div>
    </div>`
}

function renderTaskLogsFallback(page, state) {
  const panel = page.querySelector('#task-obs-panel')
  const strip = page.querySelector('#task-obs-strip')
  const titleEl = page.querySelector('#task-obs-panel-title')
  const countEl = page.querySelector('#task-obs-panel-count')
  if (!strip) return

  if (state.workProcessLive?.isOpen?.()) {
    try {
      state.workProcessLive.close()
    } catch {
      /* ignore */
    }
  }

  if (titleEl) titleEl.textContent = _l('执行过程', 'tasks.dtlTabLogs')
  if (countEl) countEl.textContent = ''
  if (panel) panel.hidden = false

  strip.innerHTML = `
    <div class="td-logs-empty">
      <p class="td-logs-empty-lead">${_l('暂无子任务执行记录。', 'tasks.dtlObsEmptyLead')}</p>
      <p class="td-logs-empty-sub">${_l('任务拆成多个步骤后，会在这里显示进度、执行者与模型/工具调用统计。', 'tasks.dtlObsEmptySub')}</p>
    </div>`
}

function renderTaskObsSubtasks(page, state) {
  const panel = page.querySelector('#task-obs-panel')
  const strip = page.querySelector('#task-obs-strip')
  const titleEl = page.querySelector('#task-obs-panel-title')
  const countEl = page.querySelector('#task-obs-panel-count')
  if (!strip) return

  const task = state.task
  const agentCode = String(task?.assigned_to || '').trim()
  const isRole = normalizeTaskSource(task?.source) === 'role' && !!agentCode
  // 员工任务：直接复用上班轨迹，不再空提示跳转
  if (isRole) {
    void renderRoleWorkProcessInline(page, state)
    return
  }

  // 非员工任务：关闭可能残留的员工执行过程弹窗
  if (state.workProcessLive?.isOpen?.()) {
    try {
      state.workProcessLive.close()
    } catch {
      /* ignore */
    }
  }

  const subtasks = Array.isArray(state.subtasks) ? state.subtasks : []
  const workflow = isWorkflowAppTask(state.task)
  if (!subtasks.length) {
    renderTaskLogsFallback(page, state)
    return
  }

  const { completedCount } = taskProgressMeta(state.task, subtasks)
  if (titleEl) titleEl.textContent = workflow ? _l('执行过程', 'tasks.dtlTabLogs') : _l('子任务进度', 'tasks.dtlObsPanelTitle')
  if (countEl) {
    countEl.textContent = workflow
      ? _l('{done} / {total} 个节点', 'tasks.dtlObsNodes', { done: completedCount, total: subtasks.length })
      : _l('{done}/{total} 完成', 'tasks.dtlObsDone', { done: completedCount, total: subtasks.length })
  }

  const obs = state.observability
  const obsById = new Map()
  if (obs && obs.enabled !== false && Array.isArray(obs.subtasks)) {
    for (const row of obs.subtasks) {
      const id = String(row?.subtask_id || row?.subtaskId || '').trim()
      if (id) obsById.set(id, row)
    }
  }

  if (workflow) {
    strip.innerHTML = renderWorkflowExecTreeHtml(subtasks, state, obsById)
    if (panel) panel.hidden = false
    strip.querySelectorAll('[data-subtask-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const sid = row.getAttribute('data-subtask-id')
        if (sid) showSubtaskDetail(page, state, sid)
      })
    })
    return
  }

  const rowsHtml = subtasks.map((sub) => {
    const sid = String(sub?.id || '').trim()
    const name = String(sub?.name || sid || _l('子任务', 'tasks.dtlSubFallback'))
    const status = String(sub?.status || '').trim()
    const statusZh = formatTaskStatusZh(status, { fallback: '—' })
    const statusClass = taskStatusTagClass(status)
    const prog = Math.max(0, Math.min(100, parseInt(sub?.progress, 10) || 0))
    const assignee = String(sub?.assigned_to || '').trim()
    const assigneeLabel = assignee
      ? (resolveAssignedAgentDisplayName(assignee, state.agentCatalog || state.agents || []) || assignee)
      : ''
    const metrics = obsById.get(sid) || null
    const modelN = Number(metrics?.model_invocations) || 0
    const toolN = Number(metrics?.tool_invocations) || 0
    const tok = metrics?.tokens && typeof metrics.tokens === 'object' ? metrics.tokens : {}
    const inTok = Number(tok.input) || 0
    const outTok = Number(tok.output) || 0
    const durMs = Number(metrics?.duration_ms)
    const durText = Number.isFinite(durMs) && durMs > 0
      ? `${formatDurationMs(durMs)}${metrics?.duration_running ? '+' : ''}`
      : '—'
    const tokenText = inTok > 0 || outTok > 0
      ? `↓${formatCompactNum(inTok)} ↑${formatCompactNum(outTok)}`
      : '—'
    const hasMetrics = !!(metrics && (modelN || toolN || inTok || outTok || (Number.isFinite(durMs) && durMs > 0)))
    const liveStep = (toUnifiedTaskStatus(status) === 'running' || toUnifiedTaskStatus(status) === 'planning')
      ? taskLiveStepText(sub)
      : ''

    return `
      <tr class="task-obs-table-row${hasMetrics ? '' : ' is-empty'}${liveStep ? ' is-live' : ''}" data-subtask-id="${escapeHtml(sid)}">
        <td class="task-obs-table-name" title="${escapeHtml(liveStep || name)}">
          ${escapeHtml(name)}
          ${liveStep ? `<div class="task-obs-table-live">${escapeHtml(liveStep)}</div>` : ''}
        </td>
        <td class="task-obs-table-status"><span class="tag ${statusClass}" title="${_l('状态：{s}', 'tasks.dtlSubStatusTitle', { s: statusZh })}">${escapeHtml(statusZh)}</span></td>
        <td class="task-obs-table-num">${prog > 0 ? `${prog}%` : '—'}</td>
        <td class="task-obs-table-agent" title="${escapeHtml(assigneeLabel)}">${assigneeLabel ? escapeHtml(assigneeLabel) : '—'}</td>
        <td class="task-obs-table-num">${durText}</td>
        <td class="task-obs-table-num">${modelN > 0 ? modelN : '—'}</td>
        <td class="task-obs-table-num">${toolN > 0 ? toolN : '—'}</td>
        <td class="task-obs-table-tokens">${tokenText}</td>
      </tr>`
  }).join('')

  strip.innerHTML = `
    <div class="task-obs-table-wrap">
      <table class="task-obs-table">
        <thead>
          <tr>
            <th>${_l('子任务', 'tasks.dtlSubFallback')}</th>
            <th>${_l('状态', 'tasks.pageStatus')}</th>
            <th>${_l('进度', 'tasks.thProgress')}</th>
            <th>${_l('执行者', 'tasks.dtlThExecutor')}</th>
            <th title="${_l('子任务开始至结束的 wall-clock 耗时', 'tasks.dtlThDurationTitle')}">${_l('耗时', 'tasks.dtlThDuration')}</th>
            <th title="${_l('该子任务调用大模型 API 的次数', 'tasks.dtlThModelTitle')}">${_l('模型', 'tasks.dtlThModel')}</th>
            <th title="${_l('该子任务调用工具的次数', 'tasks.dtlThToolTitle')}">${_l('工具', 'tasks.dtlThTool')}</th>
            <th title="${_l('输入 ↓ / 输出 ↑ Token 用量', 'tasks.dtlThTokenTitle')}">Token</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`

  if (panel) panel.hidden = false
}

/** 按依赖关系缩进展示工作流节点（并行组同层） */
function renderWorkflowExecTreeHtml(subtasks, state, obsById) {
  const list = Array.isArray(subtasks) ? subtasks : []
  const byId = new Map(list.map((s) => [String(s.id || ''), s]))
  const depIdsOf = (sub) => {
    const wp = sub?.worker_profile
    const fromWp = Array.isArray(wp?.depends_on) ? wp.depends_on : []
    const fromRoot = Array.isArray(sub?.dependencies) ? sub.dependencies : []
    return [...new Set([...fromWp, ...fromRoot].map((id) => String(id || '').trim()).filter((id) => byId.has(id)))]
  }
  const depthMap = new Map()
  const getDepth = (id, stack = new Set()) => {
    if (depthMap.has(id)) return depthMap.get(id)
    if (stack.has(id)) return 0
    stack.add(id)
    const deps = depIdsOf(byId.get(id) || {})
    if (!deps.length) {
      depthMap.set(id, 0)
      return 0
    }
    const upstream = deps.map((d) => getDepth(d, stack))
    const d = 1 + Math.max(...upstream)
    depthMap.set(id, d)
    return d
  }
  list.forEach((s) => getDepth(String(s.id || '')))

  const groups = new Map()
  for (const sub of list) {
    const id = String(sub.id || '')
    const deps = depIdsOf(sub)
    const key = `${depthMap.get(id) || 0}|${[...deps].sort().join(',')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(id)
  }

  const ordered = [...list].sort((a, b) => {
    const da = depthMap.get(String(a.id || '')) || 0
    const db = depthMap.get(String(b.id || '')) || 0
    if (da !== db) return da - db
    return 0
  })

  const items = ordered.map((sub) => {
    const sid = String(sub?.id || '').trim()
    const deps = depIdsOf(sub)
    const key = `${depthMap.get(sid) || 0}|${[...deps].sort().join(',')}`
    const group = groups.get(key) || [sid]
    const name = String(sub?.name || sid || _l('节点', 'tasks.nodeFallback'))
    const status = String(sub?.status || '').trim()
    const statusZh = formatTaskStatusZh(status, { fallback: '—' })
    const g = toTaskStatusGroup(status)
    const glyph = g === 'completed' || g === 'reviewed' ? '✓'
      : (g === 'failed' ? '!' : (g === 'executing' || g === 'planning' ? '●' : '○'))
    const assignee = String(sub?.assigned_to || '').trim()
    const assigneeLabel = assignee
      ? (resolveAssignedAgentDisplayName(assignee, state.agentCatalog || state.agents || []) || assignee)
      : ''
    const metrics = obsById?.get(sid) || null
    const durMs = Number(metrics?.duration_ms)
    const durText = Number.isFinite(durMs) && durMs > 0
      ? `${formatDurationMs(durMs)}${metrics?.duration_running ? '+' : ''}`
      : ''
    const metaBits = [statusZh, assigneeLabel, durText].filter(Boolean)
    const depth = depthMap.get(sid) || 0
    const isParallel = group.length > 1
    const liveStep = (g === 'executing' || g === 'planning') ? taskLiveStepText(sub) : ''
    return `
      <button type="button" class="td-flow-node is-${escapeHtml(g)}${isParallel ? ' is-parallel' : ''}${liveStep ? ' is-live' : ''}"
        data-subtask-id="${escapeHtml(sid)}" style="--flow-depth:${depth}"
        title="${escapeHtml(liveStep ? `${name}\n${liveStep}` : name)}">
        <span class="td-flow-glyph" aria-hidden="true">${glyph}</span>
        <span class="td-flow-body">
          <span class="td-flow-name">${escapeHtml(name)}</span>
          ${liveStep ? `<span class="td-flow-step">${escapeHtml(liveStep)}</span>` : ''}
          <span class="td-flow-meta">${escapeHtml(metaBits.join(' · '))}</span>
        </span>
      </button>`
  }).join('')

  return `<div class="td-flow-tree" role="list">${items}</div>`
}

/* Supervisor 面板已隐藏
function updateSupervisorPanel(page, state) {
  const status = page.querySelector('#supervisor-status')
  const message = page.querySelector('#supervisor-message')
  const log = page.querySelector('#supervisor-log')

  const taskStatus = state.task?.status || 'pending'

  if (taskStatus === 'executing') {
    status.textContent = '🟢 执行中'
    status.className = 'supervisor-status active'
    message.textContent = 'Supervisor 正在协调子任务执行...'

    if (state.supervisorLog) {
      log.innerHTML = state.supervisorLog.map(entry =>
        `<div class="log-entry"><span class="log-time">${entry.time}</span><span class="log-msg">${escapeHtml(entry.msg)}</span></div>`
      ).join('')
    }
  } else if (taskStatus === 'planning') {
    status.textContent = '🔵 规划中'
    status.className = 'supervisor-status planning'
    message.textContent = 'Supervisor 正在分析任务并拆解子任务...'
  } else if (taskStatus === 'completed') {
    status.textContent = '✅ 完成'
    status.className = 'supervisor-status completed'
    message.textContent = '所有子任务已完成'
  } else if (taskStatus === 'failed') {
    status.textContent = '❌ 失败'
    status.className = 'supervisor-status failed'
    message.textContent = state.task.error || '任务执行失败'
  } else {
    status.textContent = '⚪ 待机'
    status.className = 'supervisor-status idle'
    message.textContent = '点击「开始执行」启动任务'
  }
}
*/

function updateTaskStatusTag(page, status) {
  const line = page.querySelector('#task-status-line')
  if (!line) return
  line.textContent = formatTaskStatusZh(status, { fallback: _l('待处理', 'tasks.statusPending') })
}

function updateButtons(page, state) {
  const btnPause = page.querySelector('#btn-pause')
  const btnCancel = page.querySelector('#btn-cancel-task')
  if (!btnPause) return
  const taskStatus = normalizeTaskStatusKey(state.task?.status)
  const u = toUnifiedTaskStatus(taskStatus)

  if (isTaskPausableStatus(taskStatus)) {
    btnPause.style.display = 'inline-flex'
    btnPause.textContent = _l('⏸ 暂停', 'tasks.dtlBtnPause')
    btnPause.className = 'btn btn-warning btn-sm'
  } else if (taskStatus === 'paused') {
    btnPause.style.display = 'inline-flex'
    btnPause.textContent = _l('▶ 继续', 'tasks.dtlBtnResume')
    btnPause.className = 'btn btn-success btn-sm'
  } else {
    btnPause.style.display = 'none'
  }

  if (btnCancel) {
    const showCancel = isTaskCancellableStatus(taskStatus) && (u === 'running' || u === 'planning' || u === 'queued' || u === 'pending' || taskStatus === 'paused')
    btnCancel.style.display = showCancel ? 'inline-flex' : 'none'
  }
}

/** 兼容旧调用名：同步更多菜单（仅 chat 显示计划/工作流） */
function updateChatOnlyHeroActions(page, task) {
  // loadTaskDetail 会再调 sync；这里仅按 task 刷新菜单项
  const fake = { task, taskId: String(task?.id || '') }
  updateMoreMenu(page, fake)
}

function resolveSourceAppId(task) {
  if (!task || typeof task !== 'object') return ''
  return String(task.source_app_id || task.sourceAppId || '').trim()
}

function resolveSourceAppName(task) {
  if (!task || typeof task !== 'object') return ''
  return String(task.source_app_name || task.sourceAppName || '').trim()
}

function isWorkflowAppTask(task) {
  if (!task) return false
  const src = normalizeTaskSource(task.source)
  return src === 'workflow' || !!resolveSourceAppId(task)
}

function resolveTaskRunKind(task) {
  const raw = String(task?.run_kind || task?.runKind || '').trim().toLowerCase()
  if (raw === 'debug' || raw === '调试') return 'debug'
  if (raw === 'scheduled' || raw === 'cron' || raw === '定时') return 'scheduled'
  if (raw === 'production' || raw === 'formal' || raw === '正式' || raw === 'prod') return 'production'
  return isWorkflowAppTask(task) ? 'debug' : ''
}

function runKindLabelZh(kind) {
  if (kind === 'debug') return _l('调试运行', 'tasks.dtlKindDebug')
  if (kind === 'scheduled') return _l('定时触发', 'tasks.dtlKindScheduled')
  if (kind === 'production') return _l('正式运行', 'tasks.dtlKindProduction')
  return ''
}

function taskDetailDisplayName(task) {
  if (isWorkflowAppTask(task)) {
    const app = resolveSourceAppName(task)
    if (app) return app
  }
  return String(task?.name || '').trim() || _l('未命名任务', 'tasks.copyBase')
}

function nodeProgressLabel(completedCount, subtaskCount) {
  return _l('节点进度 {done} / {total}', 'tasks.dtlNodeProgressLine', { done: completedCount, total: subtaskCount })
}

/** 来自 App 运行时：展示溯源芯片 +「再跑一次」 */
function updateAppProvenanceUi(page, task) {
  const provEl = page.querySelector('#task-app-provenance')
  const btnRerun = page.querySelector('#btn-rerun-app')
  const appId = resolveSourceAppId(task)
  const appName = resolveSourceAppName(task) || appId

  if (!appId) {
    if (provEl) {
      provEl.hidden = true
      provEl.innerHTML = ''
    }
    if (btnRerun) btnRerun.hidden = true
    return
  }

  if (provEl) {
    const ver = task.source_app_version ?? task.sourceAppVersion
    const verHint = ver != null && ver !== '' ? ` · v${ver}` : ''
    provEl.hidden = false
    provEl.innerHTML = `
      <a class="td-aside-link" href="#/apps/${encodeURIComponent(appId)}" title="${escAttr(appId)}">
        ${_l('来自工作流：{name}{ver} ›', 'tasks.dtlFromWorkflow', { name: escHtml(appName), ver: escHtml(verHint) })}
      </a>
    `
  }
  if (btnRerun) btnRerun.hidden = false
}

function escAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function handleRerunFromApp(page, state) {
  const appId = resolveSourceAppId(state.task)
  if (!appId) {
    toast.warning(_l('该任务不是从工作流运行来的', 'tasks.dtlNotFromWorkflow'))
    return
  }
  window.location.hash = `#/apps/${encodeURIComponent(appId)}/run`
}

async function handleSaveTaskAsApp(page, state) {
  const task = state.task
  if (!task) {
    toast.error(_l('任务未加载', 'tasks.dtlTaskNotLoaded'))
    return
  }
  const hasPlan = !!(task.plan_goal || task.plan_steps || task.plan_steps_json)
  if (!hasPlan) {
    toast.warning(_l('任务尚无计划，无法另存为工作流', 'tasks.dtlNoPlan'))
    return
  }
  promptSaveTaskAsApp({
    taskId: state.taskId,
    defaultName: String(task.name || '').trim() || _l('未命名工作流', 'tasks.dtlUnnamedWorkflow'),
    defaultDescription: taskDescriptionForDisplay(task) || '',
  })
}

async function handleStartButton(page, state) {
  const taskStatus = state.task?.status

  // 开始按钮仅在 pending 状态可用
  if (taskStatus !== 'pending') {
    return
  }

  // 首次开始任务
  toast(_l('任务开始执行', 'tasks.dtlStarted'), 'success')
  state.task.status = 'planning'
  state.task.subtasks = state.task.subtasks || []

  try {
    await api.startTaskPlanning(state.taskId)
    toast(_l('任务已启动', 'tasks.dtlStartedOk'), 'success')
  } catch (e) {
    toast(_l('启动失败: {err}', 'tasks.startFailed', { err: e }), 'error')
  }

  updateButtons(page, state)
  renderSubtasks(page, state)
  updateTaskStats(page, state)
}

async function handleRestartButton(page, state) {
  const btnRestart = page.querySelector('#btn-restart')
  const taskStatus = state.task?.status

  // 防止重复点击
  if (btnRestart.disabled) return

  // 如果任务正在执行中，显示确认对话框
  if (taskStatus === 'executing' || taskStatus === 'planning') {
    const confirmed = await showConfirm(
      _l('【警告】任务正在执行中，确定要重新开始吗？\n\n将创建全新的任务执行，原任务会被归档。', 'tasks.dtlRestartWarn')
    )
    if (!confirmed) return
  }

  try {
    btnRestart.disabled = true
    btnRestart.textContent = _l('↻ 创建新任务...', 'tasks.dtlBtnCreating')

    toast(_l('正在创建新任务...', 'tasks.dtlRerunCreatingDots'), 'info')

    // 调用后端重启接口 - 返回新任务信息
    const result = await api.restartTask(state.taskId)

    if (!result.success || !result.new_task_id) {
      throw new Error(_l('创建新任务失败', 'tasks.dtlRerunFailedMsg'))
    }

    const newTaskId = result.new_task_id
    const newThreadId = result.new_thread_id
    const newProjectId = result.new_project_id

    toast(_l('新任务已创建: {id}', 'tasks.dtlRerunCreated', { id: newTaskId }), 'success')

    // 优先使用后端在 thread metadata 写入的 session_key，避免同一 thread 产生两个会话记录
    const newSessionKey = result.new_session_key || `agent:main:task-${newTaskId}`

    // 设置 pending 数据用于跳转到新任务的对话页面
    sessionStorage.setItem('evopanel_pending_shell_session', newSessionKey)
    sessionStorage.setItem('evopanel_pending_shell_thread', newThreadId || '')
    sessionStorage.setItem('evopanel_pending_shell_task_id', newTaskId)
    sessionStorage.removeItem('evopanel_pending_shell_processed')

    // 直接跳转到实时对话页面查看新任务的执行
    window.location.hash = '#/chat'

  } catch (e) {
    toast(_l('创建新任务失败: {err}', 'tasks.dtlCreateTaskFailed', { err: e }), 'error')
    // 恢复按钮状态
    updateButtons(page, state)
    btnRestart.disabled = false
    btnRestart.textContent = _l('↻ 重新开始', 'tasks.dtlBtnRestart')
  }
}

async function handlePauseButton(page, state) {
  const taskStatus = normalizeTaskStatusKey(state.task?.status)
  const btnPause = page.querySelector('#btn-pause')

  if (btnPause.disabled) return

  const originalStatus = taskStatus
  btnPause.disabled = true

  try {
    if (isTaskPausableStatus(taskStatus)) {
      btnPause.textContent = _l('⏸ 暂停中...', 'tasks.dtlBtnPausing')
      await api.pauseTask(state.taskId)
      state.task.status = 'paused'
      toast(_l('任务已暂停', 'tasks.stopped'), 'success')
    } else if (taskStatus === 'paused') {
      btnPause.textContent = _l('▶ 继续中...', 'tasks.dtlBtnResuming')
      const resp = await api.resumeTask(state.taskId)
      state.task.status = resp?.status || resp?.data?.status || 'planned'
      toast(_l('任务已继续', 'tasks.dtlResumedOk'), 'success')
    }
    updateButtons(page, state)
    setupOutputPolling(page, state)
  } catch (e) {
    state.task.status = originalStatus
    updateButtons(page, state)
    toast(_l('操作失败: {err}', 'tasks.dtlOpFailed2', { err: e }), 'error')
  } finally {
    btnPause.disabled = false
    await loadTaskDetail(page, state)
  }
}

async function showAddSubtaskDialog(page, state) {
  const availableSubtasks = state.subtasks.filter(t => t.status !== 'executing')
  const dependencyOptions = availableSubtasks.map(t => ({ value: t.id, label: t.name || t.id }))

  showModal({
    title: _l('添加子任务', 'tasks.dtlSubAddTitle'),
    fields: [
      { name: 'name', label: _l('子任务名称', 'tasks.dtlSubNameLabel'), value: '', placeholder: _l('例如：搜索竞品信息', 'tasks.dtlSubNamePh') },
      { name: 'description', label: _l('任务描述', 'tasks.createDescLabel'), value: '', placeholder: _l('详细描述子任务内容', 'tasks.dtlSubDescPh') },
      ...(dependencyOptions.length > 0 ? [{ name: 'dependencies', label: _l('依赖任务', 'tasks.dtlSubDepsLabel'), type: 'multiselect', options: dependencyOptions, value: [] }] : []),
    ],
    onConfirm: async (result) => {
      const name = (result.name || '').trim()
      if (!name) {
        toast(_l('请输入子任务名称', 'tasks.dtlSubNameRequired'), 'error')
        return
      }

      try {
        await api.addSubtask(state.taskId, name, result.description || '', result.dependencies || [])
        toast(_l('子任务已添加', 'tasks.dtlSubAdded'), 'success')
        await loadTaskDetail(page, state)
      } catch (e) {
        toast(_l('添加失败: {err}', 'tasks.dtlSubAddFailed', { err: e }), 'error')
      }
    }
  })
}

function showAssignDialog(page, state, subtaskId) {
  const agents = [
    { value: 'researcher', label: _l('研究员 Agent', 'tasks.dtlAgentResearcher') },
    { value: 'writer', label: _l('写作 Agent', 'tasks.dtlAgentWriter') },
    { value: 'coder', label: _l('代码 Agent', 'tasks.dtlAgentCoder') },
    { value: 'general', label: _l('通用 Agent', 'tasks.dtlAgentGeneral') },
  ]

  showModal({
    title: _l('分配子任务', 'tasks.dtlSubAssignTitle'),
    fields: [
      { name: 'agent', label: _l('选择执行者', 'tasks.dtlSubAssignLabel'), type: 'select', options: agents, value: '' },
    ],
    onConfirm: async (result) => {
      if (!result.agent) {
        toast(_l('请选择执行者', 'tasks.dtlSubAssignRequired'), 'error')
        return
      }

      try {
        await api.assignSubtask(state.taskId, subtaskId, result.agent)
        await loadTaskDetail(page, state)
        toast(_l('已分配给 {name}', 'tasks.dtlSubAssigned', { name: result.agent }), 'success')
      } catch (e) {
        toast(_l('分配失败: {err}', 'tasks.dtlSubAssignFailed', { err: e }), 'error')
      }
    }
  })
}

async function deleteSubtask(page, state, subtaskId) {
  const yes = await showConfirm(_l('确定删除该子任务？', 'tasks.dtlSubDeleteConfirm'))
  if (!yes) return

  try {
    await api.deleteSubtask(state.taskId, subtaskId)
    toast(_l('已删除', 'tasks.dtlSubDeleted'), 'success')
    await loadTaskDetail(page, state)
  } catch (e) {
    toast(_l('删除失败: {err}', 'tasks.dtlSubDeleteFailed', { err: e }), 'error')
  }
}

async function viewSubtaskResult(page, state, subtaskId) {
  const subtask = state.subtasks.find(t => t.id === subtaskId)
  if (!subtask) return

  showModal({
    title: _l('子任务结果: {name}', 'tasks.dtlSubResultTitle', { name: subtask.name }),
    width: 700,
    fields: [
      {
        name: 'result',
        label: _l('执行结果', 'tasks.dtlSubResultLabel'),
        type: 'textarea',
        value: normalizeSubtaskResultForDisplay(subtask.result) || _l('无结果', 'tasks.dtlSubResultEmpty'),
        readonly: true,
        rows: 15,
      },
    ],
    onConfirm: () => {},
  })
}

/** 主任务级：弹窗查看结构化 plan（复用主对话 PlanDetailModal）。 */
async function showTaskPlanModal(page, state) {
  try {
    const fresh = await api.getTask(state.taskId)
    state.task = fresh
    state.subtasks = fresh.subtasks || []
    updateChatOnlyHeroActions(page, state.task)
  } catch (e) {
    logTaskDetail('showTaskPlanModal:refreshFailed', { error: String(e) })
  }
  const goal = String(state.task?.plan_goal || '').trim()
  let steps = state.task?.plan_steps
  if (!Array.isArray(steps)) {
    const raw = state.task?.plan_steps_json
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      try {
        steps = JSON.parse(raw)
      } catch {
        steps = []
      }
    } else {
      steps = []
    }
  }
  if (!goal && !(Array.isArray(steps) && steps.length)) {
    toast(_l('当前任务尚未绑定 Plan', 'tasks.dtlNoPlanBound'), 'info')
    return
  }
  const opened = openTaskPlanModal({ task: state.task })
  if (!opened) {
    toast(_l('计划弹窗尚未就绪，请稍后重试', 'tasks.dtlPlanNotReady'), 'warning')
  }
}

async function showSubtaskDetail(page, state, subtaskId) {
  const sid = String(subtaskId || '').trim()
  const tid = String(state.taskId || '').trim()
  if (!sid || !tid) return
  window.location.hash = `#/workflow/${encodeURIComponent(tid)}?subtask=${encodeURIComponent(sid)}`
}

/** 上游依赖名称（不含标题）：depends_on + dependencies 去重后解析为子任务名称，顿号分隔 */
function formatUpstreamTaskNamesOnly(subtask, allSubtasks) {
  const wp = subtask?.worker_profile
  const fromWp = Array.isArray(wp?.depends_on) ? wp.depends_on : []
  const fromRoot = Array.isArray(subtask?.dependencies) ? subtask.dependencies : []
  const ids = [...new Set([...fromWp, ...fromRoot].map((id) => String(id || '').trim()).filter(Boolean))]
  if (!ids.length) return ''
  const byId = new Map((allSubtasks || []).map((s) => [String(s.id), s]))
  const parts = ids.map((id) => {
    const st = byId.get(id)
    const name = st && String(st.name || '').trim()
    return name || id
  })
  // 名单分隔符随语言走：zh 顿号、en 逗号
  return parts.join(getLang() === 'en' ? ', ' : '、')
}

function getSubtaskStatusIcon(status) {
  const key = normalizeTaskStatusKey(status)
  const icons = {
    pending: '<span class="status-dot status-pending"></span>',
    planning: '<span class="status-dot status-pending"></span>',
    planned: '<span class="status-dot status-pending"></span>',
    executing: '<span class="status-spinner"></span>',
    in_progress: '<span class="status-spinner"></span>',
    running: '<span class="status-spinner"></span>',
    active: '<span class="status-spinner"></span>',
    verifying: '<span class="status-spinner"></span>',
    reflecting: '<span class="status-spinner"></span>',
    completed: '<span class="status-check">✓</span>',
    done: '<span class="status-check">✓</span>',
    success: '<span class="status-check">✓</span>',
    failed: '<span class="status-failed">✕</span>',
    error: '<span class="status-failed">✕</span>',
    timed_out: '<span class="status-failed">✕</span>',
    cancelled: '<span class="status-cancelled">⏸</span>',
    canceled: '<span class="status-cancelled">⏸</span>',
  }
  return icons[key] || icons.pending
}

function getSubtaskStatusText(status) {
  return formatTaskStatusZh(status, { fallback: _l('待处理', 'tasks.statusPending') })
}

function getSubtaskStatusTagClass(status) {
  return taskStatusTagClass(status)
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function extractTaskId() {
  const hash = window.location.hash || ''
  const match = hash.match(/^#\/task\/([^/?]+)/)
  return match ? match[1] : null
}
