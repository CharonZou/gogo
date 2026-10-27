/**
 * 任务管理页面 - 多智能体协作核心
 */
import './items.css'
import '../style/ef-module-head.css'
import { api, invalidate, isGatewayWarming, waitForBackendReady } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'
import {
  formatUnifiedStatusZh,
  normalizeTaskStatusKey,
  toTaskStatusGroup,
  toUnifiedTaskStatus,
  computeTaskExecutionProgress,
  isTaskPausableStatus,
  isTaskRunningStatus,
  isTaskPlanningStatus,
  isTaskStartableStatus,
  isTaskCancellableStatus,
  countPausableByScope,
} from '../lib/task-status-label.js'
import { normalizeTaskSource, formatTaskSourceZh } from '../lib/task-source.js'
import { resolveAssignedAgentDisplayName } from '../lib/tool-display.js'
import { taskSummaryPreview } from '../lib/task-summary.js'
import { getPanelSetting } from '../lib/panel-settings.js'
import { getLang, t as i18nT } from '../lib/i18n.js'
import {
  buildTaskForest,
  flattenTaskRows,
  formatDownstreamHint,
  rootTasksOnly,
  selectRootTasks,
} from '../lib/task-tree.js'

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

/** 任务来源分区：对话 / 智能体员工 / 工作流（对应 task-source.js 三类） */
const SOURCE_TABS = [
  { key: 'chat', label: '对话', hint: '主对话里产生的 plan 与手动任务' },
  { key: 'role', label: '智能体员工', hint: '智能体员工派发或值班产生的任务' },
  { key: 'workflow', label: '工作流', hint: '工作流调试/正式/定时触发的运行（一次运行一条）' },
]

/** 来源筛选器（含自动化＝定时工作流） */
const SOURCE_FILTER_OPTIONS = [
  { key: 'chat', label: '对话' },
  { key: 'role', label: '智能体员工' },
  { key: 'workflow', label: '工作流' },
  { key: 'automation', label: '自动化' },
]

/** 顶部主标签：状态概览（与首页 KPI URL 对齐） */
const MAIN_STATUS_TABS = [
  { key: '', label: '全部', status: null },
  { key: 'todo', label: '待办', status: 'todo' },
  { key: 'inbox', label: '未派发', status: 'inbox' },
  { key: 'pending', label: '待处理', status: 'pending' },
  { key: 'running', label: '运行中', status: 'executing' },
  { key: 'completed', label: '已完成', status: 'completed' },
  { key: 'exception', label: '异常', status: 'failed' },
]

/** 监控面板状态分组（高级筛选 / 计数用；与统一态对齐） */
const STATUS_GROUPS = [
  { key: 'inbox', label: '待办', hint: '随手记下、尚未开跑', statuses: ['inbox'], tone: 'info' },
  { key: 'executing', label: '执行中', hint: '正在推进', statuses: ['executing', 'in_progress', 'running', 'active', 'verifying', 'reflecting', 'waiting_dispatch'], tone: 'primary' },
  { key: 'planning', label: '规划中', hint: 'AI 正在规划', statuses: ['planning'], tone: 'info' },
  { key: 'pending', label: '待处理', hint: '待处理 / 待执行 / 待确认', statuses: ['pending', 'queued', 'planned', 'plan_ready', 'awaiting_exec', 'req_confirm', 'waiting_user', 'awaiting_close', 'idle', 'blocked', 'paused'], tone: 'muted' },
  { key: 'paused', label: '已暂停', hint: '已暂停，随时可恢复', statuses: ['paused'], tone: 'warning' },
  { key: 'completed', label: '已完成', hint: '根单已验收关闭', statuses: ['completed', 'done', 'success', 'reviewed'], tone: 'success' },
  { key: 'failed', label: '异常', hint: '出错了，可查看原因重试', statuses: ['failed', 'error', 'timed_out'], tone: 'danger' },
  { key: 'cancelled', label: '已取消', hint: '已取消', statuses: ['cancelled', 'canceled'], tone: 'muted' },
]

/** 任务列表时间范围快捷筛选（仅时间窗口；列表条数由分页控制） */
const TIME_RANGE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '近1周' },
  { key: 'month', label: '近1月' },
]

/** 任务列表分页：每页条数 */
const PAGE_SIZE_OPTIONS = [
  { key: '10', label: '10 条/页' },
  { key: '20', label: '20 条/页' },
  { key: '50', label: '50 条/页' },
]

/** key（小写/数字）→ camelCase，用于拼词典 key 后缀 */
function _camelKey(k) {
  const s = String(k || '')
  return s.replace(/[-_]([a-z0-9])/gi, (_, c) => c.toUpperCase())
}

/** 首字母大写（词典 key 为扁平 camelCase，如 srcTabChat；t() 按点分层无法解析 key 内的点） */
function _upperFirst(s) {
  const str = String(s || '')
  return str ? str[0].toUpperCase() + str.slice(1) : str
}

/** 常量数组项本地化：按数组词典前缀 + 项 key 查 en 文案；zh 直返项内原文 */
function _localizeOptions(arr, i18nPrefix) {
  return arr.map((o) => ({
    ...o,
    label: _l(o.label, `tasks.${i18nPrefix}${_upperFirst(_camelKey(o.key || 'all'))}`),
    hint: o.hint != null ? _l(o.hint, `tasks.${i18nPrefix}Hint${_upperFirst(_camelKey(o.key || 'all'))}`) : o.hint,
  }))
}

/** 单项 label 本地化（find 之后用），找不到回退 fallbackZh；matchKey 指定匹配字段 */
function _optionLabel(arr, i18nPrefix, keyValue, fallbackZh, matchKey = 'key') {
  const o = arr.find((x) => String(x[matchKey] ?? '') === String(keyValue ?? ''))
  if (!o) return fallbackZh
  return _l(o.label, `tasks.${i18nPrefix}${_upperFirst(_camelKey(o.key || 'all'))}`)
}

/** 新手模板本地化：name/description/scenario 跟随语言（zh 直返原文） */
function _localizeTemplates() {
  return TASK_TEMPLATES.map((tpl) => {
    const k = _upperFirst(_camelKey(tpl.key))
    return {
      ...tpl,
      name: _l(tpl.name, `tasks.tpl${k}Name`),
      description: _l(tpl.description, `tasks.tpl${k}Desc`),
      scenario: _l(tpl.scenario, `tasks.tpl${k}Scenario`),
    }
  })
}

/** 新手模板：点击即预填新建任务表单，降低首次使用门槛 */
const TASK_TEMPLATES = [
  {
    key: 'competitor-analysis',
    name: '竞品分析报告',
    description: '分析指定竞品的产品功能、定价策略与市场定位，对比三家头部竞品，输出对比表格与关键结论，并给出对自身的启示建议。',
    runMode: 'manual',
    scenario: '调研 · 对比 · 出文档',
  },
  {
    key: 'code-refactor',
    name: '代码重构与测试',
    description: '改造指定模块代码：AI 自动拆成小步骤、边改边测，改完后告诉你改了哪、影响什么',
    runMode: 'manual',
    scenario: '多步骤工程改造',
  },
  {
    key: 'weekly-report',
    name: '本周工作周报',
    description: '汇总本周完成的工作、遇到的问题与下周计划，按固定模板格式输出周报文档。',
    runMode: 'unattended',
    scenario: '周期性文档生成',
  },
  {
    key: 'batch-data',
    name: '批量数据整理',
    description: '从多个地方收集数据，自动清洗、整理成表格，完成后给你 CSV 文件和摘要——你只管下指令，AI 自己干完',
    runMode: 'unattended',
    scenario: '适合无人值守的重复工作',
  },
]

const TASKS_TIME_RANGE_STORAGE_KEY = 'evopanel_tasks_time_range'
const TASKS_PAGE_SIZE_STORAGE_KEY = 'evopanel_tasks_page_size'
const TASKS_UNATTENDED_STORAGE_KEY = 'evopanel_tasks_unattended_mode'
const TASKS_SHOW_PATROL_STORAGE_KEY = 'evopanel_tasks_show_patrol'

/** 从 `#/tasks?source=role&agent=role:岗位名&status=pending&date=2026-05-29` 读入初始筛选 */
/** URL status 别名 → STATUS_GROUPS.key（首页 KPI 用 running/exception） */
const STATUS_QUERY_ALIASES = {
  running: 'executing',
  exception: 'failed',
  executing: 'executing',
  planning: 'planning',
  inbox: 'inbox',
  todo: 'inbox',
  pending: 'pending',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function readTasksQueryFromHash() {
  try {
    const hash = String(window.location.hash || '').replace(/^#/, '')
    const qi = hash.indexOf('?')
    if (qi < 0) return {}
    const sp = new URLSearchParams(hash.slice(qi + 1))
    const source = String(sp.get('source') || '').trim()
    const agent = String(sp.get('agent') || '').trim()
    const statusRaw = String(sp.get('status') || sp.get('group') || '').trim()
    const dateRaw = String(sp.get('date') || '').trim()
    const newRaw = String(sp.get('new') || '').trim().toLowerCase()
    const out = {}
    if (source === 'chat' || source === 'role' || source === 'workflow' || source === 'automation') out.source = source
    if (agent.startsWith('role:') || agent.startsWith('agent:')) out.agent = agent
    const statusKeys = new Set(STATUS_GROUPS.map((g) => g.key))
    const mapped = STATUS_QUERY_ALIASES[statusRaw] || statusRaw
    if (statusKeys.has(mapped)) {
      out.status = mapped
      out.statusQuery = statusRaw
    }
    if (dateRaw === 'today') {
      out.date = 'today'
      out.dateIso = todayIsoDate()
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      out.date = dateRaw
      out.dateIso = dateRaw
    }
    if (newRaw === '1' || newRaw === 'inbox' || newRaw === 'todo') out.openInboxCreate = true
    const tab = String(sp.get('tab') || '').trim().toLowerCase()
    if (tab === 'items' || tab === 'item' || tab === 'todos') out.ledger = 'items'
    if (tab === 'todo') out.todoTab = true
    return out
  } catch {
    return {}
  }
}

/** 将当前筛选写回 hash，支持前进/后退（同路径仅 query 变化也会 remount） */
function writeTasksQueryToHash(state) {
  try {
    const qs = new URLSearchParams()
    if (state.statusFilter && !state.todoTab) {
      let statusOut = state.statusFilter
      if (statusOut === 'executing') statusOut = 'running'
      else if (statusOut === 'failed') statusOut = 'exception'
      qs.set('status', statusOut)
    }
    if (state.dateFilter === 'today' || state.timeRange === 'today') {
      qs.set('date', 'today')
    } else if (state.dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(state.dateFilter)) {
      qs.set('date', state.dateFilter)
    }
    if (state.sourceFilter === 'chat' || state.sourceFilter === 'role' || state.sourceFilter === 'workflow' || state.sourceFilter === 'automation') {
      qs.set('source', state.sourceFilter)
    }
    if (state.agentFilter) qs.set('agent', state.agentFilter)
    if (state.ledger === 'items') qs.set('tab', 'items')
    if (state.todoTab) qs.set('tab', 'todo')
    const q = qs.toString()
    const next = q ? `/tasks?${q}` : '/tasks'
    const cur = String(window.location.hash || '').replace(/^#/, '')
    if (cur === next) return false
    if (cur.split('?')[0] !== '/tasks') return false
    window.location.hash = next
    return true
  } catch {
    return false
  }
}

function commitTaskFilters(page, state, { scrollList = false } = {}) {
  state.page = 1
  const navigated = writeTasksQueryToHash(state)
  if (navigated) return
  renderMainStatusTabs(page, state)
  renderSourceTabs(page, state)
  renderStatusCards(page, state)
  renderDimensionFilters(page, state)
  renderActiveFilterBar(page, state)
  renderTimeFilter(page, state)
  updatePageView(page, state)
  if (scrollList) {
    page.querySelector('.tasks-shell-body')?.scrollTo({ top: 0, behavior: 'smooth' })
    page.querySelector('#tasks-list-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function applyTasksQueryToState(state, query) {
  const hash = String(window.location.hash || '')
  const hasQuery = hash.includes('?')

  state.statusFilter = query.status || null
  state._statusQueryAlias = query.statusQuery || null
  state.sourceFilter = query.source || null

  if (query.agent) {
    state.agentFilter = query.agent
    state.forceAgentFilter = query.agent
  } else if (hasQuery) {
    state.agentFilter = null
    state.forceAgentFilter = null
  }

  if (query.date === 'today') {
    state.dateFilter = 'today'
    state.timeRange = 'today'
  } else if (query.dateIso) {
    state.dateFilter = query.dateIso
    state.timeRange = 'all'
  } else if (hasQuery) {
    state.dateFilter = null
  }
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page tasks-page'

  page.innerHTML = `
    <div class="tasks-shell-top">
      <div class="page-header tasks-page-header">
        <div class="tasks-title-block">
          <div class="tasks-title-row">
            <h1 class="page-title">${_l('任务中心', 'tasks.pageTitle')}</h1>
            <div class="tasks-ledger-toggle" role="tablist" aria-label="${_l('账本切换', 'tasks.pageLedgerSwitch')}">
              <button type="button" class="tasks-ledger-btn is-active" data-ledger="tasks" role="tab" aria-selected="true">${_l('协作任务', 'tasks.pageLedgerTasks')}</button>
              <button type="button" class="tasks-ledger-btn" data-ledger="items" role="tab" aria-selected="false">${_l('我的事项', 'tasks.pageLedgerItems')}</button>
            </div>
          </div>
          <p class="page-desc" id="tasks-page-desc" data-ledger-show="tasks">${_l('协作任务与员工工作项；日常备忘切到「我的事项」', 'tasks.pageDescTasks')}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-secondary" id="btn-batch-select" title="${_l('勾选任务后可批量删除 / 启动 / 暂停', 'tasks.pageBatchSelectTitle')}" data-ledger-show="tasks">${_l('批量删除', 'tasks.pageBatchDelete')}</button>
          <button class="btn btn-primary" id="btn-new-task" data-ledger-show="tasks">${_l('+ 协作任务', 'tasks.pageNewTask')}</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-new-item" data-ledger-show="items">${_l('+ 新建事项', 'tasks.pageNewItem')}</button>
        </div>
      </div>


      <div class="tasks-toolbar" data-ledger-show="tasks">
        <div class="tasks-status-tabs" id="tasks-status-tabs" role="tablist" aria-label="${_l('任务状态', 'tasks.pageTaskStatus')}"></div>
        <div class="tasks-toolbar-search">
          <label class="tasks-search-field">
            <span class="tasks-search-icon" aria-hidden="true"></span>
            <input class="form-input" id="tasks-search" placeholder="${_l('搜索任务 / 岗位 / 智能体', 'tasks.pageSearchPlaceholder')}" aria-label="${_l('搜索任务', 'tasks.pageSearchAria')}">
          </label>
          <button type="button" class="tasks-filter-btn" id="btn-tasks-filter" aria-expanded="false" aria-controls="tasks-more-filters" title="${_l('来源、时间与高级筛选', 'tasks.pageFilterTitle')}">
            <span class="tasks-filter-icon" aria-hidden="true"></span>
            ${_l('筛选', 'tasks.pageFilter')}
            <span class="tasks-filter-badge" id="tasks-filter-badge" hidden></span>
          </button>
        </div>
      </div>

      <div class="tasks-active-filters" id="tasks-active-filters" hidden data-ledger-show="tasks">
        <span class="tasks-active-filters__label">${_l('当前筛选：', 'tasks.pageActiveFilters')}</span>
        <span class="tasks-active-filters__chips" id="tasks-active-filters-chips"></span>
        <button type="button" class="tasks-filter-clear" id="btn-clear-active-filters">${_l('清除', 'tasks.pageClearFilters')}</button>
      </div>

      <div class="tasks-filter-bar tasks-filter-bar--compact" id="tasks-dim-filters" aria-label="${_l('来源筛选', 'tasks.pageSourceFilterAria')}" data-ledger-show="tasks">
        <label class="tasks-filter-field">
          <span class="tasks-time-filter-label">${_l('来源', 'tasks.pageSource')}</span>
          <select class="tasks-filter-select" id="tasks-type-select" aria-label="${_l('按任务来源筛选', 'tasks.pageSourceSelectAria')}">
            <option value="">${_l('全部', 'tasks.pageAll')}</option>
            <option value="chat">${_l('对话', 'tasks.srcFilterChat')}</option>
            <option value="role">${_l('智能体员工', 'tasks.srcFilterRole')}</option>
            <option value="workflow">${_l('工作流', 'tasks.srcFilterWorkflow')}</option>
            <option value="automation">${_l('自动化', 'tasks.srcFilterAutomation')}</option>
          </select>
        </label>
        <label class="tasks-filter-field tasks-filter-field--checkbox" title="${_l('默认隐藏员工心跳产生的【巡检】记录', 'tasks.pageShowPatrolTitle')}">
          <input type="checkbox" id="tasks-show-patrol" />
          <span class="tasks-time-filter-label">${_l('显示值班巡检', 'tasks.pageShowPatrol')}</span>
        </label>
      </div>

      <div class="tasks-more-filters" id="tasks-more-filters" hidden data-ledger-show="tasks">
        <div class="tasks-more-filters-body">
          <div class="tasks-filter-row">
            <label class="tasks-filter-field">
              <span class="tasks-time-filter-label">${_l('工作流', 'tasks.srcFilterWorkflow')}</span>
              <select class="tasks-filter-select" id="tasks-app-select" aria-label="${_l('按工作流筛选', 'tasks.pageAppSelectAria')}">
                <option value="">${_l('全部', 'tasks.pageAll')}</option>
              </select>
            </label>
            <label class="tasks-filter-field">
              <span class="tasks-time-filter-label">${_l('智能体', 'tasks.pageAgent')}</span>
              <select class="tasks-filter-select" id="tasks-agent-select" aria-label="${_l('按智能体或岗位筛选', 'tasks.pageAgentSelectAria')}">
                <option value="">${_l('全部', 'tasks.pageAll')}</option>
              </select>
            </label>
            <label class="tasks-filter-field" hidden>
              <span class="tasks-time-filter-label">${_l('状态', 'tasks.pageStatus')}</span>
              <select class="tasks-filter-select" id="tasks-status-select" aria-label="${_l('按状态筛选', 'tasks.pageStatusSelectAria')}">
                <option value="">${_l('全部', 'tasks.pageAll')}</option>
              </select>
            </label>
            <span class="tasks-time-filter-label">${_l('时间', 'tasks.pageTime')}</span>
            <div class="tasks-time-filter-segments" id="tasks-time-filter" role="tablist" aria-label="${_l('任务时间范围', 'tasks.pageTimeRangeAria')}"></div>
            <span class="tasks-time-filter-label">${_l('每页', 'tasks.pagePerPage')}</span>
            <select class="tasks-filter-select" id="tasks-page-size" aria-label="${_l('每页条数', 'tasks.pagePageSizeAria')}"></select>
            <button class="btn btn-warning btn-sm" id="btn-pause-all-running" title="${_l('暂停状态为「执行中」的任务', 'tasks.pagePauseRunningTitle')}" style="margin-left:auto">${_l('暂停执行中', 'tasks.pagePauseRunning')}</button>
            <button class="btn btn-secondary btn-sm" id="btn-pause-all-active" title="${_l('暂停全部可暂停的任务（待开始/规划中/已规划/执行中）', 'tasks.pagePauseActiveTitle')}">${_l('暂停可暂停', 'tasks.pagePauseActive')}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="tasks-shell-body" data-ledger-show="tasks">
      <section class="tasks-panel tasks-attention" id="tasks-attention" hidden>
        <header class="tasks-panel-head">${_l('需要你处理', 'tasks.pageAttention')}</header>
        <div class="tasks-panel-body" id="tasks-attention-list"></div>
        <footer class="tasks-panel-foot">
          <button type="button" class="tasks-panel-link" id="btn-attention-view-all">${_l('查看全部', 'tasks.pageViewAll')}</button>
          <button type="button" class="tasks-panel-refresh" id="btn-refresh" title="${_l('刷新', 'tasks.pageRefresh')}">
            <span class="tasks-refresh-icon" aria-hidden="true"></span>
            ${_l('刷新', 'tasks.pageRefresh')}
          </button>
        </footer>
      </section>

      <section class="tasks-panel tasks-upcoming" id="tasks-upcoming" hidden>
        <header class="tasks-panel-head">
          <span>${_l('即将运行的自动化', 'tasks.pageUpcoming')}</span>
          <span class="tasks-count" id="tasks-upcoming-count"></span>
        </header>
        <div class="tasks-panel-body" id="tasks-upcoming-list"></div>
        <footer class="tasks-panel-foot">
          <button type="button" class="tasks-panel-link" id="btn-upcoming-open-cron">${_l('打开自动化 ›', 'tasks.pageOpenCron')}</button>
        </footer>
      </section>

      <section class="tasks-panel tasks-all-panel" id="tasks-list-panel">
        <header class="tasks-panel-head">
          <span id="tasks-list-title">${_l('工作事项进度', 'tasks.pageListTitle')}</span>
          <span id="tasks-count" class="tasks-count"></span>
        </header>
        <div class="tasks-panel-body" id="tasks-list"></div>
        <footer class="tasks-panel-foot" id="tasks-all-foot">
          <div class="tasks-list-pager" id="tasks-list-pager" hidden></div>
          <button type="button" class="tasks-panel-link" id="btn-view-all-tasks" hidden>${_l('查看全部任务 ›', 'tasks.pageViewAllTasks')}</button>
          <button type="button" class="tasks-panel-refresh" id="btn-refresh-all" title="${_l('刷新', 'tasks.pageRefresh')}">
            <span class="tasks-refresh-icon" aria-hidden="true"></span>
            ${_l('刷新', 'tasks.pageRefresh')}
          </button>
        </footer>
      </section>

      <details class="tasks-status-panel" id="tasks-status-panel" hidden>
        <summary>${_l('按状态查看', 'tasks.pageByStatus')}</summary>
        <div class="tasks-monitor-actions">
          <span class="tasks-list-filter-label" id="tasks-list-filter-label"></span>
        </div>
        <div class="stat-cards" id="tasks-stat-cards"></div>
      </details>
    </div>

    <div class="tasks-items-host" id="tasks-items-host" data-ledger-show="items"></div>

    <div class="batch-toolbar" id="batch-toolbar" style="display:none">
      <span class="batch-count" id="batch-count">${_l('已选择 0 项', 'tasks.pageBatchCountZero')}</span>
      <div class="batch-actions">
        <button class="btn btn-sm btn-primary" id="btn-batch-start">${_l('批量启动', 'tasks.pageBatchStart')}</button>
        <button class="btn btn-sm btn-secondary" id="btn-batch-stop">${_l('批量暂停', 'tasks.pageBatchStop')}</button>
        <button class="btn btn-sm btn-danger" id="btn-batch-delete">${_l('批量删除', 'tasks.pageBatchDelete')}</button>
        <button class="btn btn-sm btn-ghost" id="btn-batch-cancel">${_l('取消选择', 'tasks.pageBatchCancel')}</button>
      </div>
    </div>

  `

  const state = {
    tasks: [],
    filter: '',
    batchMode: false,
    selectedTasks: new Set(),
    statusFilter: null, // 「按状态查看」折叠区 / 状态下拉（null=不筛选）
    sourceFilter: null, // 来源 Tab（null=全部）；chat/role/workflow
    appFilter: null, // source_app_id
    agentFilter: null, // assigned_to 或 assigned_role
    forceAgentFilter: null, // URL 强制岗位筛选，下拉暂无该项时也不清空
    approvals: [], // 待办审批（proactive approvals，获取失败则为空）
    agents: [],
    rolesByCode: {},
    timeRange: readStoredTimeRange(),
    dateFilter: null, // URL ?date=YYYY-MM-DD 精确到天
    page: 1,
    pageSize: readStoredPageSize(),
    unattendedMode: readStoredUnattendedMode(),
    showPatrol: readStoredShowPatrol(),
    attentionExpanded: false, // 「需要你处理」是否展开全部
    upcomingAutomations: [], // 启用中的自动化（下次预计运行）
    expandedTaskIds: new Set(), // 协作树：展开的父任务 id
    priorityFilter: null, // P0|P1|P2|P3
    _taskForest: null, // { byId, childrenByParent, roots } 当前时间窗内
    ledger: 'tasks', // tasks | items
    todoTab: false, // tab=todo 视图：只展示 pending/executing 未完成任务
    _itemsCtl: null,
  }
  const bootQuery = readTasksQueryFromHash()
  applyTasksQueryToState(state, bootQuery)
  if (bootQuery.ledger === 'items' || bootQuery.openInboxCreate) state.ledger = 'items'
  if (bootQuery.todoTab) {
    state.todoTab = true
    state.statusFilter = 'todo'
  }
  state.drawerTaskId = null
  renderTimeFilter(page, state)
  renderPageSize(page, state)
  renderMainStatusTabs(page, state)
  renderDimensionFilters(page, state)
  renderActiveFilterBar(page, state)
  void ensureDisplayMaps(state)
  void loadTasks(page, state)
  void loadApprovals(page, state)
  syncBatchSelectButtons(page, state)

  // 页面初始化时绑定一次事件委托
  attachTaskEvents(page, state)

  async function applyLedger(ledger, { openCreate = false, persistHash = true } = {}) {
    const next = ledger === 'items' ? 'items' : 'tasks'
    state.ledger = next
    page.classList.toggle('is-ledger-items', next === 'items')
    page.querySelectorAll('.tasks-ledger-btn').forEach((btn) => {
      const on = btn.getAttribute('data-ledger') === next
      btn.classList.toggle('is-active', on)
      btn.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    const desc = page.querySelector('#tasks-page-desc')
    if (desc && next === 'tasks') {
      desc.textContent = _l('协作任务与员工工作项；日常备忘切到「我的事项」', 'tasks.pageDescTasks')
    }
    if (next === 'items') {
      const host = page.querySelector('#tasks-items-host')
      let wantCreate = openCreate
      try {
        if (sessionStorage.getItem('evopanel_items_new') === '1') {
          sessionStorage.removeItem('evopanel_items_new')
          wantCreate = true
        }
      } catch (_) {
        /* ignore */
      }
      if (host && !state._itemsCtl) {
        const { mountItemsPanel } = await import('./items.js')
        state._itemsCtl = mountItemsPanel(host, {
          openCreate: wantCreate,
          onSwitchToTasks: () => void applyLedger('tasks'),
        })
      } else if (wantCreate) {
        state._itemsCtl?.openCreate?.()
      } else {
        void state._itemsCtl?.refresh?.()
      }
    }
    if (persistHash) writeTasksQueryToHash(state)
  }
  state.openItemsLedger = (opts = {}) => applyLedger('items', opts)

  page.querySelectorAll('.tasks-ledger-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      void applyLedger(btn.getAttribute('data-ledger') || 'tasks')
    })
  })
  page.querySelector('#btn-new-item')?.addEventListener('click', () => {
    if (state.ledger !== 'items') void applyLedger('items', { openCreate: true })
    else state._itemsCtl?.openCreate?.()
  })

  // 启动：旧 new=1 / tab=items → 我的事项
  if (state.ledger === 'items' || bootQuery.openInboxCreate) {
    void applyLedger('items', {
      openCreate: !!bootQuery.openInboxCreate,
      persistHash: true,
    })
  } else {
    void applyLedger('tasks', { persistHash: false })
  }

  // 状态分组卡片（隐藏面板，保留兼容）
  page.querySelector('#tasks-stat-cards')?.addEventListener('click', (e) => {
    const templateCard = e.target.closest('[data-template]')
    if (templateCard) {
      const tpl = _localizeTemplates().find(t => t.key === templateCard.dataset.template)
      if (tpl) showCreateTaskDialog(page, state, () => loadTasks(page, state), tpl)
      return
    }
    const card = e.target.closest('[data-status-group]')
    if (!card) return
    const group = card.dataset.statusGroup
    state.statusFilter = state.statusFilter === group ? null : group
    state._statusQueryAlias = null
    state.todoTab = false
    commitTaskFilters(page, state, { scrollList: true })
  })

  // 顶部主状态标签
  page.querySelector('#tasks-status-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-status-tab]')
    if (!tab) return
    const status = tab.dataset.statusTab || ''
    state.statusFilter = status || null
    state._statusQueryAlias = null
    state.todoTab = status === 'todo'
    if (!status) {
      // 切回「全部」时若仅因 KPI 带了今日，可保留 date；这里不自动清 date，交给清除按钮
    }
    commitTaskFilters(page, state)
  })

  page.querySelector('#btn-clear-active-filters')?.addEventListener('click', () => {
    state.statusFilter = null
    state._statusQueryAlias = null
    state.todoTab = false
    state.sourceFilter = null
    state.appFilter = null
    state.agentFilter = null
    state.forceAgentFilter = null
    state.priorityFilter = null
    state.dateFilter = null
    state.timeRange = 'all'
    state.filter = ''
    state.page = 1
    const search = page.querySelector('#tasks-search')
    if (search) search.value = ''
    try { localStorage.setItem(TASKS_TIME_RANGE_STORAGE_KEY, 'all') } catch (_) {}
    commitTaskFilters(page, state)
  })

  page.querySelector('#btn-pause-all-running').addEventListener('click', () => {
    void batchStopTasks(page, state, { scope: 'running', label: _l('执行中', 'tasks.pageScopeRunning') })
  })

  page.querySelector('#btn-pause-all-active').addEventListener('click', () => {
    void batchStopTasks(page, state, { scope: 'active', label: _l('全部可暂停', 'tasks.pageScopeActive') })
  })

  const toggleBatchMode = () => {
    state.batchMode = !state.batchMode
    if (!state.batchMode) state.selectedTasks.clear()
    syncBatchSelectButtons(page, state)
    renderTasks(page, state)
    renderAttention(page, state)
    updateBatchToolbar(page, state)
  }
  page.querySelector('#btn-batch-select')?.addEventListener('click', toggleBatchMode)

  page.querySelector('#btn-tasks-filter')?.addEventListener('click', () => {
    const panel = page.querySelector('#tasks-more-filters')
    const btn = page.querySelector('#btn-tasks-filter')
    if (!panel) return
    const next = panel.hasAttribute('hidden')
    if (next) panel.removeAttribute('hidden')
    else panel.setAttribute('hidden', '')
    btn?.setAttribute('aria-expanded', next ? 'true' : 'false')
    btn?.classList.toggle('is-active', next)
  })

  page.querySelector('#btn-attention-view-all')?.addEventListener('click', () => {
    state.attentionExpanded = !state.attentionExpanded
    renderAttention(page, state)
  })

  page.querySelector('#btn-view-all-tasks')?.addEventListener('click', () => {
    state.statusFilter = null
    state._statusQueryAlias = null
    state.todoTab = false
    state.sourceFilter = null
    state.appFilter = null
    state.agentFilter = null
    state.forceAgentFilter = null
    state.dateFilter = null
    state.filter = ''
    state.page = 1
    const search = page.querySelector('#tasks-search')
    if (search) search.value = ''
    commitTaskFilters(page, state, { scrollList: true })
  })

  page.querySelector('#btn-upcoming-open-cron')?.addEventListener('click', () => {
    window.location.hash = '#/automation'
  })

  page.querySelector('#tasks-status-select')?.addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim()
    state.statusFilter = v || null
    state._statusQueryAlias = null
    state.todoTab = v === 'todo'
    commitTaskFilters(page, state)
  })
  page.querySelector('#tasks-type-select')?.addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim()
    state.sourceFilter = v || null
    commitTaskFilters(page, state)
  })
  const showPatrolEl = page.querySelector('#tasks-show-patrol')
  if (showPatrolEl) {
    showPatrolEl.checked = !!state.showPatrol
    showPatrolEl.addEventListener('change', (e) => {
      state.showPatrol = !!e.target.checked
      try { localStorage.setItem(TASKS_SHOW_PATROL_STORAGE_KEY, state.showPatrol ? '1' : '0') } catch (_) {}
      void loadTasks(page, state)
    })
  }
  page.querySelector('#tasks-app-select')?.addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim()
    state.appFilter = v || null
    state.page = 1
    renderActiveFilterBar(page, state)
    renderDimensionFilters(page, state)
    updatePageView(page, state)
  })
  page.querySelector('#tasks-agent-select')?.addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim()
    state.agentFilter = v || null
    state.forceAgentFilter = v || null
    commitTaskFilters(page, state)
  })
  page.querySelector('#btn-clear-filters')?.addEventListener('click', () => {
    page.querySelector('#btn-clear-active-filters')?.click()
  })

  // 批量启动
  page.querySelector('#btn-batch-start').addEventListener('click', async () => {
    if (state.selectedTasks.size === 0) {
      toast(_l('请先选择任务', 'tasks.pageSelectTasksFirst'), 'warning')
      return
    }

    const yes = await showConfirm(_l('确定要启动选中的 {count} 个任务吗？', 'tasks.pageBatchStartConfirm', { count: state.selectedTasks.size }))
    if (!yes) return

    try {
      let successCount = 0
      let failCount = 0
      for (const taskId of state.selectedTasks) {
        const task = state.tasks.find(t => t.id === taskId)
        if (!task || !isTaskStartableStatus(task.status)) {
          failCount++
          continue
        }
        try {
          await api.startTaskPlanning(taskId)
          successCount++
        } catch (e) {
          failCount++
          console.error(`启动任务 ${taskId} 失败:`, e)
        }
      }
      if (failCount > 0) {
        toast(_l('已启动 {ok} 个，{fail} 个跳过或失败', 'tasks.pageBatchStartPartial', { ok: successCount, fail: failCount }), successCount > 0 ? 'warning' : 'error')
      } else {
        toast(_l('已成功启动 {ok} 个任务', 'tasks.pageBatchStartOk', { ok: successCount }), 'success')
      }
      state.selectedTasks.clear()
      state.batchMode = false
      syncBatchSelectButtons(page, state)
      await loadTasks(page, state)
    } catch (e) {
      toast(_l('批量启动失败：', 'tasks.pageBatchStartFailed') + e, 'error')
    }
  })

  // 批量暂停
  page.querySelector('#btn-batch-stop').addEventListener('click', async () => {
    if (state.selectedTasks.size === 0) {
      toast(_l('请先选择任务', 'tasks.pageSelectTasksFirst'), 'warning')
      return
    }
    await batchStopTasks(page, state, {
      taskIds: [...state.selectedTasks],
      label: _l('选中的 {count} 个', 'tasks.pageBatchStopScope', { count: state.selectedTasks.size }),
    })
  })

  // 批量删除
  page.querySelector('#btn-batch-delete').addEventListener('click', async () => {
    if (state.selectedTasks.size === 0) {
      toast(_l('请先选择任务', 'tasks.pageSelectTasksFirst'), 'warning')
      return
    }

    const count = state.selectedTasks.size

    const yes = await showConfirm(
      _l('确定要删除选中的 {count} 个任务吗？\n\n此操作将删除任务及其所有子任务，且不可恢复！', 'tasks.pageBatchDeleteConfirm', { count }),
    )
    if (!yes) return

    try {
      let successCount = 0
      let failCount = 0
      for (const taskId of state.selectedTasks) {
        try {
          await api.deleteTask(taskId)
          successCount++
        } catch (e) {
          failCount++
          console.error(`删除任务 ${taskId} 失败:`, e)
        }
      }
      if (failCount > 0) {
        toast(_l('已删除 {ok} 个，{fail} 个失败', 'tasks.pageBatchDeletePartial', { ok: successCount, fail: failCount }), successCount > 0 ? 'warning' : 'error')
      } else {
        toast(_l('已成功删除 {ok} 个任务', 'tasks.pageBatchDeleteOk', { ok: successCount }), 'success')
      }
      state.selectedTasks.clear()
      state.batchMode = false
      syncBatchSelectButtons(page, state)
      await loadTasks(page, state)
    } catch (e) {
      toast(_l('批量删除失败：', 'tasks.pageBatchDeleteFailed') + e, 'error')
    }
  })

  // 取消选择
  page.querySelector('#btn-batch-cancel').addEventListener('click', () => {
    state.selectedTasks.clear()
    state.batchMode = false
    syncBatchSelectButtons(page, state)
    renderTasks(page, state)
    updateBatchToolbar(page, state)
  })

  page.querySelector('#btn-new-task').addEventListener('click', () => {
    showCreateTaskDialog(page, state, () => loadTasks(page, state))
  })

  page.querySelector('#btn-refresh')?.addEventListener('click', async () => {
    invalidate('tasks_list')
    await loadTasks(page, state)
    toast(_l('已刷新', 'tasks.pageRefreshed'), 'success')
  })
  page.querySelector('#btn-refresh-all')?.addEventListener('click', async () => {
    invalidate('tasks_list')
    await loadTasks(page, state)
    toast(_l('已刷新', 'tasks.pageRefreshed'), 'success')
  })

  page.querySelector('#tasks-search').addEventListener('input', (e) => {
    state.filter = String(e.target.value || '').trim().toLowerCase()
    state.page = 1
    renderActiveFilterBar(page, state)
    renderDimensionFilters(page, state)
    renderTasks(page, state)
  })

  page.querySelector('#tasks-time-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-time-range]')
    if (!btn) return
    const next = String(btn.dataset.timeRange || 'all')
    if (next === state.timeRange && !(state.dateFilter && next !== 'today')) return
    state.timeRange = next
    state.page = 1
    if (next === 'today') state.dateFilter = 'today'
    else if (state.dateFilter === 'today') state.dateFilter = null
    else if (next !== 'all') state.dateFilter = null
    try { localStorage.setItem(TASKS_TIME_RANGE_STORAGE_KEY, next) } catch (_) {}
    commitTaskFilters(page, state)
  })

  page.querySelector('#tasks-page-size')?.addEventListener('change', (e) => {
    const next = Number(e.target.value || 20)
    if (next === state.pageSize) return
    state.pageSize = next
    state.page = 1
    try { localStorage.setItem(TASKS_PAGE_SIZE_STORAGE_KEY, String(next)) } catch (_) {}
    updatePageView(page, state)
  })

  page.querySelector('#tasks-list-pager')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]')
    if (!btn || btn.disabled) return
    const next = Number(btn.dataset.page || 0)
    if (!next || next === state.page) return
    state.page = next
    renderTasks(page, state)
    page.querySelector('#tasks-list-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  // 自动刷新：overview 与 list 视图都轮询；list 用 silent 避免闪烁/覆盖搜索输入
  // 45s（原 15s）：聊天同时开任务中心时减轻 Gateway 压力；列表仍可手动刷新
  const overviewRefreshTimer = setInterval(() => {
    void loadTasks(page, state, { silent: true })
  }, 45000)

  const prevCleanup = page._tasksCleanup
  page._tasksCleanup = () => {
    clearInterval(overviewRefreshTimer)
    try {
      page._xmLiveUnsub?.()
    } catch {
      /* ignore */
    }
    if (page._liveProcess) {
      try {
        page._liveProcess.destroy()
      } catch {
        /* ignore */
      }
      page._liveProcess = null
    }
    if (typeof prevCleanup === 'function') prevCleanup()
  }

  void import('../lib/page-live-refresh.js').then(({ subscribePageLiveRefresh }) => {
    page._xmLiveUnsub = subscribePageLiveRefresh(
      () => {
        if (state.ledger === 'items') {
          void state._itemsCtl?.refresh?.()
        } else {
          void loadTasks(page, state, { silent: true })
        }
      },
      { domains: ['tasks', 'items'] },
    )
  })

  return page
}

export function cleanup() {
  const page = document.querySelector('.page')
  if (page?._tasksCleanup) {
    try { page._tasksCleanup() } catch (_) {}
  }
}

function readStoredTimeRange() {
  try {
    const stored = localStorage.getItem(TASKS_TIME_RANGE_STORAGE_KEY)
    if (stored && TIME_RANGE_OPTIONS.some(o => o.key === stored)) return stored
  } catch (_) {}
  return 'all'
}

function readStoredPageSize() {
  try {
    const stored = localStorage.getItem(TASKS_PAGE_SIZE_STORAGE_KEY)
    if (stored && PAGE_SIZE_OPTIONS.some(o => o.key === stored)) return Number(stored)
    // migrate legacy limit key
    const legacy = localStorage.getItem('evopanel_tasks_limit')
    if (legacy && PAGE_SIZE_OPTIONS.some(o => o.key === legacy)) return Number(legacy)
  } catch (_) {}
  return 10
}

function readStoredUnattendedMode() {
  try {
    return localStorage.getItem(TASKS_UNATTENDED_STORAGE_KEY) === '1'
  } catch (_) {}
  return false
}

function readStoredShowPatrol() {
  try {
    return localStorage.getItem(TASKS_SHOW_PATROL_STORAGE_KEY) === '1'
  } catch (_) {}
  return false
}

/** 加载智能体 / 岗位名册，供表格解析显示名 */
async function ensureDisplayMaps(state) {
  if (state._mapsLoaded) return
  try {
    const { takeNavWarm } = await import('../lib/nav-panel-prefetch.js')
    const warmAgents = takeNavWarm('tasks:agents')
    const warmRoles = takeNavWarm('tasks:roles')
    const [agents, rolesRes] = await Promise.all([
      warmAgents || api.listAgents().catch(() => []),
      warmRoles || api.proactiveListRoles().catch(() => ({})),
    ])
    state.agents = Array.isArray(agents) ? agents : []
    const roles = Array.isArray(rolesRes?.roles) ? rolesRes.roles : (Array.isArray(rolesRes) ? rolesRes : [])
    const map = {}
    for (const r of roles) {
      const code = String(r?.agent_code || '').trim().toLowerCase()
      if (code) map[code] = r
    }
    state.rolesByCode = map
    state._mapsLoaded = true
  } catch (_) {
    state.agents = state.agents || []
    state.rolesByCode = state.rolesByCode || {}
  }
}

function parseTaskTimestamp(task) {
  const raw = task?.updated_at || task?.updatedAt || task?.created_at || task?.createdAt
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseStartedTimestamp(task) {
  const raw = task?.started_at || task?.startedAt || task?.created_at || task?.createdAt
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseCreatedTimestamp(task) {
  const raw = task?.created_at || task?.createdAt
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 绝对时间：MM-DD HH:mm（同年）或 YYYY-MM-DD HH:mm */
function formatAbsoluteClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const nowY = new Date().getFullYear()
  return y === nowY ? `${m}-${d} ${hh}:${mm}` : `${y}-${m}-${d} ${hh}:${mm}`
}

/** 相对时间：基于 updated_at/created_at 输出"x 分钟前" */
function formatRelativeTime(task) {
  const ts = parseTaskTimestamp(task)
  if (!ts) return ''
  const diff = Date.now() - ts.getTime()
  if (diff < 0) return _l('刚刚', 'tasks.relJustNow')
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return _l('刚刚', 'tasks.relJustNow')
  const min = Math.floor(sec / 60)
  if (min < 60) return _l('{n} 分钟前', 'tasks.relMinutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return _l('{n} 小时前', 'tasks.relHoursAgo', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 30) return _l('{n} 天前', 'tasks.relDaysAgo', { n: day })
  const mon = Math.floor(day / 30)
  if (mon < 12) return _l('{n} 个月前', 'tasks.relMonthsAgo', { n: mon })
  return _l('{n} 年前', 'tasks.relYearsAgo', { n: Math.floor(mon / 12) })
}

/** 表格时间列：优先更新时间 */
function formatTaskTimeCell(task) {
  const updated = parseTimeFlexible(task?.updated_at || task?.updatedAt)
    || parseStartedTimestamp(task)
    || parseTaskTimestamp(task)
  const abs = formatAbsoluteClock(updated)
  const rel = updated
    ? (() => {
      const diff = Date.now() - updated.getTime()
      if (diff < 0) return _l('刚刚', 'tasks.relJustNow')
      const sec = Math.floor(diff / 1000)
      if (sec < 60) return _l('刚刚', 'tasks.relJustNow')
      const min = Math.floor(sec / 60)
      if (min < 60) return _l('{n} 分钟前', 'tasks.relMinutesAgo', { n: min })
      const hr = Math.floor(min / 60)
      if (hr < 24) return _l('{n} 小时前', 'tasks.relHoursAgo', { n: hr })
      const day = Math.floor(hr / 24)
      if (day < 30) return _l('{n} 天前', 'tasks.relDaysAgo', { n: day })
      return ''
    })()
    : formatRelativeTime(task)
  if (!abs && !rel) return '<span class="tl-empty">—</span>'
  const label = abs || rel
  const tip = [abs, rel].filter(Boolean).join(' · ')
  return `<span class="tl-time" title="${escapeHtml(tip)}">${escapeHtml(label)}</span>`
}

function parseTimeFlexible(raw) {
  if (raw == null || raw === '') return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 当前进展：自然语言步骤 / 阻塞原因；状态文案与执行进度分离 */
function progressNarrativeText(t) {
  const u = toUnifiedTaskStatus(t.status)
  const { executingNames, failedNames, subtaskCount, completedCount, progress, showPercent } = progressMeta(t)
  const err = getErrorFirstLine(t)
  const listSep = getLang() === 'en' ? ', ' : '、'
  if (u === 'failed') {
    return err || (failedNames[0]
      ? _l('失败于：{name}', 'tasks.progFailedAt', { name: failedNames[0] })
      : _l('执行异常，需查看原因', 'tasks.progFailedGeneric'))
  }
  if (u === 'waiting_confirmation') return _l('等待你确认结果', 'tasks.progWaitConfirm')
  if (normalizeTaskStatusKey(t.status) === 'blocked') return err || _l('任务已阻塞', 'tasks.progBlocked')
  if (u === 'planning') {
    if (executingNames.length) return _l('规划中：{name}', 'tasks.progPlanningStep', { name: executingNames[0] })
    return _l('规划中', 'tasks.statusPlanning')
  }
  if (u === 'queued') return _l('规划已完成，等待执行', 'tasks.execQueuedHint')
  if (u === 'running') {
    const step = String(t.current_step || t.currentStep || t.progress_summary || '').trim()
    if (step) return step
    if (executingNames.length === 1) return _l('正在执行：{name}', 'tasks.progRunningStep', { name: executingNames[0] })
    if (executingNames.length > 1) {
      return _l('并行推进：{names}{more}', 'tasks.progRunningParallel', {
        names: executingNames.slice(0, 2).join(listSep),
        more: executingNames.length > 2 ? '…' : '',
      })
    }
    if (subtaskCount > 0 && showPercent) return _l('执行中 {done}/{total}', 'tasks.progRunningRatio', { done: completedCount, total: subtaskCount })
    return taskSecondaryLine(t) || _l('正在推进', 'tasks.progRunningGeneric')
  }
  if (u === 'pending') {
    return formatUnifiedStatusZh(t.status)
  }
  if (u === 'completed') {
    const summary = taskSummaryPreview(t, 48)
    return summary || (subtaskCount > 0
      ? _l('已完成 {done}/{total} 步', 'tasks.progDoneRatio', { done: completedCount, total: subtaskCount })
      : _l('已完成', 'tasks.statusCompleted'))
  }
  if (u === 'cancelled') {
    if (showPercent && progress != null) return _l('已取消 · 进度 {pct}%', 'tasks.progCancelledPct', { pct: progress })
    return _l('已取消', 'tasks.statusCancelled')
  }
  return taskSecondaryLine(t) || formatUnifiedStatusZh(t.status) || ''
}

function renderProgressNarrative(t) {
  const text = progressNarrativeText(t)
  if (!text) return '<span class="tl-empty">—</span>'
  return `<span class="tl-progress-nl" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`
}

function renderProgBlock(t) {
  return renderProgressNarrative(t)
}

/** 岗位：优先 assigned_role，否则用 assigned_to 反查员工名册 */
function resolveTaskRoleLabel(task, state) {
  const role = String(task?.assigned_role || '').trim()
  if (role) return role
  const code = String(task?.assigned_to || '').trim().toLowerCase()
  if (code) {
    const r = state?.rolesByCode?.[code]
    const name = String(r?.role_name || '').trim()
    if (name) return name
  }
  return ''
}

/** 智能体：主任务 assigned_to + 子任务去重；显示 agent_name */
function resolveTaskAgentLabel(task, state) {
  const agents = state?.agents || []
  const codes = []
  const seen = new Set()
  const push = (raw) => {
    const c = String(raw || '').trim()
    if (!c) return
    const key = c.toLowerCase().replace(/_/g, '-')
    if (seen.has(key)) return
    seen.add(key)
    codes.push(c)
  }
  push(task?.assigned_to)
  for (const s of task?.subtasks || []) push(s?.assigned_to)
  if (!codes.length) return ''
  const names = codes.map((c) => resolveAssignedAgentDisplayName(c, agents) || c)
  const sep = getLang() === 'en' ? ', ' : '、'
  if (names.length <= 2) return names.join(sep)
  return _l(`${names.slice(0, 2).join('、')} 等${names.length}人`, 'tasks.agentAndMore', { names: names.slice(0, 2).join(sep), n: names.length })
}

function progressMeta(task) {
  const list = Array.isArray(task?.subtasks) ? task.subtasks : []
  const exec = computeTaskExecutionProgress(task, list)
  const executingNames = []
  const failedNames = []
  let executingCount = 0
  for (const s of list) {
    const su = toUnifiedTaskStatus(s?.status)
    const name = String(s?.name || '').trim() || _l('节点', 'tasks.nodeFallback')
    if (su === 'running' || su === 'planning') {
      executingCount += 1
      executingNames.push(name)
    } else if (su === 'failed') {
      failedNames.push(name)
    }
  }
  return {
    subtaskCount: exec.subtaskCount,
    completedCount: exec.completedCount,
    progress: exec.progress,
    showPercent: exec.showPercent,
    progressLabel: exec.label,
    unified: exec.unified,
    executingCount,
    executingNames,
    failedNames,
  }
}

/** 耗时：进行中显示"已运行 x"，已结束显示"耗时 x" */
function formatDuration(task) {
  const startRaw = task?.started_at || task?.startedAt
  if (!startRaw) return ''
  const start = new Date(startRaw)
  if (Number.isNaN(start.getTime())) return ''
  const endRaw = task?.completed_at || task?.completedAt
  const end = endRaw ? new Date(endRaw) : new Date()
  if (Number.isNaN(end.getTime())) return ''
  let diff = Math.max(0, end.getTime() - start.getTime())
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return _l(`${sec}秒`, 'tasks.fmtDurSec', { n: sec })
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return remSec ? _l(`${min}分${remSec}秒`, 'tasks.fmtDurMinSec', { m: min, s: remSec }) : _l(`${min}分`, 'tasks.fmtDurMin', { m: min })
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  if (hr < 24) return remMin ? _l(`${hr}时${remMin}分`, 'tasks.fmtDurHrMin', { h: hr, m: remMin }) : _l(`${hr}时`, 'tasks.fmtDurHr', { h: hr })
  const day = Math.floor(hr / 24)
  const remHr = hr % 24
  return remHr ? _l(`${day}天${remHr}时`, 'tasks.fmtDurDayHr', { d: day, h: remHr }) : _l(`${day}天`, 'tasks.fmtDurDay', { d: day })
}

/** 失败原因首行：截断 error 字段第一行 */
function getErrorFirstLine(task) {
  const err = String(task?.error || task?.error_text || '').trim()
  if (!err) return ''
  const firstLine = err.split(/\r?\n/)[0].trim()
  if (!firstLine) return ''
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine
}

function filterTasksByTimeRange(tasks, timeRange) {
  // 时间窗口过滤；执行中任务（executing 分组）豁免，始终保留
  const key = timeRange || 'all'
  const list = Array.isArray(tasks) ? tasks : []
  if (key === 'all') return list

  const now = Date.now()
  let cutoff = 0
  if (key === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    cutoff = start.getTime()
  } else if (key === 'week') {
    cutoff = now - 7 * 24 * 60 * 60 * 1000
  } else if (key === 'month') {
    cutoff = now - 30 * 24 * 60 * 60 * 1000
  } else {
    return list
  }

  return list.filter(t => {
    // 执行中任务豁免时间筛选，任何时间范围下都可见
    if (toTaskStatusGroup(t.status) === 'executing') return true
    const ts = parseTaskTimestamp(t)?.getTime()
    return ts != null && ts >= cutoff
  })
}

function getVisibleTasks(state) {
  // 时间范围内的全量任务（今日条 / 状态卡 / 需处理用）；列表分页在 getPagedSourceTasks
  let list = filterTasksByTimeRange(state.tasks, state.timeRange)
  const day = String(state.dateFilter || '').trim()
  if (day === 'today') {
    const iso = todayIsoDate()
    const start = new Date(`${iso}T00:00:00`).getTime()
    const end = start + 86400000
    list = list.filter((t) => {
      if (toTaskStatusGroup(t.status) === 'executing') return true
      const ts = parseTaskTimestamp(t)?.getTime()
      return ts != null && ts >= start && ts < end
    })
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const start = new Date(`${day}T00:00:00`).getTime()
    const end = start + 86400000
    list = list.filter((t) => {
      if (toTaskStatusGroup(t.status) === 'executing') return true
      const ts = parseTaskTimestamp(t)?.getTime()
      return ts != null && ts >= start && ts < end
    })
  }
  return list
}

/** 时间窗内的协作根单（状态卡 / 今日条计数用，避免下游叶子冲高「已完成」） */
function getVisibleRootTasks(state) {
  return rootTasksOnly(getVisibleTasks(state))
}

function getPageSize(state) {
  const n = Number(state.pageSize) || 10
  return PAGE_SIZE_OPTIONS.some(o => Number(o.key) === n) ? n : 10
}

function taskMatchesAgentFilter(t, filter) {
  const f = String(filter || '')
  if (f.startsWith('role:')) {
    return String(t.assigned_role || '').trim() === f.slice(5)
  }
  if (f.startsWith('agent:')) {
    return String(t.assigned_to || '').trim() === f.slice(6)
  }
  return false
}

function taskMatchesTextQuery(t, q, state) {
  const role = resolveTaskRoleLabel(t, state)
  const agent = resolveTaskAgentLabel(t, state)
  const app = taskAppLabel(t)
  const text = [
    t.name, t.description, t.status, t.source, t.assigned_to, t.assigned_role,
    role, agent, app, t.summary, t.result,
    t.automation_id, t.automationId, t.automation_name, t.automationName,
  ]
    .map(v => String(v || '').toLowerCase())
    .join(' ')
  return text.includes(q)
}

/**
 * 列表用根单（已筛选）；侧写 forest + 搜索命中下游时的自动展开 id。
 * @returns {{ roots: object[], forest: object, autoExpandIds: string[] }}
 */
function getSourceRootSelection(state) {
  const visible = getVisibleTasks(state)
  const selected = selectRootTasks(visible, {
    sourceFilter: state.sourceFilter,
    statusFilter: state.statusFilter,
    appFilter: state.appFilter,
    agentFilter: state.agentFilter,
    textQuery: state.filter,
    sourceKey: resolveSourceFilterKey,
    taskAppId,
    taskMatchesAgent: taskMatchesAgentFilter,
    taskMatchesText: (t, q) => taskMatchesTextQuery(t, q, state),
  })
  // 优先级筛选（进度表汇总条）
  if (state.priorityFilter) {
    selected.roots = selected.roots.filter((t) => normalizeTaskPriority(t) === state.priorityFilter)
  }
  state._taskForest = selected.forest
  return selected
}

/** @deprecated 兼容旧名：返回筛选后的根单列表 */
function getSourceTasks(state) {
  return getSourceRootSelection(state).roots
}

function getPagedSourceTasks(state) {
  const { roots, autoExpandIds } = getSourceRootSelection(state)
  for (const id of autoExpandIds) {
    if (id) state.expandedTaskIds.add(id)
  }
  const pageSize = getPageSize(state)
  const total = roots.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1)
  const pageNo = Math.max(1, Math.min(Number(state.page) || 1, pageCount))
  if (pageNo !== state.page) state.page = pageNo
  const start = (pageNo - 1) * pageSize
  return {
    list: roots.slice(start, start + pageSize),
    total,
    page: pageNo,
    pageSize,
    pageCount,
    forest: state._taskForest || buildTaskForest(getVisibleTasks(state)),
  }
}

function getTimeRangeLabel(timeRange) {
  return _optionLabel(TIME_RANGE_OPTIONS, 'timeRange', timeRange, _l('全部', 'tasks.pageAll'))
}

function renderTimeFilter(page, state) {
  const el = page.querySelector('#tasks-time-filter')
  if (!el) return
  el.innerHTML = _localizeOptions(TIME_RANGE_OPTIONS, 'timeRange').map(opt => `
    <button
      type="button"
      class="tasks-time-filter-btn${state.timeRange === opt.key ? ' is-active' : ''}"
      data-time-range="${opt.key}"
      role="tab"
      aria-selected="${state.timeRange === opt.key ? 'true' : 'false'}"
    >${opt.label}</button>
  `).join('')
}

function renderPageSize(page, state) {
  const el = page.querySelector('#tasks-page-size')
  if (!el) return
  const cur = String(getPageSize(state))
  el.innerHTML = _localizeOptions(PAGE_SIZE_OPTIONS, 'pageSize').map(opt =>
    `<option value="${opt.key}"${opt.key === cur ? ' selected' : ''}>${opt.label}</option>`
  ).join('')
}

function renderListPager(page, state, meta) {
  const pagerEl = page.querySelector('#tasks-list-pager')
  if (!pagerEl) return
  const total = Number(meta?.total) || 0
  const pageNo = Number(meta?.page) || 1
  const pageSize = Number(meta?.pageSize) || getPageSize(state)
  const pageCount = Number(meta?.pageCount) || 1
  if (total <= 0) {
    pagerEl.hidden = true
    pagerEl.innerHTML = ''
    return
  }
  const from = (pageNo - 1) * pageSize + 1
  const to = Math.min(total, (pageNo - 1) * pageSize + (meta?.list?.length || 0))
  const prevDisabled = pageNo <= 1
  const nextDisabled = pageNo >= pageCount
  pagerEl.hidden = false
  pagerEl.innerHTML = `
    <div class="tasks-list-pager-meta">${_l(`共 ${total} 条根单 · 第 ${from}–${to} 条`, 'tasks.pagerMeta', { total, from, to })}</div>
    <div class="tasks-list-pager-actions">
      <button type="button" class="btn btn-sm btn-secondary" data-page="${pageNo - 1}" ${prevDisabled ? 'disabled' : ''}>${_l('上一页', 'tasks.pagerPrev')}</button>
      <span class="tasks-list-pager-page">${pageNo} / ${pageCount}</span>
      <button type="button" class="btn btn-sm btn-secondary" data-page="${pageNo + 1}" ${nextDisabled ? 'disabled' : ''}>${_l('下一页', 'tasks.pagerNext')}</button>
    </div>`
}

function countTasksInGroup(tasks, group) {
  // 走分组映射层，兼容后端写入的 CollabPhase 中间态（verifying/reflecting 等）
  return tasks.filter(t => toTaskStatusGroup(t.status) === group.key).length
}

function getStatusFilterLabel(statusFilter, timeRange) {
  const allZh = _l('全部任务', 'tasks.statusFilterAll')
  const statusPart = !statusFilter
    ? allZh
    : (_optionLabel(MAIN_STATUS_TABS, 'mainTab', statusFilter, '', 'status')
      || _optionLabel(STATUS_GROUPS, 'statusGroup', statusFilter, '')
      || allZh)
  if (!timeRange || timeRange === 'all') return statusPart
  return `${statusPart} · ${getTimeRangeLabel(timeRange)}`
}

/** 视图分发：单页驾驶舱，统一驱动四个区域的重渲染 */
function updatePageView(page, state) {
  renderMainStatusTabs(page, state)
  renderActiveFilterBar(page, state)
  renderTodayStrip(page, state)
  renderAttention(page, state)
  renderStatusCards(page, state)
  renderDimensionFilters(page, state)
  renderTasks(page, state)
  updateBatchToolbar(page, state)
  updateMonitorActionButtons(page, state)
  // 列表刷新后不自动拉开侧栏
  if (state.drawerTaskId) closeTaskDrawer(page, state)
}

const ATTENTION_PREVIEW_LIMIT = 3

/** 今日摘要用根单：不受列表状态/来源筛选影响，避免与顶部提示冲突 */
function getTodayAttentionRoots(state) {
  const scoped = {
    tasks: state.tasks || [],
    timeRange: 'today',
    dateFilter: 'today',
  }
  return rootTasksOnly(getVisibleTasks(scoped))
}

/** 今日摘要条：左侧一句话 + 右侧状态 chip（可点击下钻） */
const PRIORITY_META = {
  P0: { label: 'P0 重要且紧急', short: 'P0', tone: 'p0' },
  P1: { label: 'P1 重要不紧急', short: 'P1', tone: 'p1' },
  P2: { label: 'P2 紧急不重要', short: 'P2', tone: 'p2' },
  P3: { label: 'P3 不重要不紧急', short: 'P3', tone: 'p3' },
}

function normalizeTaskPriority(task) {
  const raw = String(task?.priority || task?.priority_level || '').trim().toUpperCase()
  if (raw === 'P0' || raw === 'P1' || raw === 'P2' || raw === 'P3') return raw
  // 兼容旧 risk_level
  const risk = String(task?.risk_level || '').trim().toLowerCase()
  if (risk === 'critical' || risk === 'high') return 'P0'
  if (risk === 'medium') return 'P1'
  if (risk === 'low') return 'P3'
  return ''
}

function parseDueDate(task) {
  const raw = task?.due_at || task?.dueAt || task?.due_date || task?.deadline || ''
  if (!raw) return null
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T23:59:59`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDueDateCell(task) {
  const d = parseDueDate(task)
  if (!d) return { text: '—', dueSoon: false, overdue: false }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const text = `${y}/${Number(m)}/${Number(day)}`
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endSoon = new Date(startToday.getTime() + 3 * 24 * 60 * 60 * 1000)
  const overdue = d < startToday && toUnifiedTaskStatus(task.status) !== 'completed'
  const dueSoon = !overdue && d <= endSoon && toUnifiedTaskStatus(task.status) !== 'completed'
  return { text, dueSoon, overdue }
}

function formatRegisterDate(task) {
  const raw = task?.created_at || task?.createdAt
  if (!raw) return { date: '—', time: '' }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' }
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  }
}

function renderRegisterDateCell(task) {
  const { date, time } = formatRegisterDate(task)
  if (!time) return escapeHtml(date)
  return `<span class="tl-reg-stack"><span class="tl-reg-date">${escapeHtml(date)}</span><span class="tl-reg-time">${escapeHtml(time)}</span></span>`
}

function ledgerCompletionStatus(task) {
  const u = toUnifiedTaskStatus(task?.status)
  if (u === 'completed') return { key: 'done', label: _l('已完成', 'tasks.statusCompleted'), tone: 'done' }
  if (u === 'cancelled') return { key: 'cancelled', label: _l('已取消', 'tasks.statusCancelled'), tone: 'muted' }
  if (u === 'failed') return { key: 'failed', label: _l('异常', 'tasks.statusFailed'), tone: 'failed' }
  if (u === 'running' || u === 'planning' || u === 'queued' || u === 'waiting_confirmation') {
    return { key: 'ongoing', label: _l('持续中', 'tasks.ledgerOngoing'), tone: 'ongoing' }
  }
  if (u === 'inbox') return { key: 'inbox', label: _l('待登记推进', 'tasks.ledgerInbox'), tone: 'inbox' }
  return { key: 'open', label: _l('未完成', 'tasks.ledgerOpen'), tone: 'open' }
}

function taskProgressPercent(task) {
  const info = computeTaskExecutionProgress(task, task?.subtasks)
  if (info?.progress != null && Number.isFinite(info.progress)) return Math.max(0, Math.min(100, info.progress))
  const raw = Number(task?.progress)
  if (Number.isFinite(raw)) return Math.max(0, Math.min(100, Math.round(raw)))
  if (toUnifiedTaskStatus(task?.status) === 'completed') return 100
  return 0
}

/** 与工作流节点相同的进度条：执行中走黄→紫冲击波扫描 */
function renderProgressBar(task, { compact = false } = {}) {
  const pct = taskProgressPercent(task)
  const u = toUnifiedTaskStatus(task?.status)
  const buffering = u === 'running' && pct < 100
  const mods = [
    compact ? 'tl-progbar--card' : '',
    buffering ? 'is-live' : '',
    u === 'completed' ? 'is-done' : '',
    u === 'failed' ? 'is-failed' : '',
    u === 'cancelled' ? 'is-muted' : '',
  ].filter(Boolean).join(' ')
  return `<div class="tl-progbar ${mods}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${_l(`进度 ${pct}%`, 'tasks.progressAria', { pct })}">
    <span class="tl-progbar__track"><span class="tl-progbar__fill${buffering ? ' is-buffering' : ''}" style="width:${pct}%"></span></span>
    <span class="tl-progbar__pct">${pct}%</span>
  </div>`
}

function renderProgressText(task) {
  return renderProgressBar(task)
}

function renderPriorityBadge(task) {
  const p = normalizeTaskPriority(task)
  if (!p) return '<span class="tl-empty">—</span>'
  const meta = PRIORITY_META[p]
  const label = _l(meta.label, `tasks.priority${p}`)
  return `<span class="tl-priority tl-priority--${meta.tone}" title="${escapeHtml(label)}">${meta.short}</span>`
}

/** 顶部 KPI 汇总条已移除（UI 待重设计）；保留空实现避免旧调用报错 */
function renderTodayStrip(_page, _state) {}

function getAttentionItems(state) {
  // 只收「还等你动作」的项：转交待审批。失败已是终态，走状态筛选即可。
  const approvalItems = normalizeApprovals(state.approvals)
  return {
    approvals: approvalItems,
    tasks: [],
    total: approvalItems.length,
  }
}

/** 需要你处理：精简四列（状态/岗位/智能体/进度），默认预览 3 条 */
function renderAttention(page, state) {
  const wrap = page.querySelector('#tasks-attention')
  const listEl = page.querySelector('#tasks-attention-list')
  const viewAllBtn = page.querySelector('#btn-attention-view-all')
  if (!wrap || !listEl) return

  const { approvals, tasks, total } = getAttentionItems(state)
  if (!total) {
    wrap.hidden = true
    return
  }
  wrap.hidden = false

  const combined = [
    ...approvals.map((a) => ({ kind: 'approval', item: a })),
    ...tasks.map((t) => ({ kind: 'task', item: t })),
  ]
  const shown = state.attentionExpanded ? combined : combined.slice(0, ATTENTION_PREVIEW_LIMIT)
  const rows = shown.map((x) => (x.kind === 'approval'
    ? renderAttentionApprovalRow(x.item, state)
    : renderAttentionTaskRow(x.item, state))).join('')
  const cards = shown.map((x) => (x.kind === 'approval'
    ? renderApprovalCard(x.item, state)
    : renderTaskCard(x.item, state))).join('')

  listEl.innerHTML = renderDualList(rows, cards, state, { mode: 'attention' })

  if (viewAllBtn) {
    viewAllBtn.textContent = state.attentionExpanded
      ? _l('收起', 'tasks.attentionCollapse')
      : _l(`查看全部 (${total})`, 'tasks.attentionViewAll', { n: total })
    viewAllBtn.hidden = total <= ATTENTION_PREVIEW_LIMIT && !state.attentionExpanded
  }
}

function parseAutomationNextRun(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatUpcomingNextRun(raw) {
  const d = parseAutomationNextRun(raw)
  if (!d) return '—'
  return formatAbsoluteClock(d) || '—'
}

function automationExecKindLabel(a) {
  return String(a?.app_id || a?.appId || '').trim()
    ? _l('工作流', 'tasks.autoKindWorkflow')
    : _l('提示词', 'tasks.autoKindPrompt')
}

async function loadUpcomingAutomations(page, state) {
  try {
    const res = await api.automationList()
    const list = Array.isArray(res?.automations) ? res.automations : []
    const upcoming = list
      .filter((a) => {
        const st = String(a?.status || '').trim().toLowerCase()
        return st === 'active' || st === 'enabled' || st === ''
      })
      .map((a) => ({
        ...a,
        _nextTs: parseAutomationNextRun(a.next_run_at || a.nextRunAt)?.getTime() || Number.POSITIVE_INFINITY,
      }))
      .filter((a) => Number.isFinite(a._nextTs))
      .sort((a, b) => a._nextTs - b._nextTs)
      .slice(0, 8)
    state.upcomingAutomations = upcoming
  } catch (_) {
    state.upcomingAutomations = []
  }
  renderUpcomingAutomations(page, state)
}

function renderUpcomingAutomations(page, state) {
  const wrap = page.querySelector('#tasks-upcoming')
  const listEl = page.querySelector('#tasks-upcoming-list')
  const countEl = page.querySelector('#tasks-upcoming-count')
  if (!wrap || !listEl) return
  const rows = Array.isArray(state.upcomingAutomations) ? state.upcomingAutomations : []
  if (!rows.length) {
    wrap.hidden = true
    listEl.innerHTML = ''
    if (countEl) countEl.textContent = ''
    return
  }
  wrap.hidden = false
  if (countEl) countEl.textContent = _l(`${rows.length} 条`, 'tasks.upcomingCount', { n: rows.length })
  listEl.innerHTML = `
    <div class="tl-table-scroll">
      <table class="tl-table tl-table--upcoming">
        <thead>
          <tr>
            <th class="tl-col-time">${_l('预计下次', 'tasks.colNextRun')}</th>
            <th class="tl-col-type">${_l('类型', 'tasks.colType')}</th>
            <th class="tl-col-name">${_l('自动化', 'tasks.colAutomation')}</th>
            <th class="tl-col-exec">${_l('执行内容', 'tasks.colExecContent')}</th>
            <th class="tl-col-ops">${_l('操作', 'tasks.colOps')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((a) => {
            const id = String(a.id || '').trim()
            const name = String(a.name || id || _l('未命名', 'tasks.unnamed')).trim()
            const isWf = Boolean(String(a?.app_id || a?.appId || '').trim())
            const kind = automationExecKindLabel(a)
            const target = String(a.app_name || a.appName || a.app_id || a.appId || _l('提示词任务', 'tasks.promptTask')).trim()
            const sched = String(a.schedule_summary || a.scheduleSummary || a.schedule || '').trim()
            return `<tr class="tl-row">
              <td class="tl-col-time">${escapeHtml(formatUpcomingNextRun(a.next_run_at || a.nextRunAt))}</td>
              <td class="tl-col-type"><span class="tl-type tl-type--${isWf ? 'workflow' : 'prompt'}">${escapeHtml(kind)}</span></td>
              <td class="tl-col-name">
                <div class="tl-name-stack">
                  <span class="tl-name">${escapeHtml(name)}</span>
                  ${sched ? `<p class="tl-item-desc">${escapeHtml(sched)}</p>` : ''}
                </div>
              </td>
              <td class="tl-col-exec" title="${escapeHtml(target)}"><span class="tl-exec-text">${escapeHtml(target)}</span></td>
              <td class="tl-col-ops">
                <div class="tl-ops">
                  <button type="button" class="btn btn-sm btn-secondary" data-action="open-automation" data-id="${escapeHtml(id)}">${_l('查看规则', 'tasks.viewRule')}</button>
                  <button type="button" class="btn btn-sm btn-primary" data-action="filter-automation-runs" data-id="${escapeHtml(id)}">${_l('相关任务', 'tasks.relatedTasks')}</button>
                </div>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`
}

function renderAttentionTaskRow(t, state) {
  const roleLabel = resolveTaskRoleLabel(t, state)
  const agentLabel = resolveTaskAgentLabel(t, state)
  const title = String(t.name || t.title || t.id || _l('未命名', 'tasks.unnamed')).trim()
  return `
    <tr class="tl-row tl-row--clickable" data-action="open" data-id="${escapeHtml(t.id)}" title="${escapeHtml(title)}">
      <td class="tl-col-status">${statusDot(t.status)}</td>
      <td class="tl-col-role" title="${escapeHtml(title)}">${escapeHtml(title.slice(0, 28))}${title.length > 28 ? '…' : ''}</td>
      <td class="tl-col-agent" title="${escapeHtml(agentLabel || roleLabel)}">${agentLabel || roleLabel ? escapeHtml(agentLabel || roleLabel) : '<span class="tl-empty">—</span>'}</td>
      <td class="tl-col-prog">${renderProgBlock(t)}</td>
    </tr>`
}

function renderAttentionApprovalRow(a, state) {
  const roleLabel = a.roleName || a.roleCode || ''
  const agentLabel = a.roleCode
    ? (resolveAssignedAgentDisplayName(a.roleCode, state.agents) || a.roleCode)
    : ''
  const title = String(a.title || _l('审批请求', 'tasks.approvalRequest')).trim()
  return `
    <tr class="tl-row tl-row--approval tl-row--clickable" data-action="open-approval" data-id="${escapeHtml(a.id)}" title="${escapeHtml(title)}">
      <td class="tl-col-status"><span class="tl-status tl-status--approval"><span class="tl-dot"></span>${_l('待审批·转交', 'tasks.approvalPending')}</span></td>
      <td class="tl-col-role" title="${escapeHtml(title)}">${escapeHtml(title.slice(0, 28))}${title.length > 28 ? '…' : ''}</td>
      <td class="tl-col-agent" title="${escapeHtml(agentLabel || roleLabel)}">${agentLabel || roleLabel ? escapeHtml(agentLabel || roleLabel) : '<span class="tl-empty">—</span>'}</td>
      <td class="tl-col-prog"><span class="tl-empty">${_l('拍板后才开工', 'tasks.approvalWaitDecision')}</span></td>
    </tr>`
}

function renderApprovalCard(a, state) {
  const roleLabel = a.roleName || a.roleCode || ''
  const agentLabel = a.roleCode
    ? (resolveAssignedAgentDisplayName(a.roleCode, state.agents) || a.roleCode)
    : ''
  const meta = [roleLabel, agentLabel].filter(Boolean)
  return `
    <article class="tasks-card tasks-card--approval" data-action="open-approval" data-id="${escapeHtml(a.id)}">
      <div class="tasks-card-top">
        <span class="tl-status tl-status--approval"><span class="tl-dot"></span>${_l('待审批·转交', 'tasks.approvalPending')}</span>
      </div>
      <div class="tasks-card-title">${escapeHtml(a.title)}</div>
      ${meta.length ? `<div class="tasks-card-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div>` : ''}
      <div class="tasks-card-actions">
        <button class="btn btn-sm btn-primary" data-action="open-approval" data-id="${escapeHtml(a.id)}">${_l('去审核', 'tasks.approvalGoReview')}</button>
      </div>
    </article>`
}

/** 按状态查看（折叠区内）：渲染状态计数卡片，点击切换 statusFilter */
function renderStatusCards(page, state) {
  const cardsEl = page.querySelector('#tasks-stat-cards')
  if (!cardsEl) return
  const visibleTasks = getVisibleRootTasks(state)
  const total = visibleTasks.length

  // 零任务：渲染新手引导卡片
  if (total === 0 && state.timeRange === 'all') {
    cardsEl.innerHTML = renderOnboardingGuide()
    return
  }
  cardsEl.innerHTML = _localizeOptions(STATUS_GROUPS, 'statusGroup').map(g => {
    const count = countTasksInGroup(visibleTasks, g)
    const active = state.statusFilter === g.key ? ' is-active' : ''
    return `
      <button type="button" class="stat-card stat-card-clickable tasks-stat-card tasks-stat-card--${g.tone}${active}" data-status-group="${g.key}">
        <div class="stat-card-label">${g.label}</div>
        <div class="stat-card-value">${count}</div>
        <div class="stat-card-meta">${g.hint}</div>
      </button>
    `
  }).join('')
}

/** 顶部主状态标签：全部 / 待处理 / 运行中 / 已完成 / 异常 */
function renderMainStatusTabs(page, state) {
  const el = page.querySelector('#tasks-status-tabs')
  if (!el) return
  el.innerHTML = _localizeOptions(MAIN_STATUS_TABS, 'mainTab').map((t) => {
    const active = (state.statusFilter || null) === (t.status || null) ? ' is-active' : ''
    return `
      <button type="button" class="tasks-status-tab${active}" data-status-tab="${t.status || ''}" role="tab" aria-selected="${active ? 'true' : 'false'}">
        <span class="tasks-status-tab-label">${t.label}</span>
      </button>`
  }).join('')
  const titleEl = page.querySelector('#tasks-list-title')
  if (titleEl) {
    const cur = _localizeOptions(MAIN_STATUS_TABS, 'mainTab').find((t) => (t.status || null) === (state.statusFilter || null))
    titleEl.textContent = cur?.label ? _l(`${cur.label}任务`, 'tasks.mainTabTasksSuffix', { label: cur.label }) : _l('工作事项进度', 'tasks.pageListTitle')
  }
}

/** @deprecated 来源已降级为筛选器，保留空实现避免旧调用报错 */
function renderSourceTabs(_page, _state) {}

function renderActiveFilterBar(page, state) {
  const root = page.querySelector('#tasks-active-filters')
  const chipsEl = page.querySelector('#tasks-active-filters-chips')
  if (!root || !chipsEl) return
  const chips = []
  if (state.statusFilter) {
    chips.push(_optionLabel(MAIN_STATUS_TABS, 'mainTab', state.statusFilter, '', 'status') || getStatusFilterLabel(state.statusFilter, null))
  }
  if (state.priorityFilter) {
    const pm = PRIORITY_META[state.priorityFilter]
    chips.push(pm ? _l(pm.label, `tasks.priority${state.priorityFilter}`) : state.priorityFilter)
  }
  if (state.dateFilter === 'today' || state.timeRange === 'today') chips.push(_l('今日', 'tasks.chipToday'))
  else if (state.dateFilter) chips.push(String(state.dateFilter))
  else if (state.timeRange && state.timeRange !== 'all' && state.timeRange !== 'today') {
    chips.push(getTimeRangeLabel(state.timeRange))
  }
  if (state.sourceFilter) {
    chips.push(_optionLabel(SOURCE_FILTER_OPTIONS, 'srcFilter', state.sourceFilter, state.sourceFilter))
  }
  if (state.appFilter) chips.push(_l(`工作流 · ${state.appFilter}`, 'tasks.chipWorkflow', { name: state.appFilter }))
  if (state.agentFilter) chips.push(_l(`执行者 · ${state.agentFilter.replace(/^(role|agent):/, '')}`, 'tasks.chipExecutor', { name: state.agentFilter.replace(/^(role|agent):/, '') }))
  if (state.filter) chips.push(_l(`搜索 · ${state.filter}`, 'tasks.chipSearch', { name: state.filter }))
  if (!chips.length) {
    root.hidden = true
    chipsEl.innerHTML = ''
    return
  }
  root.hidden = false
  chipsEl.innerHTML = chips.map((c) => `<span class="tasks-active-chip">${escapeHtml(c)}</span>`).join('')
}

/** 来源筛选键：自动化＝定时触发 / 带 automation 溯源 */
function isAutomationTask(task) {
  if (!task || typeof task !== 'object') return false
  if (resolveTaskRunKind(task) === 'scheduled') return true
  if (String(task.automation_id || task.automationId || '').trim()) return true
  const ch = String(task.source_channel || task.sourceChannel || '').trim().toLowerCase()
  if (ch === 'automation') return true
  const raised = String(task.raised_by || task.raisedBy || '').trim().toLowerCase()
  if (raised === 'automation') return true
  const raw = String(task.source || '').trim().toLowerCase()
  return raw === 'automation' || raw === 'gogo_automation'
}

function resolveSourceFilterKey(task) {
  if (isAutomationTask(task)) return 'automation'
  return resolveTaskSourceKey(task)
}

function taskAppId(task) {
  return String(task?.source_app_id || task?.sourceAppId || '').trim()
}

function taskAppLabel(task) {
  const name = String(task?.source_app_name || task?.sourceAppName || '').trim()
  const id = taskAppId(task)
  if (name) return name
  return id || ''
}

function countActiveDimFilters(state) {
  let n = 0
  if (state.sourceFilter) n += 1
  if (state.statusFilter) n += 1
  if (state.appFilter) n += 1
  if (state.agentFilter) n += 1
  if (state.filter) n += 1
  if (state.timeRange && state.timeRange !== 'all') n += 1
  return n
}

/** 任务类型展示名（与来源 Tab 三档一致：对话 / 智能体员工 / 应用中心） */
function resolveTaskSourceKey(task) {
  const raw = task?.source
  const key = normalizeTaskSource(raw)
  if (key) return key
  // 应用中心跑出来的旧任务可能只有 source_app_id、未写 source
  if (String(task?.source_app_id || task?.sourceAppId || '').trim()) return 'workflow'
  return ''
}

function isWorkflowTask(task) {
  return resolveTaskSourceKey(task) === 'workflow'
    || !!String(task?.source_app_id || task?.sourceAppId || '').trim()
}

/** debug | production | scheduled — 兼容旧任务缺字段 */
function resolveTaskRunKind(task) {
  const raw = String(task?.run_kind || task?.runKind || '').trim().toLowerCase()
  if (raw === 'debug' || raw === '调试' || raw === 'debug_run') return 'debug'
  if (raw === 'scheduled' || raw === 'cron' || raw === '定时' || raw === 'timer') return 'scheduled'
  if (raw === 'production' || raw === 'formal' || raw === '正式' || raw === 'prod' || raw === 'live') {
    return 'production'
  }
  // 历史应用运行：UI 调试为主，缺字段时按调试展示
  if (isWorkflowTask(task)) return 'debug'
  return ''
}

function runKindLabel(kind) {
  if (kind === 'debug') return _l('调试', 'tasks.runKindDebug')
  if (kind === 'scheduled') return _l('定时', 'tasks.runKindScheduled')
  if (kind === 'production') return _l('正式', 'tasks.runKindProduction')
  return ''
}

function triggerKindLabel(task) {
  const raw = String(task?.trigger_kind || task?.triggerKind || '').trim().toLowerCase()
  if (raw === 'api') return _l('API 触发', 'tasks.triggerApi')
  if (raw === 'schedule' || raw === 'scheduled' || raw === 'cron') return _l('定时触发', 'tasks.triggerSchedule')
  if (raw === 'manual' || !raw) return _l('手动触发', 'tasks.triggerManual')
  return raw
}

/** 任务中心展示名：工作流优先用应用短名，避免整段目标当标题 */
function taskDisplayName(task) {
  if (isWorkflowTask(task)) {
    const app = taskAppLabel(task)
    if (app) return app
  }
  return String(task?.name || '').trim() || _l('未命名', 'tasks.unnamed')
}

function taskTypeLabel(taskOrSource) {
  if (taskOrSource && typeof taskOrSource === 'object' && isAutomationTask(taskOrSource)) {
    const app = taskAppId(taskOrSource)
    return app ? _l('自动化 · 工作流', 'tasks.automationTypeWorkflow') : _l('自动化 · 提示词', 'tasks.automationTypePrompt')
  }
  if (taskOrSource && typeof taskOrSource === 'object' && isWorkflowTask(taskOrSource)) {
    const kind = resolveTaskRunKind(taskOrSource)
    const kindZh = runKindLabel(kind)
    return kindZh ? _l(`工作流 · ${kindZh}`, 'tasks.workflowTypeWithKind', { kind: kindZh }) : _l('工作流', 'tasks.autoKindWorkflow')
  }
  const key =
    taskOrSource && typeof taskOrSource === 'object'
      ? resolveTaskSourceKey(taskOrSource)
      : normalizeTaskSource(taskOrSource)
  return _optionLabel(SOURCE_FILTER_OPTIONS, 'srcFilter', key, '', 'key')
    || _optionLabel(SOURCE_TABS, 'srcTab', key, '', 'key')
    || formatTaskSourceZh(key || taskOrSource)
    || '—'
}

/** 类型列：对话 / 员工 / 工作流 / 自动化 */
function renderTypeCell(task) {
  if (isAutomationTask(task)) {
    const sub = taskAppId(task) ? _l('工作流', 'tasks.autoKindWorkflow') : _l('提示词', 'tasks.autoKindPrompt')
    return `<span class="tl-type-tags" title="${_l('自动化', 'tasks.srcFilterAutomation')} · ${escapeHtml(sub)}"><span class="tl-tag tl-tag--automation">${_l('自动化', 'tasks.srcFilterAutomation')}</span><span class="tl-tag tl-tag--${taskAppId(task) ? 'scheduled' : 'debug'}">${escapeHtml(sub)}</span></span>`
  }
  if (!isWorkflowTask(task)) {
    const label = taskTypeLabel(task)
    return `<span class="tl-type" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`
  }
  const kind = resolveTaskRunKind(task)
  const kindZh = runKindLabel(kind) || _l('运行', 'tasks.runFallback')
  return `<span class="tl-type-tags" title="${_l('工作流', 'tasks.autoKindWorkflow')} · ${escapeHtml(kindZh)}"><span class="tl-tag">${_l('工作流', 'tasks.autoKindWorkflow')}</span><span class="tl-tag tl-tag--${escapeHtml(kind || 'debug')}">${escapeHtml(kindZh)}</span></span>`
}

/** 名称下方辅行：触发方式 / 当前节点 / 失败节点 / 参数数量 */
function taskSecondaryLine(task) {
  if (!isWorkflowTask(task)) return ''
  const group = toTaskStatusGroup(task.status)
  const { subtaskCount, completedCount, executingNames, failedNames } = progressMeta(task)
  const paramCount = Number(task?.run_parameter_count ?? task?.runParameterCount)
  const params = (task?.run_parameters && typeof task.run_parameters === 'object')
    ? task.run_parameters
    : (task?.runParameters && typeof task.runParameters === 'object' ? task.runParameters : null)
  const nParams = Number.isFinite(paramCount) && paramCount > 0
    ? paramCount
    : (params ? Object.keys(params).length : 0)

  if (group === 'executing' || group === 'planning' || group === 'paused') {
    if (executingNames.length) {
      const sep = getLang() === 'en' ? ', ' : '、'
      const names = executingNames.slice(0, 2).join(sep)
      const more = executingNames.length > 2 ? _l(` 等 ${executingNames.length} 个`, 'tasks.secLineMore', { n: executingNames.length }) : ''
      return executingNames.length > 1
        ? _l(`正在并行执行：${names}${more}`, 'tasks.secLineParallel', { names, more })
        : _l(`正在执行：${names}`, 'tasks.secLineRunning', { names })
    }
    return _l(`${runKindLabel(resolveTaskRunKind(task)) || '工作流'} · ${triggerKindLabel(task)}`, 'tasks.secLineKindTrigger', {
      kind: runKindLabel(resolveTaskRunKind(task)) || _l('工作流', 'tasks.autoKindWorkflow'),
      trigger: triggerKindLabel(task),
    })
  }
  if (group === 'failed' && failedNames.length) {
    const sep = getLang() === 'en' ? ', ' : '、'
    return _l(`失败节点：${failedNames.slice(0, 2).join('、')}`, 'tasks.secLineFailedNodes', { names: failedNames.slice(0, 2).join(sep) })
  }
  const kindLabel = runKindLabel(resolveTaskRunKind(task))
  const bits = [
    kindLabel ? _l(`${kindLabel}运行`, 'tasks.secLineKindRun', { kind: kindLabel }) : _l('工作流运行', 'tasks.secLineWorkflowRun'),
    triggerKindLabel(task),
  ]
  if (nParams > 0) bits.push(_l(`${nParams} 个运行参数`, 'tasks.secLineRunParams', { n: nParams }))
  if (subtaskCount > 0 && (group === 'completed' || group === 'reviewed')) {
    bits.push(_l(`${completedCount}/${subtaskCount} 个节点`, 'tasks.secLineNodes', { done: completedCount, total: subtaskCount }))
  }
  return bits.join(' · ')
}

/** 类型 / 状态 / 应用 / 智能体筛选；选项随当前任务集刷新 */
function renderDimensionFilters(page, state) {
  const typeSel = page.querySelector('#tasks-type-select')
  const statusSel = page.querySelector('#tasks-status-select')
  const appSel = page.querySelector('#tasks-app-select')
  const agentSel = page.querySelector('#tasks-agent-select')
  const clearBtn = page.querySelector('#btn-clear-filters')
  const badge = page.querySelector('#tasks-filter-badge')
  const tasks = Array.isArray(state.tasks) ? state.tasks : []

  if (typeSel) {
    typeSel.value = state.sourceFilter || ''
  }

  if (statusSel) {
    const cur = state.statusFilter || ''
    statusSel.innerHTML = `<option value="">${_l('全部', 'tasks.pageAll')}</option>` + _localizeOptions(STATUS_GROUPS, 'statusGroup').map((g) =>
      `<option value="${g.key}"${cur === g.key ? ' selected' : ''}>${g.label}</option>`
    ).join('')
  }

  if (appSel) {
    const apps = new Map()
    for (const t of tasks) {
      const id = taskAppId(t)
      if (!id) continue
      if (!apps.has(id)) apps.set(id, taskAppLabel(t) || id)
    }
    const cur = state.appFilter || ''
    const opts = [...apps.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'zh'))
      .map(([id, label]) => `<option value="${escapeHtml(id)}"${cur === id ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')
    appSel.innerHTML = `<option value="">${_l('全部', 'tasks.pageAll')}</option>${opts}`
    if (cur && !apps.has(cur)) {
      state.appFilter = null
      appSel.value = ''
    }
  }

  if (agentSel) {
    const agents = new Map()
    for (const t of tasks) {
      const role = String(t.assigned_role || '').trim()
      const code = String(t.assigned_to || '').trim()
      if (role) {
        const key = `role:${role}`
        if (!agents.has(key)) agents.set(key, _l(`岗位 · ${role}`, 'tasks.optRolePrefix', { name: role }))
      }
      if (code) {
        const key = `agent:${code}`
        if (!agents.has(key)) {
          const label = resolveTaskAgentLabel(t, state) || code
          agents.set(key, _l(`智能体 · ${label}`, 'tasks.optAgentPrefix', { name: label }))
        }
      }
    }
    const cur = state.agentFilter || ''
    if (cur && !agents.has(cur) && state.forceAgentFilter === cur) {
      if (cur.startsWith('role:')) agents.set(cur, _l(`岗位 · ${cur.slice(5)}`, 'tasks.optRolePrefix', { name: cur.slice(5) }))
      else if (cur.startsWith('agent:')) agents.set(cur, _l(`智能体 · ${cur.slice(6)}`, 'tasks.optAgentPrefix', { name: cur.slice(6) }))
    }
    const opts = [...agents.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'zh'))
      .map(([id, label]) => `<option value="${escapeHtml(id)}"${cur === id ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')
    agentSel.innerHTML = `<option value="">${_l('全部', 'tasks.pageAll')}</option>${opts}`
    if (cur && !agents.has(cur)) {
      if (state.forceAgentFilter === cur) {
        /* keep forced URL filter */
      } else {
        state.agentFilter = null
        agentSel.value = ''
      }
    }
  }

  const active = countActiveDimFilters(state)
  if (clearBtn) clearBtn.hidden = active === 0
  if (badge) {
    if (active > 0) {
      badge.hidden = false
      badge.textContent = String(active)
    } else {
      badge.hidden = true
      badge.textContent = ''
    }
  }
  renderActiveFilterBar(page, state)
}

/** 待办审批：从 proactive approvals 拉取，失败静默降级为空 */
async function loadApprovals(page, state) {
  try {
    const res = await api.proactiveListApprovals('pending')
    const arr = Array.isArray(res) ? res : (res?.approvals || res?.data?.approvals || [])
    state.approvals = Array.isArray(arr) ? arr : []
  } catch (_) {
    state.approvals = []
  }
  renderAttention(page, state)
  renderTodayStrip(page, state)
}

/** 归一化审批项，兼容后端不同字段名 */
function normalizeApprovals(raw) {
  const list = Array.isArray(raw) ? raw : []
  return list.map((a) => {
    const initiativeId = String(a?.initiative_id || a?.init_id || '').trim()
    const approvalId = String(a?.id || a?.approval_id || '').trim()
    const taskIdRaw = String(a?.task_id || a?.taskId || '').trim()
    // bridge initiative 常为 task:Task_xxx
    const fromInit = initiativeId.replace(/^task:/i, '')
    const taskId = taskIdRaw.replace(/^task:/i, '')
      || (/^Task_/i.test(fromInit) || /^\d{10}_[0-9a-f]{4}$/i.test(fromInit) ? fromInit : '')
    return {
      id: approvalId || initiativeId,
      approvalId,
      initiativeId,
      taskId,
      title: a?.initiative_title || a?.title || a?.task_title || a?.name || _l('审批请求', 'tasks.approvalRequest'),
      desc: a?.initiative_description || a?.description || a?.summary || '',
      roleName: a?.role_name || '',
      roleCode: a?.role_agent_code || '',
      createdAt: a?.created_at || a?.createdAt || '',
      updatedAt: a?.updated_at || a?.updatedAt || '',
    }
  })
}

/**
 * 开工前审批 → 任务中心详情（与其它任务一致），就地同意/驳回。
 * 不再跳员工页 / 智能体列表。
 */
function openApprovalItem(a) {
  const tid = String(a?.taskId || a?.id || '').trim().replace(/^task:/i, '')
  if (/^Task_/i.test(tid) || /^\d{10}_[0-9a-f]{4}$/i.test(tid)) {
    window.location.hash = `#/task/${encodeURIComponent(tid)}`
    return
  }
  const fromInit = String(a?.initiativeId || '').trim().replace(/^task:/i, '')
  if (/^Task_/i.test(fromInit) || /^\d{10}_[0-9a-f]{4}$/i.test(fromInit)) {
    window.location.hash = `#/task/${encodeURIComponent(fromInit)}`
    return
  }
  toast(_l('该审批未关联任务，无法在任务中心打开', 'tasks.approvalNotLinked'), 'warning')
}

/** 零任务时的新手引导卡片：说清 WHY/WHEN，并给出可点击的模板 */
function renderOnboardingGuide() {
  const templateCards = _localizeTemplates().map(t => `
    <button type="button" class="stat-card stat-card-clickable tasks-template-card" data-template="${t.key}" style="cursor:pointer;text-align:left">
      <div class="stat-card-label">${t.name}</div>
      <div class="stat-card-meta" style="margin-top:6px;font-size:12px;color:var(--text-secondary);line-height:1.5">${escapeHtml(t.description)}</div>
      <div class="stat-card-meta" style="margin-top:8px;font-size:11px;color:var(--text-tertiary)">${escapeHtml(_l(`适用：${t.scenario}${t.runMode === 'unattended' ? ' · 无人值守' : ''}`, 'tasks.guideApply', { scenario: t.scenario, unattended: t.runMode === 'unattended' ? _l(' · 无人值守', 'tasks.guideUnattended') : '' }))}</div>
    </button>
  `).join('')

  const guideBody = _l(
    '适合<b>长周期、多步骤、需要过程跟踪</b>的复杂目标——AI 会自动拆解成子任务并调度执行，你随时查看进度与验收。\n即时问答、单轮可完成的小事,请在对话中直接进行。',
    'tasks.guideWhenBody',
  )
  return `
    <div class="tasks-onboarding-guide" style="grid-column:1 / -1;padding:24px;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-md);">
      <div style="margin-bottom:16px">
        <h3 style="margin:0 0 8px;font-size:16px;color:var(--text-primary)">${_l('什么时候用任务中心?', 'tasks.guideWhenTitle')}</h3>
        <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.7">
          ${guideBody}
        </p>
      </div>
      <div style="margin-bottom:12px;font-size:13px;color:var(--text-tertiary)">${_l('下面是几个典型场景,点击即可快速创建:', 'tasks.guideScenes')}</div>
      <div class="task-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
        ${templateCards}
      </div>
    </div>
  `
}

function countTasksForStopScope(tasks, scope) {
  return countPausableByScope(tasks, scope === 'running' ? 'running' : 'active')
}

function taskIdsForStopScope(tasks, scope) {
  const list = Array.isArray(tasks) ? tasks : []
  if (scope === 'running') {
    return list.filter(t => isTaskRunningStatus(t.status) || isTaskPlanningStatus(t.status)).map(t => t.id)
  }
  return list.filter(t => isTaskPausableStatus(t.status)).map(t => t.id)
}

function openTaskDetail(taskId, state = null, page = null) {
  const id = String(taskId || '').trim()
  if (!id) return
  // 主路径：点行 / 决策按钮 → 任务详情；执行过程在详情「执行过程」Tab
  if (page && state) closeTaskDrawer(page, state)
  window.location.hash = `#/task/${encodeURIComponent(id)}`
}

function closeTaskDrawer(page, state) {
  if (state) state.drawerTaskId = null
}

async function batchStopTasks(page, state, { taskIds = null, scope = null, label = '' } = {}) {
  const visibleTasks = getVisibleTasks(state)
  let resolvedTaskIds = Array.isArray(taskIds) && taskIds.length ? taskIds : null
  if (!resolvedTaskIds && scope && state.timeRange !== 'all') {
    resolvedTaskIds = taskIdsForStopScope(visibleTasks, scope)
  }

  const targetCount = resolvedTaskIds?.length
    ?? countTasksForStopScope(visibleTasks, scope || 'active')

  if (!targetCount) {
    toast(_l('没有可暂停的任务', 'tasks.stopNone'), 'info')
    return
  }

  const scopeLabel = label || (scope === 'running' ? _l('执行中', 'tasks.pageScopeRunning') : _l('全部可暂停', 'tasks.pageScopeActive'))
  const yes = await showConfirm(
    _l(
      `确定要暂停${scopeLabel}的 ${targetCount} 个任务吗？\n\n范围说明：\n· 执行中 = 正在执行的任务（含验证/反思/等待派发）\n· 全部可暂停 = 待开始 + 规划中 + 已规划 + 执行中\n\n将停止无人值守队列继续启动，并尝试取消正在运行的子任务。`,
      'tasks.stopConfirm',
      { scope: scopeLabel, count: targetCount },
    )
  )
  if (!yes) return

  try {
    const resp = await api.batchStopTasks({
      taskIds: resolvedTaskIds?.length ? resolvedTaskIds : (Array.isArray(taskIds) && taskIds.length ? taskIds : null),
      scope: (resolvedTaskIds?.length || (Array.isArray(taskIds) && taskIds.length)) ? null : (scope || 'active'),
    })
    const data = resp?.data || resp
    const succeeded = data.succeeded ?? 0
    const failed = data.failed ?? 0
    if (failed > 0) {
      toast(_l(`已暂停 ${succeeded} 个，${failed} 个失败`, 'tasks.stopPartial', { ok: succeeded, fail: failed }), succeeded > 0 ? 'warning' : 'error')
    } else {
      toast(_l(`已成功暂停 ${succeeded} 个任务`, 'tasks.stopOk', { ok: succeeded }), 'success')
    }
    state.selectedTasks.clear()
    state.batchMode = false
    syncBatchSelectButtons(page, state)
    invalidate('tasks_list')
    await loadTasks(page, state)
  } catch (e) {
    toast(_l('批量暂停失败：', 'tasks.stopFailed') + e, 'error')
  }
}

function updateMonitorActionButtons(page, state) {
  const runningBtn = page.querySelector('#btn-pause-all-running')
  const activeBtn = page.querySelector('#btn-pause-all-active')
  const visibleTasks = getVisibleTasks(state)
  const runningCount = countTasksForStopScope(visibleTasks, 'running')
  const activeCount = countTasksForStopScope(visibleTasks, 'active')
  if (runningBtn) runningBtn.disabled = runningCount === 0
  if (activeBtn) activeBtn.disabled = activeCount === 0
}

function renderSkeleton(container) {
  const row = () => `
    <tr class="tl-row tl-row--skeleton" style="pointer-events:none">
      <td class="tl-col-status"><div class="skeleton" style="width:56px;height:14px;border-radius:4px"></div></td>
      <td class="tl-col-name"><div class="skeleton" style="width:60%;height:15px;border-radius:4px"></div><div class="skeleton" style="width:85%;height:12px;border-radius:4px;margin-top:6px"></div></td>
      <td class="tl-col-role"><div class="skeleton" style="width:64px;height:13px;border-radius:4px"></div></td>
      <td class="tl-col-agent"><div class="skeleton" style="width:72px;height:13px;border-radius:4px"></div></td>
      <td class="tl-col-prog"><div class="skeleton" style="width:72px;height:13px;border-radius:4px"></div></td>
      <td class="tl-col-time"><div class="skeleton" style="width:72px;height:13px;border-radius:4px"></div></td>
      <td class="tl-col-ops"><div class="skeleton" style="width:72px;height:13px;border-radius:4px"></div></td>
    </tr>`
  const card = () => `
    <article class="tasks-card tasks-card--skeleton" style="pointer-events:none">
      <div class="skeleton" style="width:40%;height:12px;border-radius:4px"></div>
      <div class="skeleton" style="width:80%;height:16px;border-radius:4px;margin-top:8px"></div>
      <div class="skeleton" style="width:55%;height:12px;border-radius:4px;margin-top:8px"></div>
    </article>`
  container.innerHTML = renderDualList(
    [row(), row(), row()].join(''),
    [card(), card(), card()].join(''),
    {},
    { mode: 'all' },
  )
}

async function loadTasks(page, state, opts = {}) {
  const silent = opts.silent === true
  const container = page.querySelector('#tasks-list')
  const countEl = page.querySelector('#tasks-count')
  // silent 模式（轮询）不渲染 skeleton，避免闪烁与覆盖用户正在查看的列表/搜索输入
  if (!silent) {
    if (countEl) countEl.textContent = _l('加载中...', 'tasks.loading')
    if (container) renderSkeleton(container)
  }

  try {
    if (isGatewayWarming()) {
      if (!silent && countEl) countEl.textContent = _l('引擎启动中…', 'tasks.engineWarming')
      const ready = await waitForBackendReady(90_000)
      if (!ready && isGatewayWarming()) {
        throw new Error(_l('引擎仍在启动，请稍后重试', 'tasks.engineStillWarming'))
      }
    }
    const mapsPromise = ensureDisplayMaps(state)
    const { takeNavWarm } = await import('../lib/nav-panel-prefetch.js')
    const warmList = takeNavWarm('tasks:list')
    const resp =
      warmList ||
      (await api.listAllTasks({
        hide_noise: state.showPatrol ? 'false' : 'true',
      }))
    await mapsPromise
    // API returns { success: true, data: { tasks: [...], total: n } }
    const tasks = Array.isArray(resp) ? resp : (resp.data?.tasks || [])
    state.tasks = tasks
    updatePageView(page, state)
    void loadApprovals(page, state)
    void loadUpcomingAutomations(page, state)
  } catch (e) {
    // silent 模式（轮询）失败时静默，不覆盖当前内容、不弹 toast
    if (silent) return
    const errMsg = escapeHtml(String(e))
    const errHtml = `<div style="color:var(--error);padding:20px;text-align:center">
      <p>${_l(`加载失败：${errMsg}`, 'tasks.loadFailedPrefix', { msg: errMsg })}</p>
      <button class="btn btn-secondary btn-sm" data-action="retry-load" style="margin-top:12px">${_l('重试加载', 'tasks.retryLoad')}</button>
    </div>`
    if (container) container.innerHTML = errHtml
    const cardsEl = page.querySelector('#tasks-stat-cards')
    if (cardsEl) cardsEl.innerHTML = `<div style="color:var(--error);padding:20px;text-align:center">${_l('加载失败，请点击右上角「刷新」重试', 'tasks.loadFailedRefresh')}</div>`
    if (countEl) countEl.textContent = _l('加载失败', 'tasks.loadFailed')
    toast(_l('加载任务列表失败：', 'tasks.loadTasksFailed') + e, 'error')
  }
}

function renderTasks(page, state) {
  const container = page.querySelector('#tasks-list')
  const countEl = page.querySelector('#tasks-count')
  const footEl = page.querySelector('#tasks-all-foot')

  const paged = getPagedSourceTasks(state)
  const { list, total } = paged
  const hasFilter = Boolean(
    state.sourceFilter ||
    state.statusFilter ||
    state.appFilter ||
    state.agentFilter ||
    state.filter ||
    (state.timeRange && state.timeRange !== 'all'),
  )

  if (countEl) {
    countEl.textContent = total
      ? (paged.pageCount > 1
        ? _l(`${total} 条根单 · 第 ${paged.page}/${paged.pageCount} 页`, 'tasks.countRoots', { total, page: paged.page, pages: paged.pageCount })
        : _l(`${total} 条根单`, 'tasks.countRootsOnly', { total }))
      : ''
  }
  const viewAllBtn = page.querySelector('#btn-view-all-tasks')
  if (viewAllBtn) viewAllBtn.hidden = !hasFilter
  if (footEl) footEl.hidden = false

  if (!total) {
    renderListPager(page, state, { total: 0 })
    const srcLabel = state.sourceFilter
      ? (_optionLabel(SOURCE_FILTER_OPTIONS, 'srcFilter', state.sourceFilter, '')
        || _optionLabel(SOURCE_TABS, 'srcTab', state.sourceFilter, '')
        || state.sourceFilter)
      : _l('全部', 'tasks.pageAll')
    const emptyHint = state.sourceFilter
      ? _l(`「${srcLabel}」暂无任务`, 'tasks.emptySrcNone', { src: srcLabel })
      : (state.statusFilter
        ? _l(`当前没有「${_optionLabel(MAIN_STATUS_TABS, 'mainTab', state.statusFilter, '', 'status') || getStatusFilterLabel(state.statusFilter, null)}」状态的任务`, 'tasks.emptyStatusNone', { status: _optionLabel(MAIN_STATUS_TABS, 'mainTab', state.statusFilter, '', 'status') || getStatusFilterLabel(state.statusFilter, null) })
        : (state.timeRange !== 'all'
          ? _l(`「${getTimeRangeLabel(state.timeRange)}」范围内暂无任务`, 'tasks.emptyRangeNone', { range: getTimeRangeLabel(state.timeRange) })
          : _l('还没有任务，从下方场景快速开始吧', 'tasks.emptyNone')))
    const showTemplates = !state.statusFilter && !state.sourceFilter && state.timeRange === 'all'
    const showInboxCta = state.statusFilter === 'inbox'
    const templateHtml = showTemplates ? `
      <div class="tasks-empty-templates">
        <div class="tasks-empty-templates-label">${_l('从场景快速创建', 'tasks.emptyTplLabel')}</div>
        <div class="tasks-empty-templates-grid">
          ${_localizeTemplates().map(t => `<button type="button" class="btn btn-secondary btn-sm tasks-empty-tpl" data-template="${t.key}">${escapeHtml(t.name)}<span>${escapeHtml(t.scenario)}${t.runMode === 'unattended' ? _l(' · 无人值守', 'tasks.tplUnattendedSuffix') : ''}</span></button>`).join('')}
        </div>
      </div>` : ''
    const inboxCtaHtml = showInboxCta
      ? `<div class="tasks-empty-templates" style="margin-top:12px">
          <button type="button" class="btn btn-primary btn-sm" id="btn-empty-new-inbox">${_l('记一条事项', 'tasks.emptyInboxCta')}</button>
        </div>`
      : ''
    const subHint = showInboxCta
      ? _l('个人日常待办在上方「我的事项」；这里专注可执行协作任务', 'tasks.emptyInboxHint')
      : (state.statusFilter || state.sourceFilter
        ? _l('可点「清除」或切换顶部状态标签', 'tasks.emptyFilteredHint')
        : (state.timeRange !== 'all' ? _l('试试「筛选」里的时间范围', 'tasks.emptyRangeHint') : _l('或点右上角「新建任务」 / 切到「我的事项」', 'tasks.emptyDefaultHint')))
    container.innerHTML = `<div class="tasks-empty">
      <p>${emptyHint}</p>
      <p class="tasks-empty-hint">${subHint}</p>
      ${templateHtml}
      ${inboxCtaHtml}
    </div>`
    container.querySelector('#btn-empty-new-inbox')?.addEventListener('click', () => {
      if (typeof state.openItemsLedger === 'function') {
        void state.openItemsLedger({ openCreate: true })
        return
      }
      page.querySelector('.tasks-ledger-btn[data-ledger="items"]')?.click()
      queueMicrotask(() => page.querySelector('#btn-new-item')?.click())
    })
    updateBatchToolbar(page, state)
    return
  }

  container.innerHTML = renderTasksDual(list, state, paged.forest)
  renderListPager(page, state, paged)
  syncPageSelectCheckbox(page, state)
  updateBatchToolbar(page, state)
}

/** 宽屏表格 + 窄屏卡片（同一数据，CSS 切换）；根单分页，展开下游嵌套行 */
function renderTasksDual(rootTasks, state, forest) {
  const tree = forest || state._taskForest || buildTaskForest(getVisibleTasks(state))
  const flat = flattenTaskRows(rootTasks, tree, state.expandedTaskIds || new Set(), { maxDepth: 2 })
  const pageNo = Number(state.page) || 1
  const pageSize = getPageSize(state)
  const baseIndex = (pageNo - 1) * pageSize
  let rootOrdinal = 0
  const rows = flat.map((row) => {
    const isRoot = !row.depth
    if (isRoot) rootOrdinal += 1
    return renderTaskRow(row.task, state, { ...row, rowIndex: isRoot ? baseIndex + rootOrdinal : null })
  }).join('')
  const cards = flat.map((row) => renderTaskCard(row.task, state, row)).join('')
  return renderDualList(rows, cards, state, { mode: 'all' })
}

function renderDualList(rowsHtml, cardsHtml, state, opts = {}) {
  return `<div class="tasks-list-dual${state.batchMode ? ' is-batch' : ''}">
    <div class="tasks-list-wide">${renderTaskTable(rowsHtml, state, opts)}</div>
    <div class="tasks-card-list" role="list">${cardsHtml}</div>
  </div>`
}

/** 表格：进度总表（登记日/责任人/事项/进度/状态/预计完成） */
function renderTaskTable(rowsHtml, state, opts = {}) {
  const mode = opts.mode || 'all'
  if (mode === 'attention') {
    return `<div class="tl-table-scroll"><table class="tl-table tl-table--attention">
      <thead><tr>
        <th class="tl-col-status">${_l('状态', 'tasks.thStatus')}</th>
        <th class="tl-col-role">${_l('事项', 'tasks.thItem')}</th>
        <th class="tl-col-agent">${_l('岗位/智能体', 'tasks.thRoleAgent')}</th>
        <th class="tl-col-prog">${_l('进度', 'tasks.thProgress')}</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`
  }
  const headCb = state.batchMode
    ? `<th class="tl-col-check"><input type="checkbox" id="tasks-select-page" aria-label="${_l('全选本页', 'tasks.thSelectPage')}" title="${_l('全选本页', 'tasks.thSelectPage')}"></th>`
    : ''
  return `<div class="tl-table-scroll"><table class="tl-table tl-table--ledger${state.batchMode ? ' tl-table--batch' : ''}">
    <thead><tr>
      ${headCb}
      <th class="tl-col-idx">${_l('序号', 'tasks.thIdx')}</th>
      <th class="tl-col-reg">${_l('登记日期', 'tasks.thRegDate')}</th>
      <th class="tl-col-type">${_l('类型', 'tasks.colType')}</th>
      <th class="tl-col-owner">${_l('责任人', 'tasks.thOwner')}</th>
      <th class="tl-col-name">${_l('工作事项', 'tasks.thWorkItem')}</th>
      <th class="tl-col-prog">${_l('当前进度', 'tasks.thCurProgress')}</th>
      <th class="tl-col-status">${_l('完成状态', 'tasks.thDoneStatus')}</th>
      <th class="tl-col-ops">${_l('操作', 'tasks.colOps')}</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`
}

/** 状态色点 + 文字（统一展示态） */
function statusDot(status) {
  const u = toUnifiedTaskStatus(status)
  const tone = {
    inbox: 'planning',
    pending: 'pending',
    planning: 'planning',
    queued: 'pending',
    running: 'executing',
    waiting_confirmation: 'paused',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
  }[u] || 'pending'
  return `<span class="tl-status tl-status--${tone}"><span class="tl-dot"></span>${escapeHtml(formatUnifiedStatusZh(status))}</span>`
}

/** 按状态的主操作按钮 */
function renderStatusPrimaryActions(t) {
  const id = escapeHtml(t.id)
  const u = toUnifiedTaskStatus(t.status)
  if (u === 'inbox') {
    return `
      <button type="button" class="btn btn-sm btn-primary" data-action="assign-inbox" data-id="${id}">${_l('派给', 'tasks.actAssign')}</button>
      <button type="button" class="btn btn-sm btn-secondary" data-action="complete-inbox" data-id="${id}">${_l('完成', 'tasks.actComplete')}</button>`
  }
  if (u === 'waiting_confirmation') {
    return `<button type="button" class="btn btn-sm btn-primary" data-action="confirm-result" data-id="${id}">${_l('确认结果', 'tasks.actConfirmResult')}</button>`
  }
  if (u === 'pending' || u === 'planning' || u === 'queued' || normalizeTaskStatusKey(t.status) === 'paused') {
    return `<button type="button" class="btn btn-sm btn-primary" data-action="handle-pending" data-id="${id}">${_l('处理', 'tasks.actHandle')}</button>`
  }
  // running：看进度统一靠点行进入详情；员工执行过程在详情「执行过程」Tab
  if (u === 'running') {
    return ''
  }
  if (u === 'failed') {
    return `
      <button type="button" class="btn btn-sm btn-secondary" data-action="view-reason" data-id="${id}">${_l('查看原因', 'tasks.actViewReason')}</button>
      <button type="button" class="btn btn-sm btn-primary" data-action="retry" data-id="${id}">${_l('重试', 'tasks.actRetry')}</button>`
  }
  // completed：查看产出统一靠点击任务行/卡片进入详情
  if (u === 'completed') {
    return ''
  }
  return ''
}

/** 按状态决定编辑菜单项文案 */
function editMenuLabelForTask(task) {
  const u = toUnifiedTaskStatus(task?.status)
  if (u === 'planning') return _l('编辑并重新规划', 'tasks.actEditReplan')
  if (u === 'running' || u === 'completed' || u === 'waiting_confirmation' || u === 'cancelled') {
    return _l('编辑名称/备注', 'tasks.actEditNameNote')
  }
  return _l('编辑', 'tasks.actEdit')
}

/** 行/卡片操作：状态主按钮 + ⋯ 菜单 */
function renderTaskRowActions(t, _state) {
  const id = escapeHtml(t.id)
  const u = toUnifiedTaskStatus(t.status)
  const items = []
  if (u === 'inbox') {
    items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="assign-inbox" data-id="${id}">${_l('派给员工', 'tasks.actAssignEmployee')}</button>`)
    items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="promote-inbox" data-id="${id}">${_l('升级为正式任务', 'tasks.actPromote')}</button>`)
    items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="complete-inbox" data-id="${id}">${_l('我已完成', 'tasks.actDoneMine')}</button>`)
    items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="edit" data-id="${id}">${_l('编辑', 'tasks.actEdit')}</button>`)
    items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="cancel" data-id="${id}">${_l('取消', 'tasks.actCancel')}</button>`)
    items.push(`<button type="button" class="tasks-more-item tasks-more-item--danger" role="menuitem" data-action="delete" data-id="${id}">${_l('删除', 'tasks.actDelete')}</button>`)
  } else {
    if (u === 'failed') {
      items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="edit" data-id="${id}">${_l('编辑名称/备注', 'tasks.actEditNameNote')}</button>`)
    } else {
      items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="edit" data-id="${id}">${editMenuLabelForTask(t)}</button>`)
    }
    if (isTaskStartableStatus(t.status)) {
      items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="start" data-id="${id}">${_l('启动', 'tasks.actStart')}</button>`)
    }
    if (isTaskPausableStatus(t.status)) {
      items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="stop" data-id="${id}">${_l('暂停', 'tasks.actStop')}</button>`)
    }
    if (isTaskCancellableStatus(t.status)) {
      items.push(`<button type="button" class="tasks-more-item" role="menuitem" data-action="cancel" data-id="${id}">${_l('取消', 'tasks.actCancel')}</button>`)
    }
    items.push(`<button type="button" class="tasks-more-item tasks-more-item--danger" role="menuitem" data-action="delete" data-id="${id}">${_l('删除', 'tasks.actDelete')}</button>`)
  }
  return `
    <div class="tasks-row-actions">
      <div class="tl-primary-actions">${renderStatusPrimaryActions(t)}</div>
      <div class="tasks-more">
        <button type="button" class="tasks-more-btn" data-action="toggle-menu" data-id="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="${_l('更多操作', 'tasks.actMore')}">⋯</button>
        <div class="tasks-more-panel" role="menu" hidden>
          ${items.join('')}
        </div>
      </div>
    </div>`
}

/** 窄屏卡片：单层信息，不堆描述；协作下游可展开 */
function renderTaskCard(t, state, rowMeta = null) {
  const depth = Number(rowMeta?.depth) || 0
  const childCount = Number(rowMeta?.childCount) || 0
  const rollupHint = formatDownstreamHint(rowMeta?.rollup)
  const group = toTaskStatusGroup(t.status)
  const isFailed = group === 'failed'
  const isSelected = state.selectedTasks.has(t.id)
  const agentLabel = resolveTaskAgentLabel(t, state) || resolveTaskRoleLabel(t, state)
  const displayName = taskDisplayName(t)
  const progressNl = progressNarrativeText(t)
  const timeLabel = formatAbsoluteClock(parseTimeFlexible(t?.updated_at || t?.updatedAt) || parseTaskTimestamp(t)) || formatRelativeTime(t)
  const check = state.batchMode
    ? `<label class="tasks-card-check"><input type="checkbox" data-task-id="${t.id}" ${isSelected ? 'checked' : ''}></label>`
    : ''
  const meta = [taskTypeLabel(t), agentLabel].filter(Boolean)
  const expanded = state.expandedTaskIds?.has(String(t.id))
  const toggle = childCount > 0
    ? `<button type="button" class="tasks-tree-toggle${expanded ? ' is-expanded' : ''}" data-action="toggle-tree" data-id="${escapeHtml(t.id)}" aria-expanded="${expanded ? 'true' : 'false'}" title="${expanded ? _l('收起下游', 'tasks.treeCollapse') : _l('展开下游', 'tasks.treeExpand')}">${expanded ? '▼' : '▶'} ${childCount}</button>`
    : (depth > 0 ? `<span class="tasks-tree-spacer" aria-hidden="true"></span>` : '')
  return `
    <article class="tasks-card${isFailed ? ' tasks-card--failed' : ''}${isSelected ? ' tasks-card--selected' : ''}${depth > 0 ? ` tasks-card--child tasks-card--depth-${depth}` : ''}" data-id="${t.id}" data-action="open" data-depth="${depth}" role="listitem">
      <div class="tasks-card-top">
        ${check}
        ${toggle}
        ${statusDot(t.status)}
        ${timeLabel ? `<span class="tasks-card-time">${escapeHtml(timeLabel)}</span>` : ''}
      </div>
      <button type="button" class="tasks-card-title" data-action="open" data-id="${t.id}">${escapeHtml(displayName)}</button>
      ${group === 'executing' || group === 'planning' || (taskProgressPercent(t) > 0 && group !== 'pending')
        ? renderProgressBar(t, { compact: true })
        : ''}
      ${progressNl ? `<p class="tasks-card-summary" title="${escapeHtml(progressNl)}">${escapeHtml(progressNl)}</p>` : ''}
      ${rollupHint ? `<p class="tasks-card-downstream">${escapeHtml(rollupHint)}</p>` : ''}
      ${meta.length ? `<div class="tasks-card-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div>` : ''}
      <div class="tasks-card-foot">
        <div class="tasks-card-actions">
          ${renderTaskRowActions(t, state)}
        </div>
      </div>
    </article>`
}

/** 表格行：序号 / 登记日 / 责任人 / 事项 / 进度 / 状态 / 预计完成 / 操作 */
function renderTaskRow(t, state, rowMeta = null) {
  const depth = Number(rowMeta?.depth) || 0
  const childCount = Number(rowMeta?.childCount) || 0
  const rollupHint = formatDownstreamHint(rowMeta?.rollup)
  const isSelected = state.selectedTasks.has(t.id)
  const group = toTaskStatusGroup(t.status)
  const isFailed = group === 'failed'
  const workflow = isWorkflowTask(t)
  const agentLabel = resolveTaskAgentLabel(t, state) || resolveTaskRoleLabel(t, state) || _l('未指定', 'tasks.unassigned')
  const displayName = taskDisplayName(t)
  const desc = String(t.description || '').trim()
  const nameTitle = [displayName, desc && desc !== displayName ? desc : '', isFailed ? getErrorFirstLine(t) : '']
    .filter(Boolean).join(' · ')
  const expanded = state.expandedTaskIds?.has(String(t.id))
  const toggle = childCount > 0
    ? `<button type="button" class="tasks-tree-toggle${expanded ? ' is-expanded' : ''}" data-action="toggle-tree" data-id="${escapeHtml(t.id)}" aria-expanded="${expanded ? 'true' : 'false'}" title="${expanded ? _l('收起下游', 'tasks.treeCollapse') : _l('展开下游', 'tasks.treeExpand')}">${expanded ? '▼' : '▶'}</button>`
    : (depth > 0 ? `<span class="tasks-tree-spacer" aria-hidden="true"></span>` : '')

  const cbCell = state.batchMode
    ? `<td class="tl-col-check"><input type="checkbox" data-task-id="${t.id}" ${isSelected ? 'checked' : ''}></td>`
    : ''
  const idx = rowMeta?.rowIndex != null ? String(rowMeta.rowIndex) : (depth > 0 ? '' : '—')
  const st = ledgerCompletionStatus(t)

  return `
    <tr class="tl-row tl-row--clickable${isFailed ? ' tl-row--failed' : ''}${isSelected ? ' tl-row--selected' : ''}${workflow ? ' tl-row--workflow' : ''}${depth > 0 ? ` tl-row--child tl-row--depth-${depth}` : ''}" data-id="${t.id}" data-action="open" data-depth="${depth}">
      ${cbCell}
      <td class="tl-col-idx">${escapeHtml(idx)}</td>
      <td class="tl-col-reg">${renderRegisterDateCell(t)}</td>
      <td class="tl-col-type">${renderTypeCell(t)}</td>
      <td class="tl-col-owner" title="${escapeHtml(agentLabel)}">${escapeHtml(agentLabel)}</td>
      <td class="tl-col-name">
        <div class="tl-name-stack tl-name-stack--tree" style="--tree-depth:${depth}">
          <div class="tl-name-row">
            ${toggle}
            <button type="button" class="tl-name" data-action="open" data-id="${t.id}" title="${escapeHtml(nameTitle || '')}">${escapeHtml(displayName)}</button>
            ${childCount > 0 ? `<span class="tl-child-count" title="${_l('直接下游', 'tasks.treeDirect')}">${childCount}</span>` : ''}
          </div>
          ${desc && desc !== displayName ? `<p class="tl-item-desc" title="${escapeHtml(desc)}">${escapeHtml(desc.length > 80 ? `${desc.slice(0, 79)}…` : desc)}</p>` : ''}
          ${rollupHint ? `<p class="tl-downstream">${escapeHtml(rollupHint)}</p>` : ''}
        </div>
      </td>
      <td class="tl-col-prog">${renderProgressText(t)}</td>
      <td class="tl-col-status"><span class="tl-ledger-status tl-ledger-status--${st.tone}">${escapeHtml(st.label)}</span></td>
      <td class="tl-col-ops">
        <div class="tl-ops">
          ${renderTaskRowActions(t, state)}
        </div>
      </td>
    </tr>
  `
}

/** 批量模式下切换任务勾选，并同步行样式 / 工具栏 */
function toggleTaskSelection(page, state, taskId) {
  const id = String(taskId || '').trim()
  if (!id) return
  if (state.selectedTasks.has(id)) state.selectedTasks.delete(id)
  else state.selectedTasks.add(id)
  const selected = state.selectedTasks.has(id)
  page.querySelectorAll('input[type="checkbox"][data-task-id]').forEach((cb) => {
    if (String(cb.dataset.taskId) === id) cb.checked = selected
  })
  page.querySelectorAll('tr[data-id], article[data-id]').forEach((el) => {
    if (String(el.dataset.id) !== id) return
    el.classList.toggle('tl-row--selected', selected && el.matches('tr'))
    el.classList.toggle('tasks-card--selected', selected && el.matches('article'))
  })
  syncPageSelectCheckbox(page, state)
  updateBatchToolbar(page, state)
}

function attachTaskEvents(page, state) {
  // 任务列表 + 需要你处理 + 即将运行的自动化
  const containers = [
    page.querySelector('#tasks-list'),
    page.querySelector('#tasks-attention-list'),
    page.querySelector('#tasks-upcoming-list'),
  ].filter(Boolean)
  page.addEventListener('click', (e) => {
    if (!e.target.closest('.tasks-more')) closeAllTaskMenus(page)
  })
  containers.forEach((container) => {
    container.addEventListener('click', async (e) => {
    const tplBtn = e.target.closest('[data-template]')
    if (tplBtn) {
      const tpl = _localizeTemplates().find(t => t.key === tplBtn.dataset.template)
      if (tpl) showCreateTaskDialog(page, state, () => loadTasks(page, state), tpl)
      return
    }
    // 整行可点（需要你处理）
    const rowAct = e.target.closest('tr[data-action], article[data-action]')
    if (rowAct && !e.target.closest('button, a, input, label')) {
      const action = rowAct.dataset.action
      const id = rowAct.dataset.id
      if (action === 'open') {
        // 批量模式：点行切换勾选，不进详情
        if (state.batchMode) toggleTaskSelection(page, state, id)
        else openTaskDetail(id, state, page)
      } else if (action === 'open-approval') {
        const item = normalizeApprovals(state.approvals).find((x) => x.id === id)
        openApprovalItem(item || { id })
      }
      return
    }
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id

    if (action === 'open-automation') {
      e.preventDefault()
      e.stopPropagation()
      window.location.hash = id
        ? `#/automation?tab=tasks&focus=${encodeURIComponent(id)}`
        : '#/automation'
      return
    }
    if (action === 'filter-automation-runs') {
      e.preventDefault()
      e.stopPropagation()
      const auto = (state.upcomingAutomations || []).find((a) => String(a.id) === String(id))
      state.sourceFilter = 'automation'
      state.page = 1
      state.filter = String(auto?.name || id || '').trim()
      const search = page.querySelector('#tasks-search')
      if (search) search.value = state.filter
      commitTaskFilters(page, state, { scrollList: true })
      return
    }

    if (action === 'toggle-menu') {
      e.stopPropagation()
      const wrap = btn.closest('.tasks-more')
      const panel = wrap?.querySelector('.tasks-more-panel')
      const open = panel && !panel.hasAttribute('hidden')
      closeAllTaskMenus(page)
      if (panel && !open) {
        openTaskMenu(btn, panel, wrap)
      }
      return
    }

    if (action === 'toggle-tree') {
      e.stopPropagation()
      e.preventDefault()
      const tid = String(id || '').trim()
      if (!tid) return
      if (!state.expandedTaskIds) state.expandedTaskIds = new Set()
      if (state.expandedTaskIds.has(tid)) state.expandedTaskIds.delete(tid)
      else state.expandedTaskIds.add(tid)
      renderTasks(page, state)
      return
    }

    // 菜单项点击后收起
    if (btn.closest('.tasks-more-panel')) {
      closeAllTaskMenus(page)
    }

    if (action === 'open') {
      // 标题按钮在批量模式下同样只勾选
      if (state.batchMode) toggleTaskSelection(page, state, id)
      else openTaskDetail(id, state, page)
    } else if (action === 'open-approval') {
      const item = normalizeApprovals(state.approvals).find((x) => x.id === id)
      openApprovalItem(item || { id })
    } else if (action === 'edit') {
      await editTask(page, state, id)
    } else if (action === 'start') {
      await startTaskExecution(page, state, id)
    } else if (action === 'stop') {
      await stopTaskExecution(page, state, id)
    } else if (action === 'cancel') {
      await cancelTask(page, state, id)
    } else if (action === 'delete') {
      await deleteTask(page, state, id)
    } else if (action === 'retry-load') {
      await loadTasks(page, state)
    } else if (
      action === 'handle-pending' ||
      action === 'confirm-result' ||
      action === 'view-progress' ||
      action === 'open-work-process' ||
      action === 'view-reason' ||
      action === 'retry'
    ) {
      e.stopPropagation()
      await handleTaskPrimaryAction(page, state, action, id)
    } else if (action === 'assign-inbox') {
      e.stopPropagation()
      await assignInboxTask(page, state, id)
    } else if (action === 'promote-inbox') {
      e.stopPropagation()
      await promoteInboxTask(page, state, id)
    } else if (action === 'complete-inbox') {
      e.stopPropagation()
      await completeInboxTask(page, state, id)
    }
    })

    container.addEventListener('change', (e) => {
      if (e.target?.id === 'tasks-select-page') {
        const ids = getPagedSourceTasks(state).list.map(t => t.id)
        if (e.target.checked) ids.forEach((id) => state.selectedTasks.add(id))
        else ids.forEach((id) => state.selectedTasks.delete(id))
        renderTasks(page, state)
        updateBatchToolbar(page, state)
        return
      }
      const cb = e.target.closest('input[type="checkbox"][data-task-id]')
      if (!cb) return
      const taskId = cb.dataset.taskId
      if (!taskId) return
      if (cb.checked) {
        state.selectedTasks.add(taskId)
      } else {
        state.selectedTasks.delete(taskId)
      }
      // 与行点击勾选保持同一套选中样式
      const selected = cb.checked
      const row = cb.closest('tr[data-id], article[data-id]')
      if (row) {
        row.classList.toggle('tl-row--selected', selected && row.matches('tr'))
        row.classList.toggle('tasks-card--selected', selected && row.matches('article'))
      }
      syncPageSelectCheckbox(page, state)
      updateBatchToolbar(page, state)
    })
  })
}

function roleSelectOptions(state) {
  const roles = Object.values(state?.rolesByCode || {})
  const opts = [{ value: '', label: _l('暂不指定（稍后派发）', 'tasks.roleUnassigned') }]
  for (const r of roles) {
    const code = String(r?.agent_code || '').trim()
    const name = String(r?.role_name || code).trim()
    if (!code) continue
    const status = String(r?.status || '').trim().toLowerCase()
    if (status && status !== 'active') continue
    opts.push({ value: code, label: `${name}（${code}）` })
  }
  return opts
}

function resolveRoleByCode(state, agentCode) {
  const code = String(agentCode || '').trim().toLowerCase()
  if (!code) return null
  return state?.rolesByCode?.[code] || null
}

/** 登记工作事项：写入进度总表（责任人 / 优先级 / 预计完成） */
function showCreateInboxDialog(page, state, onSuccess) {
  void ensureDisplayMaps(state).then(() => {
    showModal({
      title: _l('登记工作事项', 'tasks.inboxTitle'),
      width: 520,
      fields: [
        {
          name: 'name',
          label: _l('工作事项', 'tasks.inboxNameLabel'),
          value: '',
          placeholder: _l('例如：完成无线充电功率测试报告、核对上线清单', 'tasks.inboxNamePh'),
        },
        {
          name: 'description',
          label: _l('工作日志 / 补充说明（可选）', 'tasks.inboxDescLabel'),
          type: 'textarea',
          value: '',
          placeholder: _l('可选：背景、验收标准、相关链接…', 'tasks.inboxDescPh'),
          rows: 3,
        },
        {
          name: 'tags',
          label: _l('标签（可选）', 'tasks.inboxTagsLabel'),
          value: '',
          placeholder: _l('工作, 报告', 'tasks.inboxTagsPh'),
          hint: _l('逗号分隔，可不填。', 'tasks.inboxTagsHint'),
        },
        {
          name: 'assignee',
          label: _l('责任人', 'tasks.inboxAssigneeLabel'),
          type: 'select',
          value: '',
          options: roleSelectOptions(state),
          hint: _l('对应表中的「责任人」；可稍后派发。', 'tasks.inboxAssigneeHint'),
        },
        {
          name: 'dispatch_now',
          label: _l('立刻派发责任人', 'tasks.inboxDispatchLabel'),
          type: 'select',
          value: '0',
          options: [
            { value: '0', label: _l('否 — 只登记进表，等下次值班', 'tasks.inboxDispatchNo') },
            { value: '1', label: _l('是 — 马上叫醒员工推进', 'tasks.inboxDispatchYes') },
          ],
        },
      ],
      onConfirm: async (result) => {
        const name = (result.name || '').trim()
        if (!name) {
          toast(_l('请输入工作事项', 'tasks.inboxNameRequired'), 'error')
          return
        }
        const desc = (result.description || '').trim()
        const assignee = String(result.assignee || '').trim()
        const tags = String(result.tags || '')
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean)
        const role = resolveRoleByCode(state, assignee)
        const extras = {}
        if (tags.length) extras.tags = tags
        if (assignee) {
          extras.assigned_to = assignee
          extras.assigned_role = String(role?.role_name || '').trim() || undefined
          extras.source = 'role'
        }
        try {
          const created = await api.createInboxTodo(name, desc, extras)
          const taskId = String(created?.id || created?.task_id || '').trim()
          const wantsNow = String(result.dispatch_now || '') === '1'
          if (assignee && wantsNow && taskId) {
            try {
              await api.proactiveDispatchTask(assignee, {
                goal: name,
                description: desc || name,
                related_task_id: taskId,
                source: 'task_center_inbox',
                priority: 'normal',
              })
              toast(_l('事项已登记并立刻派发', 'tasks.inboxDispatchedNow'), 'success')
            } catch (dispatchErr) {
              toast(_l(`事项已登记，派发失败：${dispatchErr}`, 'tasks.inboxDispatchFailed', { err: dispatchErr }), 'warning')
            }
          } else {
            toast(_l('事项已写入进度表', 'tasks.inboxSaved'), 'success')
          }
          state.statusFilter = null
          state._statusQueryAlias = null
          await loadTasks(page, state)
          commitTaskFilters(page, state)
          if (typeof onSuccess === 'function') onSuccess()
        } catch (e) {
          toast(_l('登记失败：', 'tasks.inboxFailed') + e, 'error')
        }
      },
    })
  })
}

async function assignInboxTask(page, state, taskId) {
  const task = (state.tasks || []).find((t) => String(t.id) === String(taskId))
  if (!task) {
    toast(_l('任务不存在', 'tasks.taskNotFound'), 'error')
    return
  }
  await ensureDisplayMaps(state)
  const opts = roleSelectOptions(state).filter((o) => o.value)
  if (!opts.length) {
    toast(_l('暂无可用员工，请先到「智能体员工」雇佣岗位', 'tasks.noEmployees'), 'warning')
    return
  }
  showModal({
    title: _l('派给员工', 'tasks.assignTitle'),
    fields: [
      {
        name: 'assignee',
        label: _l('处理人', 'tasks.assignHandlerLabel'),
        type: 'select',
        value: String(task.assigned_to || opts[0]?.value || ''),
        options: opts,
      },
      {
        name: 'dispatch_now',
        label: _l('处理时机', 'tasks.assignTimingLabel'),
        type: 'select',
        value: '0',
        options: [
          { value: '0', label: _l('下次值班再处理', 'tasks.assignTimingNext') },
          { value: '1', label: _l('立刻派发（马上叫醒）', 'tasks.assignTimingNow') },
        ],
      },
    ],
    onConfirm: async (result) => {
      const assignee = String(result.assignee || '').trim()
      if (!assignee) {
        toast(_l('请选择处理人', 'tasks.assignSelectHandler'), 'error')
        return
      }
      const role = resolveRoleByCode(state, assignee)
      const roleName = String(role?.role_name || '').trim()
      try {
        await api.updateTask(taskId, {
          assigned_to: assignee,
          assigned_role: roleName || undefined,
          source: 'role',
        })
        const wantsNow = String(result.dispatch_now || '') === '1'
        if (wantsNow) {
          await api.proactiveDispatchTask(assignee, {
            goal: String(task.name || '').trim() || _l('处理待办', 'tasks.assignGoalFallback'),
            description: String(task.description || '').trim(),
            related_task_id: taskId,
            source: 'task_center_inbox',
            priority: 'normal',
          })
          toast(_l('已派发，员工开始处理', 'tasks.assignDispatched'), 'success')
        } else {
          toast(_l('已分配，将在下次值班时处理', 'tasks.assignAssigned'), 'success')
        }
        await loadTasks(page, state)
      } catch (e) {
        toast(_l('分配失败：', 'tasks.assignFailed') + e, 'error')
      }
    },
  })
}

async function promoteInboxTask(page, state, taskId) {
  const task = (state.tasks || []).find((t) => String(t.id) === String(taskId))
  if (!task) {
    toast(_l('任务不存在', 'tasks.taskNotFound'), 'error')
    return
  }
  showModal({
    title: _l('升级为正式任务', 'tasks.promoteTitle'),
    fields: [
      {
        name: 'run_mode',
        label: _l('执行模式', 'tasks.promoteModeLabel'),
        type: 'select',
        value: state.unattendedMode ? 'unattended' : 'manual',
        options: [
          { value: 'manual', label: _l('手动确认（规划后需你再启动）', 'tasks.runModeManualLabel') },
          { value: 'unattended', label: _l('自动执行（入队后自动规划并跑完）', 'tasks.runModeUnattendedPromote') },
        ],
        hint: _l('升级后走协作规划/执行；不再是随手待办。', 'tasks.promoteHint'),
      },
    ],
    onConfirm: async (result) => {
      const runMode = result.run_mode === 'unattended' ? 'unattended' : 'manual'
      try {
        await api.updateTask(taskId, {
          promote: true,
          run_mode: runMode,
          source: 'workflow',
        })
        toast(
          runMode === 'unattended'
            ? _l('已升级并入队自动执行', 'tasks.promotedUnattended')
            : _l('已升级为正式任务，可在行内启动', 'tasks.promotedManual'),
          'success',
        )
        state.statusFilter = null
        await loadTasks(page, state)
        commitTaskFilters(page, state)
      } catch (e) {
        toast(_l('升级失败：', 'tasks.promoteFailed') + e, 'error')
      }
    },
  })
}

async function completeInboxTask(page, state, taskId) {
  const ok = await showConfirm(_l('将这条待办标为已完成？（不调度 AI）', 'tasks.completeConfirm'))
  if (!ok) return
  try {
    await api.updateTask(taskId, { status: 'completed' })
    toast(_l('已勾完成', 'tasks.completedToast'), 'success')
    await loadTasks(page, state)
  } catch (e) {
    toast(_l('操作失败：', 'tasks.opFailed') + e, 'error')
  }
}

function showCreateTaskDialog(page, state, onSuccess, template = null) {
  const RUN_MODE_OPTIONS = [
    { value: 'manual', label: _l('手动确认（规划后需你再启动）', 'tasks.runModeManualLabel') },
    { value: 'unattended', label: _l('自动执行（创建后自动规划并跑完）', 'tasks.runModeUnattendedCreate') },
  ]
  // 模板预填优先，其次沿用上次新建时的执行模式
  const defaultRunMode = template?.runMode || (state.unattendedMode ? 'unattended' : 'manual')

  showModal({
    title: template ? _l(`新建任务 · ${template.name}`, 'tasks.createTitleTpl', { name: template.name }) : _l('新建任务', 'tasks.createTitle'),
    fields: [
      { name: 'name', label: _l('任务名称', 'tasks.createNameLabel'), value: template?.name || '', placeholder: _l('例如：竞品分析与报告、重构认证模块、撰写本周周报', 'tasks.createNamePh') },
      {
        name: 'description',
        label: _l('任务描述', 'tasks.createDescLabel'),
        type: 'textarea',
        value: template?.description || '',
        placeholder: _l('详细描述任务目标、约束与期望产物。描述越具体，AI 规划越精准。例如：分析三家头部竞品的定价策略，输出对比表格与结论。', 'tasks.createDescPh'),
        rows: 4,
      },
      {
        name: 'run_mode',
        label: _l('执行模式', 'tasks.promoteModeLabel'),
        type: 'select',
        value: defaultRunMode,
        options: RUN_MODE_OPTIONS,
        hint: _l('正式协作任务适合长周期、多步骤工作；随手备忘请用「+ 待办」。即时问答请在对话中直接进行。', 'tasks.createModeHint'),
      },
      {
        name: 'workspace_root',
        label: _l('工作目录（可选）', 'tasks.createWsLabel'),
        type: 'folder',
        value: String(getPanelSetting('defaultProjectWorkspaceRoot', '') || '').trim(),
        placeholder: _l('留空则用默认数据目录 / 当前工作空间', 'tasks.createWsPh'),
        hint: _l('AI 将在此文件夹读写文件；选已有项目即可继续做，不会重置模型配置。', 'tasks.createWsHint'),
      },
    ],
    onConfirm: async (result) => {
      const name = (result.name || '').trim()
      if (!name) {
        toast(_l('请输入任务名称', 'tasks.createNameRequired'), 'error')
        return
      }

      const desc = (result.description || '').trim()
      if (!desc) {
        toast(_l('请输入任务描述，以便 AI 精准规划', 'tasks.createDescRequired'), 'error')
        return
      }

      const runMode = result.run_mode === 'unattended' ? 'unattended' : 'manual'

      // 记住上次选择的执行模式，下次新建默认沿用
      const wantsUnattended = runMode === 'unattended'
      if (state.unattendedMode !== wantsUnattended) {
        state.unattendedMode = wantsUnattended
        try { localStorage.setItem(TASKS_UNATTENDED_STORAGE_KEY, wantsUnattended ? '1' : '0') } catch (_) {}
      }

      try {
        const wsRoot = String(result.workspace_root || '').trim()
        await api.createTask(name, desc, runMode, wsRoot ? { workspace_root: wsRoot } : null)
        if (wsRoot) {
          try {
            const { wsClient } = await import('../lib/ws-client.js')
            await wsClient.registerGlobalWorkspacePath(wsRoot)
          } catch {
            /* ignore */
          }
        }
        toast(
          runMode === 'unattended'
            ? _l('任务已提交，系统将自动规划并执行', 'tasks.createdUnattended')
            : _l('任务已创建，可用批量启动或在行内启动', 'tasks.createdManual'),
          'success',
        )
        await loadTasks(page, state)
        if (typeof onSuccess === 'function') onSuccess()
      } catch (e) {
        toast(_l('创建失败：', 'tasks.createFailed') + e, 'error')
      }
    }
  })
}

/** 关闭列表里所有 ⋯ 菜单 */
function closeAllTaskMenus(root) {
  root?.querySelectorAll('.tasks-more.is-open').forEach((wrap) => {
    wrap.classList.remove('is-open')
    wrap.querySelector('.tasks-more-btn')?.setAttribute('aria-expanded', 'false')
    const panel = wrap.querySelector('.tasks-more-panel')
    if (panel) {
      panel.setAttribute('hidden', '')
      panel.style.position = ''
      panel.style.top = ''
      panel.style.left = ''
      panel.style.right = ''
      panel.style.zIndex = ''
    }
  })
}

/** fixed 定位弹出，避免被卡片 / panel overflow 裁切 */
function openTaskMenu(btn, panel, wrap) {
  panel.removeAttribute('hidden')
  btn.setAttribute('aria-expanded', 'true')
  wrap?.classList.add('is-open')
  const rect = btn.getBoundingClientRect()
  const width = 148
  let left = rect.right - width
  if (left < 8) left = 8
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
  panel.style.position = 'fixed'
  panel.style.left = `${left}px`
  panel.style.right = 'auto'
  panel.style.zIndex = '1200'
  // 先放到下方，量高度后再决定是否上翻
  panel.style.top = `${rect.bottom + 4}px`
  requestAnimationFrame(() => {
    const h = panel.offsetHeight || 0
    let top = rect.bottom + 4
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, rect.top - h - 4)
    }
    panel.style.top = `${top}px`
  })
}

async function handleTaskPrimaryAction(page, state, action, taskId) {
  const id = String(taskId || '').trim()
  if (!id) return
  // open-work-process / view-progress：列表侧统一进详情（执行过程在详情 Tab）
  if (action === 'open-work-process' || action === 'view-progress') {
    openTaskDetail(id, state, page)
    return
  }
  if (action === 'handle-pending') {
    const task = (state.tasks || []).find((t) => String(t.id) === id)
    if (task && isTaskStartableStatus(task.status)) {
      await startTaskExecution(page, state, id, { openDrawer: false })
      openTaskDetail(id, state, page)
      return
    }
    openTaskDetail(id, state, page)
    return
  }
  if (action === 'confirm-result' || action === 'view-reason') {
    openTaskDetail(id, state, page)
    return
  }
  if (action === 'retry') {
    try {
      await api.restartTask(id)
      toast(_l('已重新排队执行', 'tasks.retryQueued'), 'success')
      invalidate('tasks_list')
      await loadTasks(page, state)
      openTaskDetail(id, state, page)
    } catch (e) {
      toast(_l('重试失败：', 'tasks.retryFailed') + e, 'error')
    }
  }
}

async function startTaskExecution(page, state, taskId, { openDrawer = false } = {}) {
  try {
    await api.startTaskPlanning(taskId)
    toast(_l('任务已加入执行队列', 'tasks.started'), 'success')
    invalidate('tasks_list')
    await loadTasks(page, state)
    openTaskDetail(taskId, state, page)
  } catch (e) {
    toast(_l('启动失败：', 'tasks.startFailed') + e, 'error')
  }
}

async function stopTaskExecution(page, state, taskId) {
  try {
    await api.stopTaskExecution(taskId)
    toast(_l('任务已暂停', 'tasks.stopped'), 'info')
    invalidate('tasks_list')
    await loadTasks(page, state)
  } catch (e) {
    toast(_l('暂停失败：', 'tasks.stopTaskFailed') + e, 'error')
  }
}

async function editTask(page, state, taskId) {
  const task = (state.tasks || []).find((t) => String(t.id) === String(taskId))
  if (!task) {
    toast(_l('任务不存在或已刷新，请重试', 'tasks.taskNotFoundRefresh'), 'warning')
    return
  }
  const u = toUnifiedTaskStatus(task.status)
  const fullEdit = u === 'pending'
  const replan = u === 'planning'
  const nameNoteOnly = u === 'running' || u === 'completed' || u === 'waiting_confirmation' || u === 'failed' || u === 'queued' || u === 'cancelled'
  const noteLabel = nameNoteOnly ? _l('备注', 'tasks.noteLabelNote') : _l('任务描述', 'tasks.createDescLabel')
  const notePlaceholder = nameNoteOnly
    ? _l('补充备注（不影响执行中的配置）', 'tasks.notePhNote')
    : _l('任务目标、约束与期望产物', 'tasks.notePhDesc')
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
        label: noteLabel,
        type: 'textarea',
        value: String(task.description || task.notes || task.remark || ''),
        placeholder: notePlaceholder,
        rows: fullEdit || replan ? 4 : 3,
      },
    ],
    onConfirm: async (result) => {
      const name = String(result.name || '').trim()
      if (!name) {
        toast(_l('请输入任务名称', 'tasks.createNameRequired'), 'error')
        return
      }
      try {
        const payload = { name }
        if (fullEdit || replan) {
          payload.description = String(result.description || '').trim()
        } else {
          // 执行中 / 已完成：仅名称 + 备注（写入 description 兼容字段）
          payload.description = String(result.description || '').trim()
        }
        await api.updateTask(taskId, payload)
        if (replan) {
          try {
            await api.startTaskPlanning(taskId)
            toast(_l('已保存并重新规划', 'tasks.savedReplan'), 'success')
          } catch (e) {
            toast(_l('已保存，但重新规划失败：', 'tasks.savedReplanFailed') + e, 'warning')
          }
        } else {
          toast(_l('已保存', 'tasks.saved'), 'success')
        }
        invalidate('tasks_list')
        await loadTasks(page, state)
      } catch (e) {
        toast(_l('保存失败：', 'tasks.saveFailed') + e, 'error')
      }
    },
  })
}

async function copyAndRecreateTask(page, state, taskId) {
  const task = (state.tasks || []).find((t) => String(t.id) === String(taskId))
  if (!task) {
    toast(_l('任务不存在或已刷新，请重试', 'tasks.taskNotFoundRefresh'), 'warning')
    return
  }
  const baseName = String(task.name || _l('未命名任务', 'tasks.copyBase')).trim()
  const copySuffix = _l('（副本）', 'tasks.copySuffix')
  const name = baseName.endsWith(copySuffix) ? baseName : `${baseName}${copySuffix}`
  const desc = String(task.description || task.goal || '').trim()
  const runMode = String(task.run_mode || task.runMode || 'manual') === 'unattended' ? 'unattended' : 'manual'
  showModal({
    title: _l('复制并重新创建', 'tasks.copyTitle'),
    fields: [
      { name: 'name', label: _l('任务名称', 'tasks.createNameLabel'), value: name, placeholder: _l('任务名称', 'tasks.createNameLabel') },
      { name: 'description', label: _l('任务描述', 'tasks.createDescLabel'), type: 'textarea', value: desc, placeholder: _l('任务目标、约束与期望产物', 'tasks.notePhDesc'), rows: 4 },
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
        invalidate('tasks_list')
        await loadTasks(page, state)
        if (newId) openTaskDetail(newId, state, page)
      } catch (e) {
        toast('创建失败：' + e, 'error')
      }
    },
  })
}

async function cancelTask(page, state, taskId) {
  const task = (state.tasks || []).find((t) => String(t.id) === String(taskId))
  if (task && !isTaskCancellableStatus(task.status)) {
    toast(_l('当前状态不可取消', 'tasks.cancelNotAllowed'), 'warning')
    return
  }
  const yes = await showConfirm(_l('确定取消该任务？\n\n取消后任务将停止执行，记录仍保留（可再删除）。', 'tasks.cancelConfirm'))
  if (!yes) return
  try {
    if (typeof api.cancelTask === 'function') {
      await api.cancelTask(taskId)
    } else {
      await api.setTaskState(taskId, 'cancelled', _l('用户在任务中心取消', 'tasks.cancelReason'))
    }
    toast(_l('已取消', 'tasks.statusCancelled'), 'success')
    invalidate('tasks_list')
    await loadTasks(page, state)
  } catch (e) {
    toast(_l('取消失败：', 'tasks.cancelFailed') + e, 'error')
  }
}

async function deleteTask(page, state, taskId) {
  const yes = await showConfirm(_l('确定删除该任务？\n\n此操作将删除任务及其所有子任务。', 'tasks.deleteConfirm'))
  if (!yes) return

  try {
    await api.deleteTask(taskId)
    toast(_l('已删除', 'tasks.deleted'), 'success')
    await loadTasks(page, state)
  } catch (e) {
    toast(_l('删除失败：', 'tasks.deleteFailed') + e, 'error')
  }
}

function getStatusBadge(status) {
  const u = toUnifiedTaskStatus(status)
  const label = formatUnifiedStatusZh(status)
  const cls = {
    pending: 'badge',
    planning: 'badge badge-info',
    queued: 'badge',
    running: 'badge badge-primary',
    waiting_confirmation: 'badge badge-warning',
    completed: 'badge badge-success',
    failed: 'badge badge-danger',
    cancelled: 'badge',
  }[u] || 'badge'
  return `<span class="${cls}">${escapeHtml(label)}</span>`
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 更新批量工具栏状态
function syncBatchSelectButtons(page, state) {
  const btn = page.querySelector('#btn-batch-select')
  if (!btn) return
  btn.textContent = state.batchMode ? _l('退出批量', 'tasks.batchModeExit') : _l('批量删除', 'tasks.pageBatchDelete')
  btn.setAttribute('aria-pressed', state.batchMode ? 'true' : 'false')
  btn.classList.toggle('is-active', Boolean(state.batchMode))
}

function syncPageSelectCheckbox(page, state) {
  const cb = page.querySelector('#tasks-select-page')
  if (!cb || !state.batchMode) return
  const ids = getPagedSourceTasks(state).list.map(t => t.id)
  if (!ids.length) {
    cb.checked = false
    cb.indeterminate = false
    return
  }
  const selected = ids.filter(id => state.selectedTasks.has(id)).length
  cb.checked = selected === ids.length
  cb.indeterminate = selected > 0 && selected < ids.length
}

function updateBatchToolbar(page, state) {
  const toolbar = page.querySelector('#batch-toolbar')
  const countEl = page.querySelector('#batch-count')
  
  if (!toolbar || !countEl) return
  
  const selectedCount = state.selectedTasks.size
  
  if (state.batchMode && selectedCount > 0) {
    toolbar.style.display = 'flex'
    countEl.textContent = _l(`已选择 ${selectedCount} 项`, 'tasks.batchCount', { n: selectedCount })
  } else if (state.batchMode) {
    toolbar.style.display = 'flex'
    countEl.textContent = _l('勾选任务后可批量删除', 'tasks.batchHint')
  } else {
    toolbar.style.display = 'none'
  }
  
  // 更新按钮状态
  const hasSelection = selectedCount > 0
  page.querySelector('#btn-batch-start').disabled = !hasSelection
  page.querySelector('#btn-batch-stop').disabled = !hasSelection
  page.querySelector('#btn-batch-delete').disabled = !hasSelection
}


