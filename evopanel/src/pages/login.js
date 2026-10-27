/**
 * 登录页 — WebUI 远程访问 / 本机切换用户 / 企业 SSO 认证入口。
 *
 * 当后端 WebUI 中间件检测到未认证的页面请求时，会 302 重定向到 /login。
 * QR 登录通过 /qr-login?token=xxx 自动提交。
 * OIDC 回调：`#/auth/callback?token=...&redirect=/chat`
 * 本机「切换用户」走同一页：`#/login?switch=1`
 *
 * 路由注册在 main.js: registerRoute('/login', ...) + registerRoute('/qr-login', ...)
 */
import { version as APP_VERSION } from '../../package.json'
import {
  ensureMeReady,
  prepareAccountSwitch,
  sessionHint,
  sessionLabel,
  userAvatarUrl,
} from '../lib/account-session.js'
import {
  buildOidcLoginUrl,
  getWebuiStatus,
  login,
  qrLogin,
  saveAuthToken,
} from '../lib/webui-remote.js'

/** @type {HTMLElement | null} */
let _root = null

const ENTERPRISE_MARK = `<svg class="webui-login-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
  <rect x="2" y="2" width="36" height="36" rx="4" stroke="currentColor" stroke-width="1.5"/>
  <path d="M10 28V12h6.2c3.4 0 5.5 1.8 5.5 4.6 0 2.9-2.1 4.7-5.5 4.7H14.2V28H10zm4.2-10.2h1.8c1.5 0 2.4-.8 2.4-2s-.9-2-2.4-2h-1.8v4zM24.2 28l4.2-16h4.4L37 28h-4.1l-.7-2.8h-4.2L27.3 28h-3.1zm5.2-5.8h2.8l-1.4-5.4-1.4 5.4z" fill="currentColor"/>
</svg>`

const QR_HINT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="7" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/><rect x="7" y="14" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/><path d="M14 14h3v3h-3z"/><path d="M14 17h3"/></svg>`

const SHIELD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>`

const SWITCH_ARROW_DOWN = `<svg class="webui-login-switch-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14M5 11l7 7 7-7"/></svg>`

const SWITCH_PERSON_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`

const SWITCH_USER_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>`

const SWITCH_EYE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`

const SWITCH_EYE_OFF_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M17.9 17.9A10.5 10.5 0 0112 19C5 19 2 12 2 12a17 17 0 013.4-4.1M6.6 6.6A17 17 0 0112 5c7 0 10 7 10 7a17 17 0 01-3.6 4.4"/><path d="M3 3l18 18"/></svg>`

const SWITCH_LOCK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>`

const SWITCH_BADGE_ICON = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`

const SWITCH_GO_ARROW = `<svg class="gogo-switch-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14M5 11l7 7 7-7"/></svg>`

const SWITCH_CANCEL_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>`

function parseLoginQuery() {
  const hash = window.location.hash.slice(1)
  const queryStr = hash.includes('?') ? hash.split('?')[1] : ''
  return new URLSearchParams(queryStr || '')
}

/** 当前身份卡：头像（有则图，无则人形图标，不渲染字母头像）。 */
function switchCurrentAvatarHtml(me) {
  const url = me ? userAvatarUrl(me) : ''
  if (url) {
    return `<span class="webui-login-switch-avatar webui-login-switch-avatar--img" aria-hidden="true"><img src="${url.replace(/"/g, '&quot;')}" alt="" /></span>`
  }
  return `<span class="webui-login-switch-avatar webui-login-switch-avatar--icon" aria-hidden="true">${SWITCH_PERSON_ICON}</span>`
}

function switchCurrentName(me) {
  if (!me) return '本机管理员'
  return sessionLabel(me)
}

function switchCurrentHint(me) {
  if (!me) return '本机免登 · 切换后按新身份隔离'
  return sessionHint(me) || '已登录'
}

function brandPanelHtml(switchMode) {
  const kicker = switchMode ? '工作区身份切换' : '企业工作平台'
  const lead = switchMode
    ? '使用组织账号登录，会话、技能与工作目录将按身份隔离。'
    : '统一入口接入组织协作、智能体与知识资产，安全可控。'
  return `
    <aside class="webui-login-brand-panel" aria-label="GoGo">
      <canvas class="webui-login-caustic" aria-hidden="true"></canvas>
      <div class="webui-login-brand-inner">
        <div class="webui-login-brand-markrow">
          ${ENTERPRISE_MARK}
        </div>
        <p class="webui-login-brand-kicker">${kicker}</p>
        <h1 class="webui-login-brand-title">GoGo</h1>
        <p class="webui-login-brand-lead">${lead}</p>
        <ul class="webui-login-brand-points">
          <li>组织账号与权限隔离</li>
          <li>企业 SSO / 本机安全登录</li>
          <li>会话与工作区按身份归属</li>
        </ul>
      </div>
      <p class="webui-login-brand-foot">GoGo Enterprise Access</p>
    </aside>`
}

/**
 * @param {{
 *   switchMode: boolean,
 *   oidcEnabled?: boolean,
 *   oidcButtonLabel?: string,
 *   passwordLoginEnabled?: boolean,
 *   redirect?: string,
 *   error?: string,
 *   statusTitle?: string,
 *   statusBody?: string,
 * }} opts
 */
function loginPanelBody(opts) {
  const {
    switchMode,
    oidcEnabled = false,
    oidcButtonLabel = '使用企业 SSO 登录',
    passwordLoginEnabled = true,
    error = '',
    statusTitle = '',
    statusBody = '',
  } = opts

  const eyebrow = switchMode ? '切换用户' : '账户登录'
  const title = switchMode ? '选择工作身份' : '登录组织账户'
  const desc = switchMode
    ? '输入已开通的用户名与密码，切换后立即按新身份隔离数据。'
    : '请使用管理员分配的企业账号，或通过组织身份提供商登录。'
  const usernameValue = switchMode ? '' : ''
  const usernamePlaceholder = '组织用户名'
  const showPassword = passwordLoginEnabled !== false
  const showSso = Boolean(oidcEnabled) && !switchMode

  if (statusTitle) {
    return `
      <div class="webui-login-panel-head">
        <p class="webui-login-eyebrow">${eyebrow}</p>
        <h2 class="webui-login-panel-title">${statusTitle}</h2>
        ${statusBody ? `<p class="webui-login-panel-desc">${statusBody}</p>` : ''}
      </div>
      ${opts.statusSlot || ''}`
  }

  const ssoBlock = showSso
    ? `<button type="button" id="login-sso" class="webui-login-sso">
         ${SHIELD_ICON}
         <span>${oidcButtonLabel}</span>
       </button>
       ${showPassword ? '<div class="webui-login-divider"><span>或使用账号密码</span></div>' : ''}`
    : ''

  const passwordBlock = showPassword
    ? switchMode
      ? `
      <div class="webui-login-switch-current">
        <div class="webui-login-switch-current-head">
          <span class="webui-login-switch-badge">当前身份</span>
        </div>
        <div class="webui-login-switch-current-card">
          ${switchCurrentAvatarHtml(opts.currentMe)}
          <div class="webui-login-switch-current-meta">
            <p class="webui-login-switch-current-name">${switchCurrentName(opts.currentMe)}</p>
            <p class="webui-login-switch-current-hint">${switchCurrentHint(opts.currentMe)}</p>
          </div>
        </div>
        ${SWITCH_ARROW_DOWN}
      </div>
      <form id="login-form" class="webui-login-form">
        <label class="webui-login-field">
          <span class="webui-login-label">新身份用户名</span>
          <div class="webui-login-input-wrap webui-login-input-wrap--icon">
            ${SWITCH_USER_ICON}
            <input id="login-username" class="webui-login-input" type="text" name="gogo-switch-username" placeholder="输入用户名或登录名" autocomplete="off" value="" />
          </div>
        </label>
        <label class="webui-login-field">
          <span class="webui-login-label">密码</span>
          <div class="webui-login-input-wrap webui-login-input-wrap--with-toggle">
            <input id="login-password" class="webui-login-input" type="password" name="gogo-switch-password" placeholder="请输入密码" autocomplete="new-password" />
            <button type="button" id="login-password-toggle" class="webui-login-pw-toggle" aria-label="显示密码">${SWITCH_EYE_ICON}</button>
          </div>
        </label>
        <button type="submit" id="login-submit" class="webui-login-submit">切换并进入</button>
      </form>`
      : `<form id="login-form" class="webui-login-form">
        <label class="webui-login-field">
          <span class="webui-login-label">用户名</span>
          <input id="login-username" class="webui-login-input" type="text" placeholder="${usernamePlaceholder}" autocomplete="username" value="${usernameValue}" />
        </label>
        <label class="webui-login-field">
          <span class="webui-login-label">密码</span>
          <input id="login-password" class="webui-login-input" type="password" placeholder="请输入密码" autocomplete="current-password" />
        </label>
        <button type="submit" id="login-submit" class="webui-login-submit">登录工作台</button>
      </form>`
    : ''

  const footer = switchMode
    ? `<footer class="webui-login-footer">
        <span>账号由「设置 → 用户权限」创建。取消后仍保持当前身份。</span>
      </footer>
      <a href="#/chat" class="webui-login-link-btn webui-login-link-btn--ghost" id="login-cancel">取消，返回应用</a>`
    : showPassword
      ? `<footer class="webui-login-footer">
          ${QR_HINT_ICON}
          <span>也可在桌面端「设置 → 远程访问」生成二维码登录</span>
        </footer>`
      : `<footer class="webui-login-footer">
          ${SHIELD_ICON}
          <span>本组织已启用企业 SSO，请使用上方入口登录</span>
        </footer>`

  return `
    <div class="webui-login-panel-head">
      <p class="webui-login-eyebrow">${eyebrow}</p>
      <h2 class="webui-login-panel-title">${title}</h2>
      <p class="webui-login-panel-desc">${desc}</p>
    </div>
    ${ssoBlock}
    ${passwordBlock}
    <div id="login-error" class="webui-login-error" ${error ? '' : 'hidden'}>${error || ''}</div>
    ${footer}
    <div class="webui-login-version">GoGo v${APP_VERSION}</div>`
}

function loginHtml(opts) {
  if (Boolean(opts.switchMode)) return switchPageHtml(opts)
  return loginCardHtml(opts)
}

/**
 * 账号密码登录页（#/login，非 switch）—— 与切换身份页同款居中卡片（琥珀黄强调）。
 * 保留 wireLoginEvents 依赖的 id：login-sso / login-form / login-username /
 * login-password / login-submit / login-error。
 */
function loginCardHtml(opts) {
  const {
    oidcEnabled = false,
    oidcButtonLabel = '使用企业 SSO 登录',
    passwordLoginEnabled = true,
    error = '',
    statusTitle = '',
    statusBody = '',
  } = opts
  const showSso = Boolean(oidcEnabled)
  const showPassword = passwordLoginEnabled !== false

  if (statusTitle) {
    return `
    <div class="webui-login-page gogo-switch-page">
      <div class="gogo-switch-stage" aria-hidden="true"></div>
      <main class="gogo-switch-shell" aria-label="${statusTitle}">
        <div class="gogo-switch-head">
          <span class="gogo-switch-mark" aria-hidden="true">
            <span class="gogo-switch-mark-sq">G</span>
            <span class="gogo-switch-mark-name">GoGo</span>
          </span>
          <span class="gogo-switch-tag">企业工作平台</span>
        </div>
        <h1 class="gogo-switch-title">${statusTitle}</h1>
        ${statusBody ? `<p class="gogo-switch-desc">${statusBody}</p>` : ''}
        ${opts.statusSlot || ''}
      </main>
    </div>`
  }

  const ssoBlock = showSso
    ? `<button type="button" id="login-sso" class="gogo-switch-sso">
         ${SHIELD_ICON}
         <span>${oidcButtonLabel}</span>
       </button>`
    : ''

  const footerNote = showPassword
    ? `<p class="gogo-switch-note">${QR_HINT_ICON}也可在桌面端「设置 → 远程访问」生成二维码登录</p>`
    : `<p class="gogo-switch-note">${SHIELD_ICON}本组织已启用企业 SSO，请使用上方入口登录</p>`

  const passwordBlock = showPassword
    ? `<form id="login-form" class="gogo-switch-form" novalidate>
        <label class="gogo-switch-field">
          <span class="gogo-switch-label">用户名</span>
          <span class="gogo-switch-ctl">
            ${SWITCH_USER_ICON}
            <input id="login-username" type="text" name="gogo-login-username" placeholder="组织用户名" autocomplete="username" value="" />
          </span>
        </label>
        <label class="gogo-switch-field">
          <span class="gogo-switch-label">密码</span>
          <span class="gogo-switch-ctl">
            ${SWITCH_LOCK_ICON}
            <input id="login-password" type="password" name="gogo-login-password" placeholder="请输入密码" autocomplete="current-password" />
          </span>
        </label>
        <div id="login-error" class="gogo-switch-err" role="alert" ${error ? '' : 'hidden'}>${error || '请输入用户名和密码'}</div>
        <button type="submit" id="login-submit" class="gogo-switch-go">登录工作台</button>
      </form>`
    : ''

  return `
  <div class="webui-login-page gogo-switch-page">
    <div class="gogo-switch-stage" aria-hidden="true"></div>
    <main class="gogo-switch-shell" aria-label="账户登录">
      <div class="gogo-switch-head">
        <span class="gogo-switch-mark" aria-hidden="true">
          <span class="gogo-switch-mark-sq">G</span>
          <span class="gogo-switch-mark-name">GoGo</span>
        </span>
        <span class="gogo-switch-tag">企业工作平台</span>
      </div>
      <h1 class="gogo-switch-title">登录组织账户</h1>
      <p class="gogo-switch-desc">请使用管理员分配的企业账号，或通过组织身份提供商登录。</p>
      ${ssoBlock}
      ${passwordBlock}
      <div class="gogo-switch-foot">
        ${footerNote}
        <p class="gogo-switch-ver">GoGo v${APP_VERSION}</p>
      </div>
    </main>
  </div>`
}

/**
 * 本机「切换工作身份」页 —— GoGo 工作台风格的居中身份卡（琥珀黄强调）。
 * 保留 wireLoginEvents 依赖的全部 id：login-form / login-username /
 * login-password / login-password-toggle / login-submit / login-cancel / login-error。
 */
function switchPageHtml(opts) {
  const error = opts.error || ''
  return `
  <div class="webui-login-page gogo-switch-page">
    <div class="gogo-switch-stage" aria-hidden="true"></div>
    <main class="gogo-switch-shell" aria-label="切换工作身份">
      <div class="gogo-switch-head">
        <span class="gogo-switch-mark" aria-hidden="true">
          <span class="gogo-switch-mark-sq">G</span>
          <span class="gogo-switch-mark-name">GoGo</span>
        </span>
        <span class="gogo-switch-tag">${SWITCH_PERSON_ICON}工作区身份切换</span>
      </div>
      <h1 class="gogo-switch-title">切换工作身份</h1>
      <p class="gogo-switch-desc">切换后，会话、技能与工作目录将按新身份隔离。</p>

      <div class="gogo-switch-cur">
        ${switchCurrentAvatarHtml(opts.currentMe)}
        <div class="gogo-switch-cur-meta">
          <p class="gogo-switch-cur-name">${switchCurrentName(opts.currentMe)}</p>
          <p class="gogo-switch-cur-hint">${switchCurrentHint(opts.currentMe)}</p>
        </div>
        <span class="gogo-switch-badge">${SWITCH_BADGE_ICON}当前身份</span>
      </div>

      ${SWITCH_GO_ARROW}

      <form id="login-form" class="gogo-switch-form" novalidate>
        <label class="gogo-switch-field">
          <span class="gogo-switch-label">新身份用户名</span>
          <span class="gogo-switch-ctl">
            ${SWITCH_USER_ICON}
            <input id="login-username" type="text" name="gogo-switch-username" placeholder="输入用户名或登录名" autocomplete="off" value="" />
          </span>
        </label>
        <label class="gogo-switch-field">
          <span class="gogo-switch-label">密码</span>
          <span class="gogo-switch-ctl">
            ${SWITCH_LOCK_ICON}
            <input id="login-password" type="password" name="gogo-switch-password" placeholder="请输入密码" autocomplete="new-password" />
            <button type="button" id="login-password-toggle" class="gogo-switch-eye" aria-label="显示密码">${SWITCH_EYE_ICON}</button>
          </span>
        </label>
        <div id="login-error" class="gogo-switch-err" role="alert" ${error ? '' : 'hidden'}>${error || '请输入用户名和密码'}</div>
        <button type="submit" id="login-submit" class="gogo-switch-go">切换并进入</button>
      </form>

      <div class="gogo-switch-foot">
        <p class="gogo-switch-note">${SHIELD_ICON}账号由「设置 → 用户权限」创建。取消后仍保持当前身份。</p>
        <a href="#/chat" class="gogo-switch-cancel" id="login-cancel">${SWITCH_CANCEL_ICON}取消，返回应用</a>
        <p class="gogo-switch-ver">GoGo v${APP_VERSION}</p>
      </div>
    </main>
  </div>`
}

function qrLoginHtml() {
  return loginHtml({
    switchMode: false,
    statusTitle: '二维码登录',
    statusBody: '正在核验企业访问凭证，请稍候。',
    statusSlot: `
      <div id="qr-login-status" class="webui-login-qr-status">
        <div class="webui-login-spinner" aria-hidden="true"></div>
        <p class="webui-login-qr-text">正在验证…</p>
      </div>
      <div id="qr-login-error" class="webui-login-qr-error" hidden>
        <p class="webui-login-qr-error-title">登录失败</p>
        <p id="qr-login-error-msg" class="webui-login-qr-error-msg"></p>
        <a href="#/login" class="webui-login-link-btn">使用密码登录</a>
      </div>`,
  })
}

function authCallbackHtml() {
  return loginHtml({
    switchMode: false,
    statusTitle: '正在完成登录',
    statusBody: '企业身份已确认，正在建立本地会话。',
    statusSlot: `
      <div class="webui-login-qr-status">
        <div class="webui-login-spinner" aria-hidden="true"></div>
        <p class="webui-login-qr-text">正在保存会话…</p>
      </div>`,
  })
}

function showError(msg) {
  const el = document.getElementById('login-error')
  if (!el) return
  if (msg) {
    el.textContent = msg
    el.hidden = false
  } else {
    el.textContent = ''
    el.hidden = true
  }
}

/**
 * @param {HTMLElement} root
 * @param {{ switchMode: boolean, redirect?: string }} opts
 */
function wireLoginEvents(root, opts) {
  const { switchMode, redirect = '/chat' } = opts

  root.querySelector('#login-sso')?.addEventListener('click', async () => {
    try {
      window.location.href = await buildOidcLoginUrl({ redirect })
    } catch (err) {
      showError(err?.message || '无法启动 SSO 登录')
    }
  })

  // 切换用户页：密码可见性切换
  const pwToggle = root.querySelector('#login-password-toggle')
  const pwInput = root.querySelector('#login-password')
  pwToggle?.addEventListener('click', () => {
    if (!pwInput) return
    const show = pwInput.type === 'password'
    pwInput.type = show ? 'text' : 'password'
    pwToggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码')
    pwToggle.innerHTML = show ? SWITCH_EYE_OFF_ICON : SWITCH_EYE_ICON
    pwToggle.classList.toggle('gogo-switch-eye--active', show)
  })

  const form = root.querySelector('#login-form')
  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const usernameRaw = root.querySelector('#login-username')?.value?.trim() || ''
    const username = usernameRaw || (switchMode ? '' : 'admin')
    const password = root.querySelector('#login-password')?.value || ''
    const submitBtn = root.querySelector('#login-submit')

    if (!username) {
      showError('请输入用户名')
      root.querySelector('#login-username')?.focus()
      return
    }
    if (!password) {
      showError('请输入密码')
      return
    }

    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = switchMode ? '切换中…' : '登录中…'
    }
    showError('')

    try {
      const resp = await login({ username, password })
      prepareAccountSwitch(resp.token)
      saveAuthToken(resp.token)
      const target = redirect.startsWith('/') ? redirect : `/${redirect}`
      window.location.hash = target
      window.location.reload()
    } catch (err) {
      showError(err?.message || '登录失败，请检查用户名和密码')
      if (submitBtn) {
        submitBtn.disabled = false
        submitBtn.textContent = switchMode ? '切换并进入' : '登录工作台'
      }
    }
  })
}

async function handleQrLogin(root, token) {
  const statusEl = root.querySelector('#qr-login-status')
  const errorEl = root.querySelector('#qr-login-error')
  const errorMsgEl = root.querySelector('#qr-login-error-msg')

  try {
    const resp = await qrLogin({ qr_token: token })
    prepareAccountSwitch(resp.token)
    saveAuthToken(resp.token)
    window.location.hash = '/chat'
    window.location.reload()
  } catch (err) {
    if (statusEl) statusEl.hidden = true
    if (errorEl) errorEl.hidden = false
    if (errorMsgEl) errorMsgEl.textContent = err?.message || '二维码已过期或无效'
  }
}

function handleAuthCallback(params) {
  const token = params.get('token')
  const redirect = params.get('redirect') || '/chat'
  const err = params.get('error')

  if (err) {
    window.location.hash = `/login?error=${encodeURIComponent(err)}`
    window.location.reload()
    return
  }

  if (!token) {
    window.location.hash = '/login?error=missing_token'
    window.location.reload()
    return
  }

  prepareAccountSwitch(token)
  saveAuthToken(token)
  const target = redirect.startsWith('/') ? redirect : `/${redirect}`
  window.location.hash = target
  window.location.reload()
}


// ===== 水波纹焦散背景效果 (WebGL2) =====
function initCausticCanvas(canvas) {
  if (!canvas) return;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) return;

  const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

  const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 u_res; uniform float u_time; uniform vec3 u_ripple;
#define TAU 6.28318530718
float caustic(vec2 uv){
  float t=u_time*0.4+23.0;
  vec2 p=mod(uv*TAU, TAU)-250.0;
  vec2 i=p; float c=1.0; float inten=0.005;
  for(int n=0;n<5;n++){
    float tt=t*(1.0-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c/=5.0; c=1.17-pow(c,1.4);
  return pow(abs(c),8.0);
}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; uv.x*=u_res.x/u_res.y;
  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
  vec2 rp=(u_ripple.xy-0.5)*vec2(u_res.x/u_res.y,1.0);
  float d=length(p-rp), age=u_ripple.z;
  float wave=sin(d*24.0-age*8.0)*exp(-d*3.5)*exp(-age*1.6);
  uv += normalize(p-rp+1e-4)*wave*0.4;
  float c=caustic(uv*1.6);
  vec3 deep=vec3(0.02,0.10,0.17), shallow=vec3(0.05,0.34,0.42);
  vec3 col=mix(deep,shallow, smoothstep(1.0,-0.3,length(p)));
  col+=vec3(0.35,0.85,0.80)*c;
  col+=vec3(0.85,1.0,0.95)*pow(c,1.8)*0.5;
  col*=0.6+0.6*smoothstep(1.35,0.1,length(p));
  col=col/(col+0.75);
  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9,78.2)))*43758.5)-0.5)*0.025;
  o=vec4(pow(max(col,0.0),vec3(0.85)),0.85);
}`;

  function sh(t, s) {
    const x = gl.createShader(t);
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(x));
      return null;
    }
    return x;
  }

  const pr = gl.createProgram();
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(pr));
    return;
  }
  gl.useProgram(pr);

  const uRes = gl.getUniformLocation(pr, 'u_res');
  const uTime = gl.getUniformLocation(pr, 'u_time');
  const uRip = gl.getUniformLocation(pr, 'u_ripple');
  let ripple = [0.5, 0.5, 999];

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    ripple = [(e.clientX - rect.left) / rect.width, 1.0 - (e.clientY - rect.top) / rect.height, 0];
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const t0 = performance.now();
  let rafId = null;
  function frame(now) {
    resize();
    ripple[2] += 1 / 60;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) / 1000);
    gl.uniform3f(uRip, ripple[0], ripple[1], ripple[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  // 清理函数
  canvas._causticCleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
  };
}

// 初始化所有水波纹 canvas
function initAllCaustics(root) {
  if (!root) return;
  const canvases = root.querySelectorAll('.webui-login-caustic');
  canvases.forEach((canvas) => {
    if (!canvas._causticInitialized) {
      canvas._causticInitialized = true;
      initCausticCanvas(canvas);
    }
  });
}
// ===== 水波纹效果结束 =====

export function cleanup() {
  _root = null
}

/**
 * @param {{ mode?: 'login' | 'qr-login' | 'auth-callback', qrToken?: string }} [opts]
 * @returns {HTMLElement}
 */
export function render(opts) {
  cleanup()
  const page = document.createElement('div')
  _root = page

  let mode = opts?.mode || 'login'
  let qrToken = opts?.qrToken || null

  if (!opts) {
    const hash = window.location.hash.slice(1)
    const [path, queryStr] = hash.split('?')
    if (path === '/qr-login') {
      mode = 'qr-login'
      qrToken = new URLSearchParams(queryStr || '').get('token')
    } else if (path === '/auth/callback') {
      mode = 'auth-callback'
    }
  }

  const params = parseLoginQuery()
  const switchMode = params.get('switch') === '1'
  const redirect = params.get('redirect') || '/chat'
  const error = params.get('error') || ''

  if (mode === 'auth-callback') {
    page.innerHTML = authCallbackHtml()
    queueMicrotask(() => handleAuthCallback(params))
    return page
  }

  if (mode === 'qr-login') {
    page.innerHTML = qrLoginHtml()
    if (qrToken) void handleQrLogin(page, qrToken)
    else {
      const statusEl = page.querySelector('#qr-login-status')
      const errorEl = page.querySelector('#qr-login-error')
      const errorMsgEl = page.querySelector('#qr-login-error-msg')
      if (statusEl) statusEl.hidden = true
      if (errorEl) errorEl.hidden = false
      if (errorMsgEl) errorMsgEl.textContent = '缺少二维码 token'
    }
    queueMicrotask(() => initAllCaustics(page))
  } else {
    page.innerHTML = loginHtml({
      switchMode,
      redirect,
      error,
    })
    wireLoginEvents(page, { switchMode, redirect })
    queueMicrotask(() => initAllCaustics(page))
    void getWebuiStatus()
      .then(async (status) => {
        if (!page.isConnected) return
        // 切换用户页：异步取当前身份（本机免登 admin 或已登录 JWT 身份）渲染当前身份卡
        let currentMe = null
        if (switchMode) {
          try {
            currentMe = await ensureMeReady()
          } catch {
            currentMe = null
          }
          if (!page.isConnected) return
        }
        page.innerHTML = loginHtml({
          switchMode,
          redirect,
          error,
          currentMe,
          oidcEnabled: Boolean(status?.oidc_enabled),
          oidcButtonLabel: status?.oidc_button_label || '使用企业 SSO 登录',
          passwordLoginEnabled: status?.password_login_enabled !== false,
        })
        wireLoginEvents(page, { switchMode, redirect })
        queueMicrotask(() => {
          page.querySelector('#login-username')?.focus()
        })
      })
      .catch(() => {
        queueMicrotask(() => {
          page.querySelector('#login-username')?.focus()
        })
      })
  }

  return page
}
