/**
 * i18n 国际化核心模块
 * 模块化多语言架构，当前只启用 zh-CN / en
 */
import { buildLocales } from '../locales/index.js'

const LANGS = buildLocales()
import { getPanelSetting, patchPanelSettings } from './panel-settings.js'

const LANG_KEY = 'evopanel_lang'
const LANG_KEY_LEGACY = 'evopanel_lang'
const FALLBACK = 'zh-CN'

let _lang = FALLBACK
let _dict = LANGS[FALLBACK]
let _listeners = []

/**
 * 翻译函数
 * @param {string} key - 点分隔路径，如 'sidebar.dashboard'
 * @param {object} [params] - 插值参数，如 { count: 3 } 替换 {count}
 * @returns {string}
 */
export function t(key, params) {
  let val = _resolve(_dict, key)
  if (val === undefined) {
    // fallback 到中文
    val = _resolve(LANGS[FALLBACK], key)
  }
  if (val === undefined) return key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return val
}

function _resolve(obj, path) {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

/** 获取当前语言 */
export function getLang() { return _lang }

/** 获取所有可用语言（本界面仅简体中文 / English） */
export function getAvailableLangs() {
  return [
    { code: 'zh-CN', label: '简体中文' },
    { code: 'en', label: 'English' },
  ]
}

/** 界面语言 → 后端 prompt_language（'zh' / 'en'），用于让 AI 回复语言跟随界面 */
export function getPromptLanguage() {
  return String(_lang || '').startsWith('en') ? 'en' : 'zh'
}

/** 语言 → <html lang>，供读屏软件与浏览器排版/字体选择使用 */
function _applyDocumentLang(lang) {
  try {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  } catch {
    /* ignore */
  }
}

/**
 * 静态 HTML（index.html 壳层：启动引导 / 回收站 / 新建项目弹窗）翻译。
 * 这些节点在模块脚本执行前就已解析，只能靠 data-i18n* 标记后回填。
 * 只替换 textContent，所以带图标的按钮要把文字包进 <span data-i18n="…">。
 */
export function applyStaticI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null)
  if (!scope || typeof scope.querySelectorAll !== 'function') return
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (key) el.textContent = t(key)
  })
  const attrMap = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
  ]
  for (const [attr, target] of attrMap) {
    scope.querySelectorAll(`[${attr}]`).forEach((el) => {
      const key = el.getAttribute(attr)
      if (key) el.setAttribute(target, t(key))
    })
  }
}

/** 切换语言 */
export function setLang(lang) {
  if (!LANGS[lang]) return
  _lang = lang
  _dict = LANGS[lang]
  _applyDocumentLang(lang)
  applyStaticI18n()
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* ignore */
  }
  void patchPanelSettings({ locale: lang })
  _listeners.forEach(fn => { try { fn(lang) } catch {} })
}

/** 监听语言变化 */
export function onLangChange(fn) {
  _listeners.push(fn)
  return () => { _listeners = _listeners.filter(cb => cb !== fn) }
}

/** 初始化：localStorage > navigator.language > fallback */
function _resolveInitialLang() {
  let saved = getPanelSetting('locale', '') || localStorage.getItem(LANG_KEY)
  if (!saved) {
    try {
      const legacy = localStorage.getItem(LANG_KEY_LEGACY)
      if (legacy && LANGS[legacy]) {
        localStorage.setItem(LANG_KEY, legacy)
        saved = legacy
      }
    } catch {
      /* ignore */
    }
  }
  if (saved && LANGS[saved]) {
    _lang = saved
    _dict = LANGS[saved]
    _applyDocumentLang(saved)
    return
  }
  // 自动检测浏览器语言（仅区分中文 / 英文，其余归入中文）
  const nav = navigator.language || navigator.languages?.[0] || ''
  if (nav.startsWith('en')) {
    _lang = 'en'
  } else {
    _lang = FALLBACK
  }
  _dict = LANGS[_lang] || LANGS[FALLBACK]
  _applyDocumentLang(_lang)
}

/**
 * 应用启动时调用一次：确定语言 → 回填静态壳层文案 →
 * 给 index.html 的内联脚本（回收站 / 新建项目弹窗，运行在模块作用域之外）
 * 暴露一个取文案的全局桥。src/ 内的模块仍应 import { t }。
 */
export function initI18n() {
  _resolveInitialLang()
  if (typeof window !== 'undefined') window.gogoT = t
  applyStaticI18n()
}
