import { _ } from '../helper.js'

/**
 * 外壳与侧栏无障碍/提示文案（components/shell-aside.js、sidebar.js、global-assistant）
 * 键名即 t('shell.xxx')。
 */
export default {
  navMain: _('主导航', 'Main navigation', '主導航'),
  navProduct: _('产品导航', 'Product navigation'),
  navMore: _('更多导航', 'More navigation'),
  sessionType: _('会话类型', 'Session type'),
  collapseSidebar: _('折叠侧栏', 'Collapse sidebar'),
  expandSidebar: _('点击展开侧栏', 'Click to expand the sidebar'),
  assetsCenter: _('资产中心', 'Asset center'),
  permissionSwitched: _('本会话已切换为「{name}」', 'This session switched to “{name}”'),
  modelAutoMode: _('自动', 'Auto'),
  sessionNotifyTitle: _('会话通知', 'Session notifications'),
  backToSessions: _('返回会话列表', 'Back to sessions'),
  messageOps: _('消息操作', 'Message actions'),
  copyMessage: _('复制消息', 'Copy message'),
  regenerate: _('重新生成', 'Regenerate'),

  // ── 侧栏折叠钮（折叠态与全局兜底展开钮）+ 面板侧栏提示 ──
  expandSidebarBtn: _('展开侧栏', 'Expand sidebar'),
  expandPanelSidebar: _('点击展开侧边栏', 'Click to expand the sidebar'),
  pageGuideTip: _('当前页使用指南', 'Guide for the current page'),

  // ── 桌面（Tauri）无边框窗口细栏：components 见 lib/tauri-titlebar.js ──
  windowChrome: _('窗口', 'Window'),
  dragWindowHint: _('拖动窗口 · 双击最大化', 'Drag the window · double-click to maximize'),
  guideWithHotkey: _('使用指南（?）', 'Guide (?)'),
  windowMinimize: _('最小化', 'Minimize'),
  windowMaximize: _('最大化', 'Maximize'),

  // ── 小V 边缘助手 chrome（产品名「小V」在英文文案中保留）──
  openAssistant: _('打开小V', 'Open 小V'),
  gotIt: _('知道了', 'Got it'),
  openAssistantAria: _('打开小V 协助', 'Open 小V assistant'),
  assistantTip: _('小V 协助', '小V assistant'),
  assistantTipOn: _('协助 · {name}', 'Assisting · {name}'),
  assistantFabTip: _('小V 协助（{shortcut}）· 右键可隐藏', '小V assistant ({shortcut}) · right-click to hide'),
  assistantPendingBadge: _('{count} 项待处理', '{count} pending'),
  coachEmployeesTitle: _('小V 可以协助员工', '小V can help with staff'),
  coachEmployeesBody: (
    _('选中员工后，让小V 派活、查进度或改职责。', 'Select an employee, then ask 小V to assign work, check progress or edit their role.')
  ),
  coachWorkflowTitle: _('小V 可以协助工作流', '小V can help with workflows'),
  coachWorkflowBody: (
    _('打开工作流后，让小V 改参数、排查问题或直接运行。', 'Open a workflow and let 小V edit parameters, debug issues or run it.')
  ),
  coachKnowledgeTitle: _('小V 可以协助知识库', '小V can help with knowledge bases'),
  coachKnowledgeBody: (
    _('建库、检索、整理内容，都可以直接跟小V 说。', 'Create a library, search or tidy notes — just tell 小V.')
  ),
  coachItemsTitle: _('小V 可以协助事项', '小V can help with items'),
  coachItemsBody: (
    _('记待办、派给员工、跟进进度，点右侧打开小V。', 'Log to-dos, assign them to staff and follow up — open 小V on the right.')
  ),
  coachTasksTitle: _('小V 可以协助任务', '小V can help with tasks'),
  coachTasksBody: (
    _('问卡点、催办、看谁在忙，交给右侧小V。', 'Ask what is blocked, nudge owners or see who is busy — 小V is on the right.')
  ),
  coachSettingsTitle: _('小V 可以协助设置', '小V can help with settings'),
  coachSettingsBody: (
    _('改模型、外观或其它配置，用白话跟小V 说即可。', 'Change models, appearance or other config in plain words with 小V.')
  ),
  coachChatTitle: _('小V 在侧边随时待命', '小V is standing by at the edge'),
  coachChatBody: (
    _('不想打断主对话时，用右侧小V 问进度或管平台。', 'When you would rather not interrupt the main chat, use 小V on the right to check progress or manage the platform.')
  ),
  coachHomeTitle: _('小V 在右侧协助你', '小V is ready on the right'),
  coachHomeBody: (
    _('点边缘「小V」打开：问进度、建事项、管员工与知识库。', 'Click the “小V” tab at the edge: ask about progress, create items, manage staff and knowledge bases.')
  ),

  // ── 左下角身份卡（components/shell-account.js、lib/account-session.js）──
  accountUser: _('用户', 'User'),
  accountSyncing: _('同步中…', 'Syncing…'),
  accountNotLoaded: _('未加载', 'Not loaded'),
  accountSyncIdentity: _('正在同步身份', 'Syncing your identity'),
  accountSignedIn: _('已登录', 'Signed in'),
  accountLocalAdmin: _('本机免登 · 管理员', 'Local sign-in · Admin'),
  accountLocal: _('本机免登', 'Local sign-in'),
  accountRetrySync: _('点击重试同步身份', 'Click to retry identity sync'),
  accountIdentityNotSynced: _('身份未同步', 'Identity not synced'),
  accountAdminPill: _('管理员', 'Admin'),
  accountUserPill: _('用户', 'User'),
  accountSignedInPill: _('已登录', 'Signed in'),
  accountLocalPill: _('本机', 'Local'),
  accountSwitchUser: _('切换用户', 'Switch user'),
  accountSignOut: _('退出账号', 'Sign out'),
  accountEditProfile: _('编辑资料', 'Edit profile'),
  accountSettings: _('设置', 'Settings'),
  accountUsersPermissions: _('用户权限', 'Users & permissions'),
  accountLocalNote: (
    _('本机默认免登为本地管理员。切换用户后，会话与数据按账号隔离。', 'This machine signs you in as the local admin by default. After switching users, sessions and data stay separated per account.')
  ),
  accountSignedOutToast: _('已退出，恢复本机管理员', 'Signed out; the local admin is restored'),
}
