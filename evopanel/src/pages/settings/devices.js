/**
 * 设置 → 基础设置 → 我的设备
 * 单机版：
 *  - 点击设备卡片 → 右侧滑出设备详情（连接通道 / 名称 / 默认工作目录 / 最近目录）
 *  - 点击「连接设备」→ 弹出引导模态（通过桌面端 / 通过 CLI 两种接入方式）
 */
import { toast } from '../../components/toast.js'
import { getPanelSetting, patchPanelSettings } from '../../lib/panel-settings.js'
import '../../style/settings-resources.css'

/** @type {HTMLElement | null} */
let _root = null
/** @type {boolean} */
let _detailOpen = false
/** @type {'desktop'|'cli'} */
let _connectTab = 'desktop'
/** @type {object|null} */
let _device = null

async function loadLocalDevice() {
  try {
    const res = await fetch('/api/webui/devices/local')
    if (res.ok) _device = await res.json()
  } catch {
    /* keep fallback */
  }
}

function currentHostname() {
  if (_device?.hostname) return String(_device.hostname)
  try {
    return String((window.__GOGO_CLIENT__ || {}).hostname || '').trim() || '本地设备'
  } catch {
    return '本地设备'
  }
}


function displayName() {
  const custom = String(getPanelSetting('deviceName', '') || '').trim()
  return custom || currentHostname()
}

function defaultWorkdir() {
  return String(getPanelSetting('deviceWorkdir', '') || '')
}

function deviceKind() {
  try {
    const k = String((window.__GOGO_CLIENT__ || {}).deviceKind || '').trim().toLowerCase()
    if (k === 'mobile' || k === 'phone') return 'mobile'
  } catch {
    /* ignore */
  }
  return 'desktop'
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function deviceIcon(kind) {
  const common = 'width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
  if (kind === 'mobile') {
    return `<svg ${common}><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none"/></svg>`
  }
  return `<svg ${common}><rect x="3" y="4" width="18" height="11" rx="2"/><path d="M12 15v3"/><path d="M8 20.5h8"/></svg>`
}

function usbIcon() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 2v9"/><circle cx="12" cy="4" r="1.6" fill="currentColor" stroke="none"/><path d="M12 11l-4 5h5v4l4-6h-5l0-3"/>
  </svg>`
}

function refreshIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
  </svg>`
}

function moreIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>
  </svg>`
}

function closeIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18"/>
  </svg>`
}

function copyIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`
}

function shieldIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/>
  </svg>`
}

function deviceCardHtml() {
  const host = currentHostname()
  return `
    <div class="my-device-card${_detailOpen ? ' is-selected' : ''}" data-device-card role="button" tabindex="0">
      <div class="my-device-icon">${deviceIcon(deviceKind())}</div>
      <div class="my-device-body">
        <div class="my-device-name-row">
          <span class="my-device-name">${esc(displayName())}</span>
          <span class="my-device-dot" aria-hidden="true"></span>
          <span class="my-device-chip">当前设备</span>
        </div>
        <div class="my-device-meta">在线 · ${esc(_device?.platform || _device?.os || "本机")}</div>
      </div>
      <button type="button" class="my-device-more" data-device-more aria-label="更多操作" title="更多">${moreIcon()}</button>
    </div>`
}

function detailPanelHtml() {
  const host = currentHostname()
  const kind = deviceKind()
  return `
    <aside class="device-detail-panel" data-device-detail>
      <div class="device-detail-head">
        <div class="device-detail-icon">${deviceIcon(kind)}</div>
        <div class="device-detail-head-info">
          <div class="device-detail-name-row">
            <span class="device-detail-name">${esc(displayName())}</span>
            <span class="device-detail-status">在线 · 1 个连接</span>
            <span class="device-detail-chip">当前设备</span>
          </div>
        </div>
        <button type="button" class="device-detail-close" data-detail-close aria-label="关闭详情" title="关闭">${closeIcon()}</button>
      </div>

      <div class="device-detail-section">
        <div class="device-detail-label">连接通道</div>
        <div class="device-detail-channel">
          <span class="device-detail-dot" aria-hidden="true"></span>
          <span class="device-detail-channel-kind">${kind === 'mobile' ? 'mobile' : 'desktop'}</span>
          <span class="device-detail-channel-time">${esc(_device?.platform || "本机")}</span>
        </div>
      </div>

      <div class="device-detail-section">
        <label class="device-detail-label" for="device-name-input">名称</label>
        <input id="device-name-input" class="device-detail-input" type="text" placeholder="便于识别此设备的名称" value="${esc(getPanelSetting('deviceName', '') || '')}" />
      </div>

      <div class="device-detail-section">
        <label class="device-detail-label" for="device-workdir-input">默认工作目录</label>
        <div class="device-detail-workdir">
          <input id="device-workdir-input" class="device-detail-input" type="text" placeholder="例如 /Users/me/projects" value="${esc(defaultWorkdir())}" />
          <button type="button" class="device-detail-browse" data-action="browse">浏览…</button>
        </div>
      </div>

      <div class="device-detail-section">
        <div class="device-detail-label device-detail-label-row">最近目录 <button type="button" class="device-detail-pin" data-action="pin" title="固定">${copyIcon()}</button></div>
        <div class="device-detail-empty">暂无最近目录</div>
      </div>
    </aside>`
}

function dropdownHtml() {
  return `
    <div class="my-device-dd" data-device-dd>
      <button type="button" class="my-device-dd-item" data-dd-action="share">共享到工作区</button>
      <button type="button" class="my-device-dd-item my-device-dd-item--danger" data-dd-action="remove">移除</button>
    </div>`
}

function stepHtml(num, title, bodyHtml) {
  return `
    <div class="connect-step">
      <div class="connect-step-num">${num}</div>
      <div class="connect-step-body">
        <div class="connect-step-title">${esc(title)}</div>
        ${bodyHtml}
      </div>
    </div>`
}

function codeBlockHtml(code) {
  return `
    <div class="connect-code">
      <code>${esc(code)}</code>
      <button type="button" class="connect-code-copy" data-copy-code="${esc(code)}" aria-label="复制命令" title="复制">${copyIcon()}</button>
    </div>`
}

function connectModalHtml() {
  const desktopBody = `
    ${stepHtml(1, '下载桌面端', `
      <p class="connect-step-desc">前往 GoGo 下载页获取适用于你操作系统的桌面版应用。</p>
      <button type="button" class="connect-download-btn" data-action="download-desktop">下载 GoGo 桌面端</button>
    `)}
    ${stepHtml(2, '登录并打开设备网关', `
      <p class="connect-step-desc">登录后，点击右上角的设备网关图标，确认开关已打开。</p>
    `)}
    ${stepHtml(3, '设备自动出现', `
      <p class="connect-step-desc">桌面端启动后会自动注册为设备，连接成功后即可在列表中看到它。</p>
    `)}`

  const cliBody = `
    ${stepHtml(1, '安装 CLI', codeBlockHtml('npm install -g @gogo/cli'))}
    ${stepHtml(2, '登录账号', codeBlockHtml('gogo login'))}
    ${stepHtml(3, '启动守护进程', `
      <p class="connect-step-desc">启动后台守护进程，保持设备在线并等待远程操作。</p>
      ${codeBlockHtml('gogo connect --daemon')}
    `)}`

  return `
    <div class="connect-modal-mask" data-connect-mask>
      <div class="connect-modal" role="dialog" aria-modal="true" aria-label="连接设备">
        <div class="connect-modal-head">
          <div>
            <div class="connect-modal-title">连接设备</div>
            <div class="connect-modal-desc">选择一种方式将你的电脑连接到 GoGo。</div>
          </div>
          <button type="button" class="connect-modal-close" data-connect-close aria-label="关闭" title="关闭">${closeIcon()}</button>
        </div>
        <div class="connect-tabs">
          <button type="button" class="connect-tab${_connectTab === 'desktop' ? ' is-active' : ''}" data-connect-tab="desktop">通过桌面端</button>
          <button type="button" class="connect-tab${_connectTab === 'cli' ? ' is-active' : ''}" data-connect-tab="cli">通过 CLI</button>
        </div>
        <div class="connect-steps">${_connectTab === 'desktop' ? desktopBody : cliBody}</div>
        <div class="connect-foot">${shieldIcon()}<span>仅注册设备信息，不会访问你的数据。</span></div>
      </div>
    </div>`
}

function renderPage() {
  if (!_root) return
  _root.innerHTML = `
    <div class="settings-group my-devices-group">
      <div class="my-devices-head">
        <div class="my-devices-title">我的设备</div>
        <div class="my-devices-actions">
          <span class="my-devices-count">1 台设备</span>
          <button type="button" class="my-devices-connect" data-action="connect">${usbIcon()}<span>连接设备</span></button>
          <button type="button" class="my-devices-refresh" data-action="refresh" aria-label="刷新" title="刷新">${refreshIcon()}</button>
        </div>
      </div>
      <div class="my-devices-split">
        <div class="my-devices-list">${deviceCardHtml()}</div>
        ${_detailOpen ? detailPanelHtml() : ''}
      </div>
    </div>`
}

function openConnectModal() {
  _closeDropdown()
  const existing = document.querySelector('[data-connect-mask]')
  if (existing) existing.remove()
  const wrap = document.createElement('div')
  wrap.innerHTML = connectModalHtml()
  const mask = wrap.firstElementChild
  if (mask) {
    mask.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;z-index:1000030;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:24px;box-sizing:border-box;'
  }
  document.body.appendChild(mask)
}

function closeConnectModal() {
  document.querySelector('[data-connect-mask]')?.remove()
}

function _closeDropdown() {
  _root?.querySelectorAll('.my-device-dd').forEach((el) => el.remove())
}

async function copyText(t) {
  try {
    await navigator.clipboard?.writeText(t)
    toast('已复制', 'success')
  } catch {
    toast('复制失败', 'error')
  }
}

function onRootClick(e) {
  const moreBtn = e.target.closest?.('[data-device-more]')
  if (moreBtn) {
    e.preventDefault()
    e.stopPropagation()
    _closeDropdown()
    moreBtn.insertAdjacentHTML('afterend', dropdownHtml())
    return
  }

  const ddItem = e.target.closest?.('[data-dd-action]')
  if (ddItem) {
    e.preventDefault()
    const action = ddItem.getAttribute('data-dd-action')
    _closeDropdown()
    if (action === 'share') toast('已将当前设备共享到工作区', 'success')
    else toast('已移除当前设备', 'info')
    return
  }

  if (e.target.closest?.('[data-detail-close]')) {
    _detailOpen = false
    renderPage()
    return
  }

  if (e.target.closest?.('[data-action="browse"]')) {
    toast('请选择默认工作目录（演示）', 'info')
    return
  }
  if (e.target.closest?.('#device-name-input')) {
    const el = e.currentTarget.querySelector('#device-name-input')
    if (el && !el.dataset.bound) {
      el.dataset.bound = '1'
      el.addEventListener('change', async () => {
        await patchPanelSettings({ deviceName: el.value.trim() })
        toast('设备名称已保存', 'success')
        renderPage()
      })
    }
    return
  }
  if (e.target.closest?.('#device-workdir-input')) {
    const el = e.currentTarget.querySelector('#device-workdir-input')
    if (el && !el.dataset.bound) {
      el.dataset.bound = '1'
      el.addEventListener('change', () => {
        void patchPanelSettings({ deviceWorkdir: el.value.trim() })
        toast('默认工作目录已保存', 'success')
      })
    }
    return
  }
  if (e.target.closest?.('[data-action="pin"]')) {
    toast('已固定最近目录', 'success')
    return
  }

  const action = e.target.closest?.('[data-action]')
  if (action) {
    const a = action.getAttribute('data-action')
    if (a === 'connect') openConnectModal()
    else if (a === 'refresh') {
      renderPage()
      toast('设备列表已刷新', 'success')
    }
    return
  }

  if (e.target.closest?.('[data-device-card]')) {
    _detailOpen = true
    renderPage()
    return
  }

  _closeDropdown()
}

function onBodyClick(e) {
  const tabBtn = e.target.closest?.('[data-connect-tab]')
  if (tabBtn) {
    _connectTab = tabBtn.getAttribute('data-connect-tab') === 'cli' ? 'cli' : 'desktop'
    const modal = document.querySelector('[data-connect-mask]')
    if (modal) {
      const wrap = document.createElement('div')
      wrap.innerHTML = connectModalHtml()
      modal.replaceWith(wrap.firstElementChild)
    }
    return
  }
  if (e.target.closest?.('[data-connect-close]') || e.target.closest?.('[data-connect-mask]')) {
    closeConnectModal()
    return
  }
  const copyBtn = e.target.closest?.('[data-copy-code]')
  if (copyBtn) {
    copyText(copyBtn.getAttribute('data-copy-code') || '')
    return
  }
  if (e.target.closest?.('[data-action="download-desktop"]')) {
    toast('前往 GoGo 下载页（演示）', 'info')
  }
}

/** @param {HTMLElement} container */
export async function mountDevicesInto(container) {
  cleanup()
  _root = container
  _root.classList.add('settings-embed-wrap')
  await loadLocalDevice()
  renderPage()
  _root.addEventListener('click', onRootClick)
  document.addEventListener('click', onBodyClick)
}

export function cleanup() {
  _closeDropdown()
  closeConnectModal()
  if (_root) _root.removeEventListener('click', onRootClick)
  document.removeEventListener('click', onBodyClick)
  _root = null
  _detailOpen = false
}
