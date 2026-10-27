import { _ } from '../helper.js'

/**
 * index.html 静态壳层文案：启动引导三屏、回收站、新建项目弹窗。
 * 这些节点由浏览器直接解析，脚本通过 data-i18n* 标记回填（见 lib/i18n.js 的
 * applyStaticI18n），内联脚本用全局桥 window.gogoT 取文案。
 * 键名即 t('boot.xxx')。
 */
export default {
  // ── 登录 / 引导覆盖层 ──
  loginTitle: _('登录以同步你的工作流', 'Sign in to sync your workflows'),
  loginSub: (
    _('登录以在所有设备间同步代理、群组、设置和上下文。', 'Sign in to sync agents, teams, settings and context across your devices.')
  ),
  passwordLogin: _('账号密码登录', 'Sign in with a password'),
  selfHostLink: _('连接到你自己的 GoGo 服务实例', 'Connect to your own GoGo instance'),
  selfHostToast: _('连接自托管实例（演示）', 'Connect a self-hosted instance (demo)'),
  onbTitle: _('登录以实现跨设备同步', 'Sign in to sync across devices'),
  freePlan: _('免费版', 'Free plan'),
  pickAccountToast: _('选择账号 CharonZou（演示）', 'Choose the CharonZou account (demo)'),
  readyTitle: _('准备好了就开始吧', 'You are all set'),
  readySub: (
    _('我是你的助理管家。随时陪你思考、创作，帮你管理助理与群组', 'Your assistant is ready — think and create with it, and let it look after your staff and teams')
  ),
  feat1Title: _('创造 · 灵感即刻成真', 'Create · ideas turn into things'),
  feat1Body: _('想到就做到。一句话，助理就能上线', 'One sentence is enough to put an assistant to work'),
  feat2Title: _('协作 · 与智能共进', 'Collaborate · grow with intelligence'),
  feat2Body: (
    _('在这里，人与助理一起工作。让生产力以最自然的方式流动', 'People and assistants work side by side, so productivity flows the natural way')
  ),
  feat3Title: _('进化 · 越用越懂你', 'Evolve · it learns as you use it'),
  feat3Body: (
    _('每次互动都让助理更懂你。不止响应，更在理解', 'Every exchange makes the assistant understand you better — not just replying, but getting it')
  ),
  back: _('返回', 'Back'),
  next: _('下一步', 'Next'),
  start: _('开始', 'Get started'),

  // ── 回收站浮层 ──
  trashTitle: _('回收站', 'Trash'),
  trashSub: (
    _('归档的会话保留在这里，可以恢复到原工作区，也可以彻底删除。', 'Archived sessions stay here. Restore them to their workspace or delete them for good.')
  ),
  searchSessions: (_('搜索会话...', 'Search sessions...')),
  refresh: _('刷新', 'Refresh'),
  emptyTrash: _('清空回收站', 'Empty trash'),
  trashEmpty: _('暂无归档会话', 'No archived sessions'),
  trashEmptyHint: _('归档后的会话会显示在这里。', 'Archived sessions show up here.'),
  trashEmptyHintLong: (
    _('归档后的会话会显示在这里，可恢复或彻底删除。', 'Archived sessions appear here — restore them or delete them for good.')
  ),
  restore: _('恢复', 'Restore'),
  deleteForever: _('彻底删除', 'Delete forever'),

  // ── 新建项目弹窗 ──
  createProject: _('创建项目', 'Create project'),
  projectName: _('项目名称', 'Project name'),
  projectNamePlaceholder: _('输入项目名称', 'Enter a project name'),
  localWorkDir: _('当前设备本地工作目录', 'Local working folder on this device'),
  addLocalFolder: _('添加本地文件夹', 'Add a local folder'),
  cancel: _('取消', 'Cancel'),
  pickFolderHint: _('请选择本地文件夹（开发模式占位）', 'Pick a local folder (dev placeholder)'),
  projectNameRequired: _('请输入项目名称', 'Enter a project name'),
  createdProjectHint: (_('创建项目：{name}（开发模式占位）', 'Created project: {name} (dev placeholder)')),
}
