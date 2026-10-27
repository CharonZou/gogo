/**
 * 插件页 — 本机 DSH 插件（bundle） + GoGo 项目内置工具
 * 数据源：Gateway /api/plugins（读本机 dsh profile）+ /api/tools/metadata（27 个内置工具）
 * deepseek 内置核心（@deepseek-ai/*）不展示，只保留实际安装/引用的插件。
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import {
  bindDescTranslate,
  closeDrawer,
  descTranslateButton,
  esc,
  looksLikeChinese,
  openDrawer,
  selectHtml,
} from './expert-center-shared.js'

const SOURCE_LABEL = {
  npm: 'npm',
  file: '本地打包',
  link: '目录链接',
  github: 'GitHub',
  workspace: '工作区',
  builtin: '内置核心',
  'gogo-tool': 'GoGo 内置',
  unknown: '未知来源',
}

const SOURCE_OPTS = [
  { key: 'gogo-tool', label: 'GoGo 内置' },
  { key: 'npm', label: 'npm' },
  { key: 'file', label: '本地打包' },
  { key: 'link', label: '目录链接' },
  { key: 'github', label: 'GitHub' },
]
const SORT_OPTS = [
  { key: 'group', label: '分组' },
  { key: 'name', label: '名称' },
  { key: 'source', label: '来源' },
  { key: 'enabled', label: '加载状态' },
]

/** 插件默认头像：参考图 PNG（蓝色实心拼图块，透明底） */
const PLUGIN_PUZZLE_ICON = `<img class="plugin-puzzle-img" src="/plugin-puzzle.png" alt="" aria-hidden="true" />`

function pluginIconHtml(name) {
  return `<span class="skill-card-icon plugin-card-icon plugin-puzzle-icon" title="${esc(name || '')}">${PLUGIN_PUZZLE_ICON}</span>`
}
function sourceLabel(src) {
  return SOURCE_LABEL[src] || SOURCE_LABEL.unknown
}

function filterPlugins(list, state) {
  const q = state.filter.trim().toLowerCase()
  return list.filter((p) => {
    if (q && !`${p.name} ${p.description || ''} ${p.author || ''}`.toLowerCase().includes(q)) return false
    if (state.source && p.source !== state.source) return false
    if (state.sort === 'enabled' && state.enabledOnly !== 'all') {
      if (state.enabledOnly === 'enabled' && !p.enabled) return false
      if (state.enabledOnly === 'disabled' && p.enabled) return false
    }
    return true
  })
}

function sortPlugins(list, sort) {
  const arr = [...list]
  const isTool = (p) => p.source === 'gogo-tool'
  if (sort === 'source') arr.sort((a, b) => (a.source || '').localeCompare(b.source || ''))
  else if (sort === 'enabled') arr.sort((a, b) => Number(b.enabled) - Number(a.enabled))
  else if (sort === 'group') arr.sort((a, b) => Number(isTool(a)) - Number(isTool(b)) || String(a.name).localeCompare(String(b.name)))
  else arr.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return arr
}

function renderPluginCard(plugin) {
  const name = esc(plugin.name)
  const desc = esc((plugin.description || '').trim())
  const enabled = plugin.enabled
  const isTool = plugin.source === 'gogo-tool'
  const version = esc(isTool ? '内置' : plugin.version || '—')
  const badge = isTool
    ? `<div class="plugin-card-badge is-on">GoGo 内置工具</div>`
    : plugin.source === 'builtin'
      ? `<div class="plugin-card-badge is-on">内置核心</div>`
      : `<div class="plugin-card-badge ${enabled ? 'is-on' : 'is-off'}">${enabled ? '已在 profile 加载' : '未在 bundles 清单'}</div>`
  return `
    <article class="skill-card ec-skill-card plugin-card" data-plugin="${name}" tabindex="0">
      <div class="skill-card-main">
        <div class="skill-card-head">
          ${pluginIconHtml(plugin.name)}
          <strong class="skill-card-name">${name}</strong>
        </div>
        <div class="skill-card-desc-row">
          <p class="skill-card-desc">${desc || '<em class="skill-card-desc-empty">暂无描述</em>'}</p>
          ${desc && !looksLikeChinese(desc) ? descTranslateButton() : ''}
        </div>
        <div class="ec-card-meta">
          <span>${version}</span>
          <span>${esc(sourceLabel(plugin.source))}</span>
          <span>${esc(isTool ? (plugin.tool_type_label || plugin.tool_type || '工具') : plugin.profile)}</span>
        </div>
        ${badge}
      </div>
    </article>`
}

function renderList(page) {
  const list = page._pluginState
  const body = page.querySelector('#plugin-list-body')
  if (!body) return
  const filtered = sortPlugins(filterPlugins(list.plugins, list), list.sort)
  list.visible = filtered
  body.innerHTML = filtered.length
    ? `<div class="skills-list-grid">${filtered.map(renderPluginCard).join('')}</div>`
    : `<div class="ec-empty-tip">未找到匹配的插件</div>`
  body.querySelectorAll('.plugin-card').forEach((card) => {
    const pname = card.dataset.plugin
    card.addEventListener('click', () => openPluginDetailDrawer(page, pname))
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openPluginDetailDrawer(page, pname)
      }
    })
    const tlBtn = card.querySelector('[data-desc-translate]')
    if (tlBtn) {
      const descEl = card.querySelector('.skill-card-desc')
      bindDescTranslate(descEl, tlBtn)
    }
  })
}

async function loadPlugins(page, { force = false } = {}) {
  const list = page._pluginState
  const statusEl = page.querySelector('#plugin-list-status')
  if (statusEl) statusEl.textContent = '加载中…'
  try {
    // dsh 插件（内置 291 + profile 已装 12，gogo 项目内 plugins/dsh）+ GoGo 内置工具
    const [plugins, toolsMeta] = await Promise.all([
      api.listPlugins(),
      api.getToolsMetadata().catch(() => null),
    ])
    const dshPlugins = Array.isArray(plugins) ? plugins : []
    const tools = ((toolsMeta?.tools) || []).map((t) => ({
      name: String(t.name || ''),
      description: String(t.description || '').trim(),
      version: '',
      author: '',
      license: '',
      homepage: '',
      source: 'gogo-tool',
      source_detail: 'GoGo 项目内置工具（gogo/tools）',
      enabled: true,
      profile: 'gogo',
      path: '',
      tool_type: String(t.tool_type || ''),
      tool_type_label: String(t.tool_type_label || ''),
    }))
    list.plugins = [...dshPlugins, ...tools]
    list.error = ''
    if (statusEl) statusEl.textContent = `共 ${list.plugins.length} 项（插件 ${dshPlugins.length} + 内置工具 ${tools.length}）`
    renderList(page)
  } catch (e) {
    list.error = String(e?.message || e)
    if (statusEl) statusEl.textContent = '加载失败'
    const body = page.querySelector('#plugin-list-body')
    if (body) body.innerHTML = `<div class="ec-empty-tip" style="color:var(--error)">加载失败：${esc(list.error)}</div>`
  }
}

function openPluginDetailDrawer(page, pname) {
  const plugin = page._pluginState.plugins.find((p) => p.name === pname)
  if (!plugin) return
  const enabled = plugin.enabled
  const desc = plugin.description || ''
  const isTool = plugin.source === 'gogo-tool'
  const statusText = isTool
    ? 'GoGo 项目内置工具，运行时直接可用'
    : enabled
      ? '在 profile 的 bundles 启用清单中'
      : '不在 bundles 启用清单（作为依赖安装）'
  openDrawer(page, {
    title: plugin.name,
    subtitle: `${esc(sourceLabel(plugin.source))} · ${isTool ? '内置' : esc(plugin.version || '—')} · ${isTool ? '内置工具' : enabled ? '已加载' : '未启用'}`,
    body: `
      <section class="role-drawer-section"><h4>描述</h4>
        <p class="drawer-desc-text">${esc(desc || '暂无描述')}</p>
        ${desc && !looksLikeChinese(desc) ? descTranslateButton('翻译描述') : ''}
      </section>
      <section class="role-drawer-section"><h4>版本</h4><p>${isTool ? '内置（随 GoGo 版本发布）' : esc(plugin.version || '—')}</p></section>
      ${isTool
        ? `<section class="role-drawer-section"><h4>工具类型</h4><p>${esc(plugin.tool_type_label || plugin.tool_type || '—')}</p></section>`
        : `<section class="role-drawer-section"><h4>作者</h4><p>${esc(plugin.author || '—')}</p></section>
      <section class="role-drawer-section"><h4>许可证</h4><p>${esc(plugin.license || '—')}</p></section>`}
      ${plugin.homepage ? `<section class="role-drawer-section"><h4>主页</h4><p><a href="${esc(plugin.homepage)}" target="_blank" rel="noopener noreferrer">${esc(plugin.homepage)}</a></p></section>` : ''}
      <section class="role-drawer-section"><h4>来源</h4><p>${esc(sourceLabel(plugin.source))}</p>
        ${plugin.source_detail ? `<p class="role-drawer-muted" style="margin-top:6px">${esc(plugin.source_detail)}</p>` : ''}
      </section>
      ${isTool ? '' : `<section class="role-drawer-section"><h4>所属 Profile</h4><p>${esc(plugin.profile)}</p></section>`}
      <section class="role-drawer-section"><h4>加载状态</h4><p>${statusText}</p></section>
      ${isTool ? '' : `<section class="role-drawer-section"><h4>安装路径</h4><p class="role-drawer-muted">${esc(plugin.path || '—')}</p></section>`}
    `,
    foot: `<button type="button" class="btn btn-primary" data-act="close">关闭</button>`,
  })
  const root = page.querySelector('#ecDrawer')
  const drawerTlBtn = root?.querySelector('[data-desc-translate]')
  if (root && drawerTlBtn) {
    const drawerDescEl = root.querySelector('.drawer-desc-text')
    bindDescTranslate(drawerDescEl, drawerTlBtn)
  }
  root?.querySelector('[data-act="close"]')?.addEventListener('click', () => closeDrawer(page))
  const drawerMark = root?.querySelector('.ef-side-drawer__mark')
  if (drawerMark) {
    drawerMark.classList.add('plugin-detail-icon')
    drawerMark.textContent = ''
    drawerMark.insertAdjacentHTML('afterbegin', PLUGIN_PUZZLE_ICON)
  }
}

export function render() {
  const page = document.createElement('div')
  page.className = 'page ec-module-page ec-plugins-page'
  page._pluginState = {
    plugins: [],
    visible: [],
    filter: '',
    source: '',
    sort: 'group',
    enabledOnly: 'all',
    error: '',
  }

  page.innerHTML = `
    <div class="role-toolbar role-toolbar--agents ec-toolbar">
      <div class="role-filters-row">
        <div class="role-search-wrap">
          <svg class="role-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="role-search-input" id="plugin-filter-input" placeholder="搜索插件" autocomplete="off">
        </div>
        ${selectHtml('plugin-filter-source', SOURCE_OPTS, '来源：全部')}
        ${selectHtml('plugin-filter-enabled', [
          { key: 'all', label: '全部' },
          { key: 'enabled', label: '已加载' },
          { key: 'disabled', label: '未启用' },
        ], '状态：全部')}
        ${selectHtml('plugin-filter-sort', SORT_OPTS, '排序：名称')}
        <span class="ec-toolbar-count" id="plugin-list-status">加载中…</span>
      </div>
    </div>
    <div class="ec-card-grid" id="plugin-list-body"></div>
  `

  // 搜索
  page.querySelector('#plugin-filter-input')?.addEventListener('input', (e) => {
    page._pluginState.filter = e.target.value
    renderList(page)
  })
  // 来源筛选
  page.querySelector('#plugin-filter-source')?.addEventListener('change', (e) => {
    page._pluginState.source = e.target.value
    renderList(page)
  })
  // 状态筛选
  page.querySelector('#plugin-filter-enabled')?.addEventListener('change', (e) => {
    page._pluginState.enabledOnly = e.target.value
    renderList(page)
  })
  // 排序
  page.querySelector('#plugin-filter-sort')?.addEventListener('change', (e) => {
    page._pluginState.sort = e.target.value
    renderList(page)
  })

  page._bindExpertHeader = () => {
    const btn = page.closest('.expert-page')?.querySelector('#expert-primary-action')
    if (!btn) return
    btn.onclick = () => loadPlugins(page, { force: true })
    btn.hidden = false
  }
  page._syncExpertPrimaryAction = () => {
    const btn = page.closest('.expert-page')?.querySelector('#expert-primary-action')
    if (!btn) return
    btn.hidden = false
    btn.onclick = () => loadPlugins(page, { force: true })
  }

  loadPlugins(page)
  return page
}

export function cleanup() {
  const root = document.querySelector('.ec-plugins-page')
  if (root) {
    const drawer = root.querySelector('#ecDrawer')
    if (drawer) drawer.remove()
  }
}
