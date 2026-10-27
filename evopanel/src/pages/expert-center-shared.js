/**
 * 智能体中心 — 技能 / 连接器共用 UI 片段（抽屉、筛选栏、二级 Tab）
 */

export function esc(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function selectHtml(id, options, emptyLabel) {
  return `
    <select class="role-filter-select ec-filter-select" id="${id}" aria-label="${esc(emptyLabel)}">
      <option value="">${esc(emptyLabel)}</option>
      ${options.map((o) => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('')}
    </select>`
}

export function renderModuleSubtabs(tabs, activeId) {
  return `
    <div class="role-subtabs ec-subtabs" role="tablist">
      ${tabs
        .map(
          (t) => `
        <button type="button" class="role-subtab${t.id === activeId ? ' role-subtab--active' : ''}" data-main-tab="${esc(t.id)}" role="tab">
          ${esc(t.label)}
        </button>`,
        )
        .join('')}
    </div>`
}

export function ensureDrawer(page, idPrefix = 'ec') {
  let root = page.querySelector(`#${idPrefix}Drawer`)
  if (root) return root
  root = document.createElement('div')
  root.className = 'ef-side-drawer-root role-drawer-root ec-drawer-root'
  root.id = `${idPrefix}Drawer`
  root.hidden = true
  root.innerHTML = `
    <div class="ef-side-drawer-mask role-drawer-mask" data-action="close-drawer"></div>
    <aside class="ef-side-drawer role-drawer" role="dialog" aria-label="详情">
      <header class="ef-side-drawer__head role-drawer__head">
        <div class="ef-side-drawer__brand">
          <span class="ef-side-drawer__mark" aria-hidden="true">详</span>
          <div class="ef-side-drawer__heading">
            <h2 class="ef-side-drawer__title role-drawer__title" data-role="title">详情</h2>
            <div class="ef-side-drawer__meta role-drawer__subtitle" data-role="subtitle"></div>
          </div>
        </div>
        <button type="button" class="ef-side-drawer__close role-drawer__close" data-action="close-drawer" aria-label="关闭">×</button>
      </header>
      <div class="ef-side-drawer__body role-drawer__body" data-role="body"></div>
      <footer class="ef-side-drawer__foot role-drawer__foot" data-role="foot"></footer>
    </aside>`
  page.appendChild(root)
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close-drawer"]')) closeDrawer(page, idPrefix)
  })
  return root
}

export function openDrawer(page, { title, subtitle = '', body = '', foot = '', mark = '详' }, idPrefix = 'ec') {
  const root = ensureDrawer(page, idPrefix)
  root.querySelector('[data-role="title"]').textContent = title || '详情'
  root.querySelector('[data-role="subtitle"]').innerHTML = subtitle || ''
  root.querySelector('[data-role="body"]').innerHTML = body || ''
  const footEl = root.querySelector('[data-role="foot"]')
  footEl.innerHTML = foot
    ? `<div class="ef-side-drawer__actions">${foot}</div>`
    : ''
  const markEl = root.querySelector('.ef-side-drawer__mark')
  if (markEl) markEl.textContent = String(mark || '详').slice(0, 1)
  root.hidden = false
  return root
}

export function closeDrawer(page, idPrefix = 'ec') {
  const root = page.querySelector(`#${idPrefix}Drawer`)
  if (root) root.hidden = true
}

export function setBtnState(btn, state, labels = {}) {
  if (!btn) return
  const map = {
    idle: labels.idle || btn.dataset.labelIdle || '确定',
    loading: labels.loading || '处理中…',
    success: labels.success || '已完成',
    error: labels.error || '重试',
  }
  if (state === 'loading') {
    btn.disabled = true
    btn.dataset.labelIdle = btn.dataset.labelIdle || btn.textContent
    btn.textContent = map.loading
    btn.classList.add('is-loading')
  } else if (state === 'success') {
    btn.disabled = true
    btn.textContent = map.success
    btn.classList.remove('is-loading')
  } else if (state === 'error') {
    btn.disabled = false
    btn.textContent = map.error
    btn.classList.remove('is-loading')
  } else {
    btn.disabled = false
    btn.textContent = map.idle
    btn.classList.remove('is-loading')
  }
}

/** 统计技能被哪些智能体引用 */
export function buildSkillUsageMap(agents) {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  for (const a of agents || []) {
    const code = String(a.agent_code || a.name || '').trim()
    const name = String(a.agent_name || code).trim()
    const skills = Array.isArray(a.skills) ? a.skills : []
    for (const s of skills) {
      const key = String(s || '').trim().toLowerCase()
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(name || code)
    }
  }
  return map
}

/** 粗略扫描应用配置中的技能引用 */
export function buildSkillAppUsageMap(apps) {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  const walk = (obj, appName, out) => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((x) => walk(x, appName, out))
      return
    }
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k || '').toLowerCase()
      if ((key === 'skills' || key === 'skill') && (typeof v === 'string' || Array.isArray(v))) {
        const list = Array.isArray(v) ? v : String(v).split(/[,，\s]+/)
        for (const s of list) {
          const sk = String(s || '').trim().toLowerCase()
          if (!sk) continue
          if (!out.has(sk)) out.set(sk, [])
          if (!out.get(sk).includes(appName)) out.get(sk).push(appName)
        }
      } else if (v && typeof v === 'object') {
        walk(v, appName, out)
      }
    }
  }
  for (const app of apps || []) {
    const appName = String(app?.name || app?.title || app?.id || '工作流').trim()
    walk(app, appName, map)
  }
  return map
}

/**
 * 介绍翻译共享逻辑 — 技能/连接器描述来自远程仓库（SkillHub、MCP Registry、Glama），
 * 可能为英文。绑定一个「译」按钮：点击调用后端 /api/translate 翻译，再次点击还原原文。
 */

/** 粗略判断文本是否主要包含中文（CJK 占比 > 15% 视为无需翻译） */
export function looksLikeChinese(text) {
  if (!text) return true
  const s = String(text)
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  if (!cjk) return false
  return cjk / Math.max(1, s.length) > 0.15
}

/** 渲染一个翻译按钮（自带 data-stop，避免触发卡片点击/抽屉） */
export function descTranslateButton(label = '译') {
  return `<button type="button" class="desc-translate-btn" data-stop="1" data-desc-translate="1" data-label="${esc(label)}">${esc(label)}</button>`
}

/**
 * 把翻译按钮绑定到描述元素上。
 * @param {HTMLElement} descEl 展示描述的节点（textContent 为原文）
 * @param {HTMLElement|null} btn 翻译按钮；为 null 时自动在 descEl 内查找 [data-desc-translate]
 * @param {{getText?: Function, setText?: Function}} opts 可选：自定义读写文本的方式（用于 innerHTML 场景）
 */
export function bindDescTranslate(descEl, btn, opts = {}) {
  if (!descEl) return
  const target = btn || descEl.querySelector('[data-desc-translate]')
  if (!target) return
  const read = opts.getText || (() => (descEl.textContent || '').trim())
  const write = opts.setText || ((t) => {
    descEl.textContent = t
  })

  const original = read()
  // 无描述或已是中文：翻译按钮无意义，移除
  if (!original || looksLikeChinese(original)) {
    target.remove()
    return
  }

  target.addEventListener('click', async (e) => {
    e.stopPropagation()
    e.preventDefault()
    // 还原原文
    if (target.dataset.tl === 'on') {
      target.disabled = false
      write(original)
      target.dataset.tl = ''
      target.textContent = target.dataset.label || '译'
      return
    }
    target.disabled = true
    target.textContent = '翻译中…'
    try {
      const { api } = await import('../lib/tauri-api.js')
      const translated = await api.translate(original)
      if (!String(translated || '').trim()) throw new Error('翻译结果为空')
      write(translated)
      target.dataset.tl = 'on'
      target.textContent = '原文'
      target.disabled = false
    } catch (err) {
      target.textContent = '失败'
      try {
        const { toast } = await import('../components/toast.js')
        toast('翻译失败: ' + (err?.message || err), 'error')
      } catch (_) { /* ignore */ }
      setTimeout(() => {
        target.textContent = target.dataset.label || '译'
        target.disabled = false
      }, 1200)
    }
  })
}
