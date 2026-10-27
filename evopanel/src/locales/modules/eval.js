import { _ } from '../helper.js'

/**
 * 评测中心（src/react/eval/）展示文案
 * 键名即 t('eval.xxx')。zh 侧与改造前页面原文逐字一致。
 * 高频通用词（取消/重试/加载中/错误/超时/刷新/关闭/查看/状态）
 * 复用 chat-ui.js / chatShell.js 的现有键，不在本词典重复。
 */
export default {
  _placeholder: _('评测', 'Evaluation'),

  // ---------- EvalApp.tsx 品牌 + 侧栏 nav ----------
  evalBrandTitle: _('评测中心', 'Evaluation Center'),
  evalBrandSub: _('真实业务回归 · 可核验证据', 'Real business regression · verifiable evidence'),
  evalBackHome: _('← 返回工作台', '← Back to workspace'),

  // nav label + hint
  evalNavDashboard: _('健康总览', 'Health overview'),
  evalNavDashboardHint: _('跑评测', 'Run eval'),
  evalNavCases: _('① 测什么', '① What to test'),
  evalNavCasesHint: _('用例内容', 'Case content'),
  evalNavEmployees: _('智能体员工', 'Agent employees'),
  evalNavEmployeesHint: _('能不能用 / 协同', 'Usable / collaboration'),
  evalNavWorkflow: _('工作流', 'Workflow'),
  evalNavWorkflowHint: _('规则 / 真跑任务', 'Rules / real run'),
  evalNavHistory: _('②③ 结果详情', '②③ Result details'),
  evalNavHistoryHint: _('结果+证据', 'Result + evidence'),
  evalNavBusiness: _('业务质量', 'Business quality'),
  evalNavSecurity: _('安全中心', 'Security center'),
  evalNavPerformance: _('性能基准', 'Performance baseline'),
  evalNavSchedule: _('评测计划', 'Eval schedule'),
  evalNavAlert: _('告警配置', 'Alert config'),

  // ---------- 模块标签（CasesPage / HistoryPage / CaseEvidence / ModulePackPage 共用）----------
  evalModAll: _('全部模块', 'All modules'),
  evalModKnowledge: _('知识库', 'Knowledge base'),
  evalModAgents: _('智能体', 'Agents'),
  evalModEmployees: _('智能体员工', 'Agent employees'),
  evalModSkills: _('技能', 'Skills'),
  evalModMcp: _('MCP', 'MCP'),
  evalModWorkflow: _('工作流', 'Workflow'),
  evalModTasks: _('任务中心', 'Task center'),
  evalModItems: _('待办事项', 'Items'),
  evalModPlatform: _('平台门禁', 'Platform gate'),
  evalModCross: _('跨模块', 'Cross-module'),
  evalModObsBusiness: _('观测·业务', 'Observability · business'),
  evalModObsSecurity: _('观测·安全', 'Observability · security'),
  evalModObsPerformance: _('观测·性能', 'Observability · performance'),
  evalModOther: _('其他', 'Other'),

  // 流类型（CasesPage / HistoryPage / ModulePackPage 共用）
  evalFlowHappy: _('基本流', 'Happy path'),
  evalFlowAlt: _('备选流', 'Alt path'),
  evalFlowNegative: _('异常流', 'Negative'),
  evalFlowBoundary: _('边界值', 'Boundary'),
  evalFlowStateMachine: _('状态机', 'State machine'),

  // ---------- DashboardPage ----------
  evalDashboardTitle: _('健康总览', 'Health overview'),
  evalDashboardHeroSub: _('先跑评测 → 再看「测什么 / 结果详情」三块信息',
    'Run eval first → then look at "what to test / result details"'),
  evalBtnRefresh: _('刷新', 'Refresh'),
  evalBtnRunSmoke: _('一键评测', 'One-click eval'),
  evalBtnRunning: _('评测中…', 'Running…'),
  evalRunStartSmoke: _('启动 smoke 评测…', 'Starting smoke eval…'),
  evalRunProgress: _('评测中 {passed}/{total} 通过',
    'Running: {passed}/{total} passed'),
  evalRunDone: _('完成：{status}', 'Done: {status}'),
  evalNoRunId: _('未返回 run_id', 'No run_id returned'),

  evalGuideEmpStrong: _('智能体员工评测', 'Agent employee eval'),
  evalGuideEmpSpan: _('雇佣 / 派发 / 审批门 / L3 wake — 独立模块页',
    'Hire / dispatch / approval gate / L3 wake — dedicated module page'),
  evalGuideWfStrong: _('工作流评测', 'Workflow eval'),
  evalGuideWfSpan: _('DAG / 步骤绑定 / outcome / L3 真跑 — 独立模块页',
    'DAG / step binding / outcome / L3 real run — dedicated module page'),
  evalGuideHistStrong: _('结果详情', 'Result details'),
  evalGuideHistSpan: _('展开入参 / 预期 / 实际 / API 步骤',
    'Expand inputs / expected / actual / API steps'),

  evalMetricHealth: _('综合健康分', 'Overall health'),
  evalMetricScenarioRate: _('场景通过率', 'Scenario pass rate'),
  evalMetricScenarioHint: _('最近 scenario run', 'Recent scenario run'),
  evalMetricTaskRate: _('任务完成率', 'Task completion'),
  evalMetricSecurity: _('安全评分', 'Security score'),
  evalMetricToolRate: _('工具成功率', 'Tool success rate'),
  evalMetricLatency: _('平均延迟', 'Avg latency'),
  evalMetricAgent: _('活跃 Agent', 'Active agents'),
  evalMetricObsThread: _('Obs 线程健康', 'Obs thread health'),
  evalMetricObsHint: _('invalid tool {rate}', 'invalid tool {rate}'),

  evalDimScore: _('维度得分', 'Dimension scores'),
  evalKeyAlert: _('关键告警', 'Key alerts'),
  evalNoAlert: _('暂无告警', 'No alerts'),

  evalAgentRank: _('Agent 排行', 'Agent ranking'),
  evalNoRank: _('暂无排行数据', 'No ranking data'),
  evalThAgent: _('Agent', 'Agent'),
  evalThTask: _('任务', 'Tasks'),
  evalThCompletion: _('完成率', 'Completion'),

  evalRecentEval: _('最近评测', 'Recent evaluations'),
  evalNoRecent: _('尚无评测记录，点「一键评测」开始',
    'No eval records yet — click "One-click eval" to start'),
  evalThName: _('名称', 'Name'),
  evalThScore: _('分数', 'Score'),
  evalThStatus: _('状态', 'Status'),

  // ---------- CasesPage ----------
  evalCasesTitle: _('用例库', 'Case library'),
  evalCasesHeroSub: _('按业界场景法：优先级 · 流类型 · 前置 / 步骤 / 预期（不只是 handler 一行）',
    'Industry scenario method: priority · flow · preconditions / steps / expected (not just one handler line)'),
  evalFilterTitle: _('筛选 · 共 {count} 条设计', 'Filter · {count} designs total'),
  evalAllLevel: _('全部层级', 'All levels'),
  evalAllFlow: _('全部流', 'All flows'),
  evalCasesHint: _(
    'L0 组件校验 · L1 模块集成 · L2 业务场景 · L3 真 LLM（需 live 门控）。\n' +
    '智能体员工 / 工作流请用左侧独立页跑包。\n' +
    'smoke 只跑 P0。',
    'L0 component · L1 module integration · L2 scenario · L3 real LLM (live gate required).\n' +
    'For employee / workflow use the dedicated pages on the left.\n' +
    'Smoke runs P0 only.'
  ),
  evalSearchPlaceholder: _('搜索 id / 名称 / 步骤 / 风险…',
    'Search id / name / step / risk…'),
  evalNoMatchCase: _(
    '没有匹配的用例。确认 Gateway 已启动且完成 v108 设计目录迁移。',
    'No matching cases. Confirm the Gateway is running and has completed the v108 design directory migration.'
  ),
  evalGroupCount: _('{count} 条', '{count} items'),

  // CaseCard 内部
  evalExpandDesign: _('展开设计', 'Expand design'),
  evalCollapseDesign: _('收起', 'Collapse'),
  evalCasePlanned: _('规划', 'Planned'),
  evalCaseDisabled: _('未启用', 'Disabled'),
  evalRole: _('角色', 'Role'),
  evalCaseRisk: _('风险', 'Risk'),
  evalCleanup: _('清理', 'Cleanup'),
  evalPreconditions: _('前置条件', 'Preconditions'),
  evalSteps: _('步骤', 'Steps'),
  evalExpected: _('预期', 'Expected'),
  evalTechInfo: _('技术信息', 'Tech info'),
  evalCaseId: _('用例 id', 'Case id'),
  evalNoHandler: _('（无，规划项）', '(none, planned)'),

  // ---------- EmployeesEvalPage ----------
  evalEmpTitle: _('智能体员工，能不能用？', 'Agent employees — usable?'),
  evalEmpHeroSub: _('两件事分开验。点开始后，下面会一步步显示干到哪了；结果留在本页。',
    'Two checks, separated. After you click start, each step shows progress; results stay on this page.'),
  evalEmpRunBoth: _('从上到下验两件事', 'Run both checks top to bottom'),
  evalEmpVerifying: _('验证中…', 'Verifying…'),

  evalEmpQ1Title: _('① 单个员工能不能干活', '① Can a single employee do work'),
  evalEmpQ1Ask: _('雇进来 → 派任务 → 该停就停 → 真的会用模型做完吗？',
    'Hire → dispatch → stop when needed → does it actually finish using the model?'),
  evalEmpQ1Meaning: _('下面每一步跑完会立刻打勾或打叉，你能看见干到哪了。',
    'Each step gets a check or cross as soon as it finishes; you see exactly where we are.'),
  evalEmpQ2Title: _('② 多组织里能不能协同', '② Can multiple organizations collaborate'),
  evalEmpQ2Ask: _('同一组织能不能互相叫醒？不同组织会不会乱派？',
    'Can same-org wake each other? Will cross-org dispatch be blocked?'),
  evalEmpQ2Meaning: _('这一项只验组织边界规则，步骤少、很快。',
    'This only checks org-boundary rules — few steps, fast.'),

  evalEmpStepHire: _('雇佣 / 暂停 / 恢复', 'Hire / pause / resume'),
  evalEmpStepHireDup: _('重复雇佣会冲突（不能乱覆盖）',
    'Duplicate hire conflicts (cannot silently overwrite)'),
  evalEmpStepLedger: _('派任务能落到任务本',
    'Dispatched task lands in the task ledger'),
  evalEmpStepPauseRejectsWake: _('暂停后不能再叫醒',
    'Cannot wake when paused'),
  evalEmpStepBusyMutex: _('忙着时不能叠着再派',
    'Cannot stack dispatch while busy'),
  evalEmpStepAlreadyDoneSkip: _('已结案不会重复派',
    'Closed task not dispatched again'),
  evalEmpStepLiveWake: _('真实叫醒一次（要 Gateway + 模型）',
    'One real wake (needs Gateway + model)'),
  evalEmpStepOrgCollab: _('同组织可协作 · 跨组织禁止 · 老板可派',
    'Same-org collab · cross-org blocked · boss can dispatch'),

  evalEmpPassHintSolo: _('可以：日常雇佣派发与门禁正常，真叫醒也有结果。',
    'OK: daily hire/dispatch/gate all normal, real wake also returned results.'),
  evalEmpFailHintSolo: _('有步骤失败：看下方打叉的那几步。',
    'Some steps failed: see the crosses below.'),
  evalEmpPassHintCollab: _('协同规则正确：同组织能协作，跨组织拦得住。',
    'Collab rules correct: same-org can collab, cross-org is blocked.'),
  evalEmpFailHintCollab: _('组织门禁有问题：看下方失败说明。',
    'Org gate has issues: see the failure note below.'),

  // ---------- WorkflowEvalPage ----------
  evalWfTitle: _('工作流，能不能用？', 'Workflow — usable?'),
  evalWfHeroSub: _('两件事分开验。点开始后，下面会一步步显示干到哪了；结果留在本页。',
    'Two checks, separated. After you click start, each step shows progress; results stay on this page.'),
  evalWfRunBoth: _('从上到下验两件事', 'Run both checks top to bottom'),
  evalWfVerifying: _('验证中…', 'Verifying…'),

  evalWfQ1Title: _('① 工作流规则能不能挡住错误', '① Can workflow rules block errors'),
  evalWfQ1Ask: _('非法图拦得住吗？失败会不会伪绿？取消/重试后账本对得上吗？',
    'Illegal DAG blocked? Failures won\'t fake-pass? Cancel/retry ledger matches?'),
  evalWfQ1Meaning: _('下面每一步跑完立刻打勾或打叉，都是账本/控制面，不调真模型。',
    'Each step gets a check/cross right after finish. These are ledger/control-plane only — no real models.'),
  evalWfQ2Title: _('② 真实跑任务能不能跑完', '② Can a real run complete'),
  evalWfQ2Ask: _('发布 → 开跑 → 工人真用模型写报告 → 主任务有终态？',
    'Publish → run → workers use real models to write reports → main task reaches a terminal state?'),
  evalWfQ2Meaning: _('这一项走 Gateway HTTP，要开真模型；禁止 inject 冒充结果。',
    'This goes through Gateway HTTP and needs a real model. No inject spoofing allowed.'),

  evalWfStepPublishCycle: _('有环的图不能发布', 'DAG with cycles cannot be published'),
  evalWfStepStepBinding: _('步骤绑定工人档案', 'Step bound to worker profile'),
  evalWfStepInheritAgent: _('省略工具时继承 Agent', 'Inherit Agent when tools omitted'),
  evalWfStepParamRender: _('参数渲染进指令', 'Params rendered into instruction'),
  evalWfStepFailHalts: _('上游失败下游不伪绿', 'Downstream won\'t fake-pass when upstream fails'),
  evalWfStepCancelRun: _('取消后运行停干净', 'Run fully stopped after cancel'),
  evalWfStepRetryUnblocks: _('重试成功后下游解阻', 'Downstream unblocks after retry succeeds'),
  evalWfStepOfficialOutcome: _('官方 outcome 能 rollup', 'Official outcome rolls up'),
  evalWfStepLiveRun: _('真实开跑两条工人步骤（要 Gateway + 模型）',
    'Run two worker steps for real (needs Gateway + model)'),

  evalWfPassHintRules: _('可以：定义、绑定、失败、取消、重试、outcome 规则正常。',
    'OK: definition, binding, failure, cancel, retry, outcome rules all normal.'),
  evalWfFailHintRules: _('有步骤失败：看下方打叉的那几步。',
    'Some steps failed: see the crosses below.'),
  evalWfPassHintLive: _('可以：真开跑且至少有工人产出报告，主任务到终态或两步都报了。',
    'OK: real run with at least one worker report; main task reached a terminal state or both steps reported.'),
  evalWfFailHintLive: _('真跑失败或超时：看模型/Gateway/工人是否卡住。',
    'Real run failed or timed out — check model/Gateway/worker hangups.'),

  // ---------- 共用 verdict / step / run 文案（员工页 & 工作流页）----------
  evalVerdictPass: _('可以', 'OK'),
  evalVerdictFail: _('不行', 'Not OK'),
  evalVerdictPartial: _('部分可以', 'Partially OK'),
  evalVerdictRunning: _('验证中…', 'Verifying…'),
  evalVerdictUnknown: _('尚未验证', 'Not verified yet'),

  evalRunPassStep: _('通过', 'Pass'),
  evalRunSkipped: _('已跳过（例如未开真模型）', 'Skipped (e.g. real model not enabled)'),
  evalRunFail: _('失败', 'Failed'),

  evalRunNoSteps: _('「{title}」没有可跑步骤。请确认 Gateway 已更新到最新评测目录。',
    'No runnable steps for "{title}". Confirm the Gateway has been updated to the latest eval directory.'),
  evalRunNoStepsOrg: _('「{title}」没有可跑步骤。请确认 Gateway 已更新到最新评测目录（含组织协同用例）。',
    'No runnable steps for "{title}". Confirm the Gateway has been updated to the latest eval directory (incl. org-collab cases).'),
  evalRunVerifying: _('正在验证：{title}', 'Verifying: {title}'),
  evalRunProgressStep: _('{title} · 第 {idx}/{total} 步：{label}',
    '{title} · step {idx}/{total}: {label}'),
  evalRunPartialSummary: _('{title}：{passed} 通过，{failed} 失败，{skipped} 跳过。看下方打叉步骤。',
    '{title}: {passed} pass, {failed} fail, {skipped} skipped. See the crosses below.'),

  evalRunNameEmp: _('员工验证 · {label}', 'Employee eval · {label}'),
  evalRunNameWf: _('工作流验证 · {label}', 'Workflow eval · {label}'),

  evalCurrentLabel: _('正在跑：{label}', 'Running: {label}'),
  evalBtnRunThis: _('只验这一项', 'Run this only'),
  evalBtnRunningThis: _('本项验证中…', 'This item verifying…'),

  evalQAsk: _('要问：', 'To ask:'),
  evalHowToRead: _('怎么读', 'How to read'),
  evalHowToReadPass: _('可以：这项所有步骤都过了（跳过也算合理）。',
    'OK: all steps passed (skipped is reasonable too).'),
  evalHowToReadPartialEmp: _('部分可以：有过有挂——常见是前面账本过了，最后「真实叫醒」因模型/网络挂了。',
    'Partially OK: some pass, some fail — usually the ledger steps pass but the last "real wake" fails due to model/network.'),
  evalHowToReadPartialWf: _('部分可以：常见是①账本过了，②「真实跑任务」因模型/网络挂了。',
    'Partially OK: usually ① ledger passes, ② "real run" fails due to model/network.'),
  evalHowToReadFail: _('不行：核心步骤失败，先别当生产可用。',
    'Not OK: core steps failed — do not treat as production-ready yet.'),
  evalHowToReadBottom: _('结果和失败原因都在本页，不用跳到别的菜单。',
    'Results and failure reasons stay on this page — no need to jump to other menus.'),
  evalMissingHint: _(' · 目录里还没有这条，请升级 Gateway',
    ' · not yet in the directory — please upgrade Gateway'),

  // ---------- HistoryPage ----------
  evalHistoryTitle: _('结果与详情', 'Results & details'),
  evalHistoryHeroSub: _('按模块看通过/失败与证据；历史记录在本页底部',
    'Pass/fail & evidence by module; run history at the bottom of this page'),
  evalBtnRefreshList: _('刷新列表', 'Refresh list'),
  evalBtnCompare: _('对比选中', 'Compare selected'),

  evalRecordsTitle: _('评测记录', 'Eval records'),
  evalRecordsHint: _('切换历史 run；勾选两条可对比。总耗时见「耗时」列。',
    'Switch historical runs; tick two to compare. Total duration in the Duration column.'),
  evalNoRecords: _('还没有评测记录。请先到「健康总览」点「一键评测」。',
    'No eval records yet. First go to "Health overview" and click "One-click eval".'),
  evalLoadingRecords: _('加载中…', 'Loading…'),

  evalThMode: _('模式', 'Mode'),
  evalThPassed: _('通过', 'Passed'),
  evalThDuration: _('耗时', 'Duration'),
  evalViewBtn: _('查看', 'View'),
  evalCurrentBtn: _('当前', 'Current'),

  evalModeSmoke: _('冒烟 L1', 'Smoke L1'),
  evalModeScenario: _('全场景', 'Full scenario'),
  evalModeFull: _('全量', 'Full'),

  evalDetailByModule: _('按模块看结果 · {name}', 'Results by module · {name}'),
  evalDetailSummaryPassFail: _('{statusLabel} · 合计通过 {passed}/{total}{failedPart}{allPassPart} · 本次总耗时 {duration}',
    '{statusLabel} · pass {passed}/{total}{failedPart}{allPassPart} · total duration {duration}'),
  evalFailedPart: _(' · 失败 {failed}', ' · fail {failed}'),
  evalAllPassPart: _(' · 全部通过', ' · all pass'),

  evalNoCaseDetail: _('该 run 没有 case 明细（可能仍在跑，或 adapter 未透传）。',
    'This run has no case details (may still be running, or adapter did not forward them).'),

  evalModuleChipAll: _('全部模块', 'All modules'),
  evalChipPassedPart: _('{passed}/{total} 通过', '{passed}/{total} pass'),
  evalChipFailedPart: _(' · {failed} 失败', ' · {failed} fail'),
  evalGroupAllPass: _(' · 本组全过', ' · all pass in group'),

  evalStatusAll: _('全部状态 ({count})', 'All ({count})'),
  evalStatusFailOnly: _('仅失败 ({count})', 'Fail only ({count})'),
  evalStatusPassOnly: _('仅通过 ({count})', 'Pass only ({count})'),
  evalNoFilteredCase: _('当前筛选下没有用例。', 'No cases in current filter.'),

  evalGroupHeader: _('{label} · {passed}/{total} 通过{failPart}{allOkPart}',
    '{label} · {passed}/{total} pass{failPart}{allOkPart}'),

  evalRawJsonTitle: _('原始 JSON（完整）', 'Raw JSON (full)'),
  evalCompareTitle: _('对比结果', 'Comparison result'),

  evalNoDetailTitle: _('按模块看结果', 'Results by module'),
  evalNoDetailHintLoading: _('正在加载评测记录…', 'Loading eval records…'),
  evalNoDetailHintClick: _('请到本页底部「评测记录」点「查看」。',
    'Go to "Eval records" at the bottom of this page and click "View".'),

  // status 中文
  evalStatusPassZh: _('通过', 'Pass'),
  evalStatusFailZh: _('失败', 'Fail'),
  evalStatusUnknownZh: _('未知', 'Unknown'),

  // CaseEvidence 内部（HistoryPage / CaseEvidence 共享）
  evalCaseEvidenceToggleExpand: _('展开证据', 'Expand evidence'),
  evalDesignStepsTitle: _('设计步骤（对照）', 'Design steps (reference)'),
  evalWhatToTestLabel: _('测什么：', 'What to test: '),
  evalResultNoteLabel: _('结果说明：', 'Result note: '),
  evalRuntimeContractTitle: _('运行时合同（提示词 / 工具 / 任务时间线）',
    'Runtime contract (prompts / tools / task timeline)'),
  evalRuntimeContractLiveLlm: _('真 LLM / Gateway', 'Real LLM / Gateway'),
  evalRuntimeContractLedger: _('账本 / 无 LLM', 'Ledger / no LLM'),
  evalTaskTimeline: _('任务状态时间线', 'Task status timeline'),
  evalCallStepsTitle: _('调用步骤', 'Call steps'),
  evalCodeStep: _('步骤 {idx}', 'Step {idx}'),
  evalCodeInputs: _('入参 ', 'Inputs '),
  evalCodeResult: _('结果 ', 'Result '),
  evalCheckPointsTitle: _('检查点（入参 / 预期 / 实际）',
    'Checkpoints (inputs / expected / actual)'),
  evalThCheckPoint: _('检查点', 'Checkpoint'),
  evalThResult: _('结果', 'Result'),
  evalThApi: _('调用的 API', 'Called API'),
  evalThInputs: _('入参', 'Inputs'),
  evalThExpected: _('预期', 'Expected'),
  evalThActual: _('实际', 'Actual'),
  evalNoAssertDetail: _('本条无检查点明细（多为观测指标）。',
    'No checkpoint detail for this case (mostly observability metrics).'),
  evalTechInfoTitle: _('技术信息（handler / 隔离 / 指标）',
    'Tech info (handler / isolation / metrics)'),
  evalHandlerLabel: _('handler', 'handler'),
  evalMockLabel: _('Mock', 'Mock'),
  evalIsolationLabel: _('隔离', 'Isolation'),
  evalThElapsed: _('耗时', 'Duration'),
  evalCaseScoreLabel: _('得分', 'Score'),
  evalCheckPointsShort: _('检查点', 'Checkpoints'),
  evalRuntimeContractHeader: _('运行时合同', 'Runtime contract'),
  evalCallStepHeader: _('调用步骤', 'Call step'),

  // ---------- BusinessPage ----------
  evalBizTitle: _('业务质量', 'Business quality'),
  evalBizHeroSub: _('场景回归结果与观测指标', 'Scenario regression results & observability metrics'),
  evalBizTabScenarios: _('业务场景', 'Scenarios'),
  evalBizTabTasks: _('任务质量', 'Task quality'),
  evalBizTabTools: _('工具可靠性', 'Tool reliability'),
  evalBizTabKnowledge: _('知识库', 'Knowledge base'),
  evalBizTabIntervention: _('人工介入', 'Human intervention'),

  evalBizScenarioPassRate: _('场景通过率', 'Scenario pass rate'),
  evalBizScenarioHint: _(
    '这里是<strong>最近一次场景 run 的执行结果</strong>（不是用例定义）。\n' +
    '要看全部案例清单请打开左侧「用例库」；要看断言证据请打开「评测历史 → 详情」。\n' +
    '当前结果来自 <code>{runId}</code>',
    'This is the <strong>execution result of the latest scenario run</strong> (not the case definition).\n' +
    'To see all cases open the "Case library" on the left; to see assertion evidence open "Eval history → Details".\n' +
    'Current result from <code>{runId}</code>'
  ),
  evalBizScenarioHintNoRun: _(
    '这里是<strong>最近一次场景 run 的执行结果</strong>（不是用例定义）。\n' +
    '要看全部案例清单请打开左侧「用例库」；要看断言证据请打开「评测历史 → 详情」。',
    'This is the <strong>execution result of the latest scenario run</strong> (not the case definition).\n' +
    'To see all cases open the "Case library" on the left; to see assertion evidence open "Eval history → Details".'
  ),
  evalBizNoScenario: _(
    '尚无场景结果。请在总览页执行「一键评测」，或到「用例库」确认 Gateway 已连上。',
    'No scenario results yet. Run "One-click eval" on the overview page, or confirm Gateway is connected in the Case library.'
  ),
  evalBizThScenario: _('场景', 'Scenario'),
  evalBizThStatus: _('状态', 'Status'),
  evalBizThDetail: _('详情', 'Detail'),

  // ---------- SecurityPage ----------
  evalSecTitle: _('安全中心', 'Security center'),
  evalSecHeroSub: _('配置漏洞、泄露扫描与权限审计', 'Config vulns, leak scan & permission audit'),
  evalSecScanBtn: _('立即扫描', 'Scan now'),
  evalSecSummary: _('安全摘要', 'Security summary'),
  evalSecVulns: _('漏洞', 'Vulnerabilities'),
  evalSecLeaks: _('数据泄露', 'Data leaks'),

  // ---------- PerformancePage ----------
  evalPerfTitle: _('性能基准', 'Performance baseline'),
  evalPerfHeroSub: _('延迟分布与错误率（压测引擎未接入）',
    'Latency distribution & error rate (load-test engine not yet wired)'),
  evalPerfSummary: _('性能摘要', 'Performance summary'),
  evalPerfLatency: _('延迟分布', 'Latency distribution'),
  evalPerfErrors: _('错误统计', 'Error stats'),

  // ---------- SchedulePage ----------
  evalSchedTitle: _('评测计划', 'Eval schedule'),
  evalSchedHeroSub: _('计划表已落库；调度守护进程后续接入',
    'Schedule table persisted; scheduler daemon to be wired later'),
  evalSchedDefaultName: _('每日 smoke', 'Daily smoke'),
  evalSchedCreateBtn: _('创建', 'Create'),
  evalSchedThEnabled: _('启用', 'Enabled'),
  evalSchedYes: _('是', 'Yes'),
  evalSchedNo: _('否', 'No'),
  evalSchedToggle: _('切换', 'Toggle'),

  // ---------- AlertPage ----------
  evalAlertTitle: _('告警配置', 'Alert config'),
  evalAlertHeroSub: _('规则匹配后写入面板告警历史（本轮无飞书通道）',
    'Rules are written to panel alert history (no Feishu channel this round)'),
  evalAlertDefaultName: _('场景通过率过低', 'Scenario pass rate too low'),
  evalAlertNewRuleBtn: _('新建规则', 'New rule'),
  evalAlertThMetric: _('指标', 'Metric'),
  evalAlertThCondition: _('条件', 'Condition'),
  evalAlertHistory: _('告警历史', 'Alert history'),
  evalAlertNoHistory: _('暂无触发记录', 'No triggered records yet'),
  evalAlertThLevel: _('级别', 'Level'),
  evalAlertThMessage: _('消息', 'Message'),
  evalAlertThRun: _('run', 'run'),

  // ---------- ModulePackPage ----------
  evalPackRefreshCases: _('刷新用例', 'Refresh cases'),
  evalPackRunLedger: _('跑账本（无 LLM）', 'Run ledger (no LLM)'),
  evalPackRunLedgerLabel: _('账本包', 'Ledger pack'),
  evalPackRunSelected: _('跑选中（{count}）', 'Run selected ({count})'),
  evalPackRunSelectedLabel: _('本模块选中', 'Selected in this module'),
  evalPackRunStart: _('启动 {label}（{count} 条）…', 'Starting {label} ({count})…'),
  evalPackNoRunnable: _('没有可跑用例（请确认 Gateway 已连上且用例已启用）',
    'No runnable cases (confirm Gateway is connected and cases are enabled)'),

  evalPackMetricCases: _('本模块用例', 'Module cases'),
  evalPackMetricCasesHint: _('筛选后 {filtered}', '{filtered} after filter'),
  evalPackMetricLedger: _('账本 / L1–L2', 'Ledger / L1–L2'),
  evalPackMetricLedgerHint: _('确定性对账', 'Deterministic ledger check'),
  evalPackMetricLive: _('L3 真跑', 'L3 real run'),
  evalPackMetricLiveHint: _('需 gogo_EVAL_LIVE_LLM=1', 'Requires gogo_EVAL_LIVE_LLM=1'),
  evalPackMetricCoverage: _('体系能力', 'Capability coverage'),
  evalPackMetricCoverageHint: _('已覆盖 · 部分 {partial} · 规划 {planned}',
    'Implemented · partial {partial} · planned {planned}'),

  evalPackArchError: _('体系矩阵：{msg}', 'Capability matrix: {msg}'),
  evalPackArchTitle: _('评测体系 · 阶段与能力', 'Eval system · stages & capabilities'),
  evalPackThCapability: _('能力', 'Capability'),
  evalPackThDimension: _('维度', 'Dimension'),
  evalPackThStage: _('阶段', 'Stage'),
  evalPackThCoverage: _('覆盖', 'Coverage'),
  evalPackThCaseIds: _('用例', 'Cases'),
  evalPackSelectedCount: _('{count} 条', '{count}'),
  evalPackCapabilityTitle: _('选中该能力绑定的用例', 'Select cases bound to this capability'),

  // DIM_LABELS / COVERAGE_LABELS / FLOW_LABELS 走词典
  evalDimFlow: _('流转', 'Flow'),
  evalDimState: _('状态', 'State'),
  evalDimRetry: _('重试', 'Retry'),
  evalDimSafety: _('安全', 'Safety'),
  evalDimIsolation: _('隔离', 'Isolation'),
  evalDimOutcome: _('产出', 'Outcome'),
  evalCovImplemented: _('已覆盖', 'Implemented'),
  evalCovPartial: _('部分', 'Partial'),
  evalCovPlanned: _('规划中', 'Planned'),

  evalPackFilterTitle: _('筛选与选择', 'Filter & select'),
  evalPackSelectAllRunnable: _('全选可跑', 'Select all runnable'),
  evalPackSelectLedgerOnly: _('仅账本', 'Ledger only'),
  evalPackSelectL3Only: _('仅 L3', 'L3 only'),
  evalPackClearSelection: _('清空（默认跑全部可跑）',
    'Clear (default runs all runnable)'),
  evalPackOpenHistory: _('打开结果详情 →', 'Open result details →'),

  evalPackCasesTitle: _('用例清单 · {count}', 'Case list · {count}'),
  evalPackNoCases: _('本模块暂无用例。确认 Gateway 已迁移到最新 schema。',
    'No cases for this module. Confirm Gateway has migrated to the latest schema.'),
  evalPackThCase: _('用例', 'Case'),
  evalPackThLevel: _('层级', 'Level'),
  evalPackThFlow: _('流', 'Flow'),
  evalPackThDesc: _('说明', 'Description'),
  evalPackTblL3Tag: _('真 LLM', 'Real LLM'),
  evalPackTblLedgerTag: _('账本', 'Ledger'),
  evalPackTblSelectRun: _('选中后「跑选中」只跑勾选项',
    'After selecting, "Run selected" only runs the ticked ones'),
  evalPackTblNoHandler: _('无 handler / 未启用', 'No handler / disabled'),

  evalPackResultTitle: _('本次结果 · {count}', 'This run · {count}'),
  evalPackRecentRuns: _('最近评测 run', 'Recent eval runs'),
  evalPackThRunName: _('名称', 'Name'),
  evalPackThRunStatus: _('状态', 'Status'),
  evalPackThRunTime: _('时间', 'Time'),

  // ---------- 错误/通用（api/evalApi.ts + hooks/useAsync.ts 共用，模块级 t()）----------
  evalErrEvalTimeout: _('评测超时', 'Eval timed out'),
  evalErrLoadFailed: _('加载失败', 'Failed to load'),
  evalEvalSmokeName: _('一键评测 smoke', 'One-click eval smoke'),

  // ---------- 其他零散 ----------
  evalLoading: _('加载中…', 'Loading…'),
  evalDashHintLoadRecent: _('先跑评测 → 再看「测什么 / 结果详情」三块信息',
    'Run eval first → then look at "what to test / result details"'),
}
