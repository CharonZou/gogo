/**
 * 界面字体偏好：面板设置「外观 → 界面字体」。
 * 字体分组跟随界面语言（仅中文 / English），不再单独提供语言切换入口；
 * 选择时懒加载对应 CSS（CDN），并覆盖 --gogo-ui-font-family / --font-sans / --font-sans-chat。
 */
import { getPanelSetting, patchPanelSettings } from './panel-settings.js'

export const UI_FONT_EVENT = 'evopanel-ui-font-changed'

const UI_FONT_KEY = 'uiFont'
const FONT_LINK_ATTR = 'data-gogo-ui-font'

/** 字体分组 id：与界面语言一一对应 */
export const UI_FONT_GROUP_ZH = 'zh'
export const UI_FONT_GROUP_EN = 'en'

/** 界面语言码 → 字体分组（非英文一律用中文字体组） */
export function getUiFontGroupForLang(langCode) {
  return String(langCode || '').startsWith('en') ? UI_FONT_GROUP_EN : UI_FONT_GROUP_ZH
}

const ZH_FALLBACK = "'PingFang SC', 'Microsoft YaHei', sans-serif"

/**
 * 内置字体清单。lang: 所属语言分组；css: 选中时懒加载的样式表；
 * family: 覆盖到 CSS 变量的字体栈。
 */
export const UI_FONT_OPTIONS = [
  // ── 通用 ──
  {
    id: 'system',
    label: '跟随系统',
    desc: 'Inter + 系统中文字体（默认）',
    family: '',
  },
  // ── 中文 ──
  {
    id: 'noto-sans',
    lang: 'zh',
    label: '思源黑体',
    desc: '现代通用，Google 与 Adobe 联合出品',
    family: `'Noto Sans SC', 'Inter', system-ui, ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap'],
  },
  {
    id: 'misans',
    lang: 'zh',
    label: 'MiSans',
    desc: '小米出品，圆润饱满',
    family: `'MiSans', 'Inter', system-ui, ${ZH_FALLBACK}`,
    css: [
      'https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Regular.min.css',
      'https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Medium.min.css',
      'https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Semibold.min.css',
    ],
  },
  {
    id: 'lxgw-wenkai',
    lang: 'zh',
    label: '霞鹜文楷',
    desc: '楷体风格，温润易读',
    family: `'LXGW WenKai', 'Inter', system-ui, ${ZH_FALLBACK}`,
    css: ['https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css'],
  },
  {
    id: 'noto-serif',
    lang: 'zh',
    label: '思源宋体',
    desc: '衬线字体，书面阅读感',
    family: `'Noto Serif SC', Georgia, 'Songti SC', 'SimSun', serif`,
    css: ['https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;700&display=swap'],
  },
  {
    id: 'smiley-sans',
    lang: 'zh',
    label: '得意黑',
    desc: '斜体窄身，标题感强',
    family: `'Smiley Sans Oblique', 'Inter', system-ui, ${ZH_FALLBACK}`,
    css: ['https://cdn.jsdelivr.net/npm/cn-fontsource-smiley-sans-oblique-regular/font.css'],
  },
  {
    id: 'zcool-xiaowei',
    lang: 'zh',
    label: '站酷小薇（艺术）',
    desc: '典雅宋体风标题字',
    family: `'ZCOOL XiaoWei', 'Noto Serif SC', 'Songti SC', 'SimSun', serif`,
    css: ['https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap'],
  },
  {
    id: 'zcool-kuaile',
    lang: 'zh',
    label: '站酷快乐体（艺术）',
    desc: '活泼手绘风',
    family: `'ZCOOL KuaiLe', 'Noto Sans SC', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap'],
  },
  {
    id: 'ma-shan-zheng',
    lang: 'zh',
    label: '马善政楷书（书法）',
    desc: '毛笔楷书，笔锋浓烈',
    family: `'Ma Shan Zheng', 'LXGW WenKai', 'KaiTi', 'STKaiti', serif`,
    css: ['https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap'],
  },
  // ── 英文 ──
  {
    id: 'inter',
    lang: 'en',
    label: 'Inter',
    desc: '现代无衬线（默认西文）',
    family: `'Inter', system-ui, ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap'],
  },
  {
    id: 'roboto',
    lang: 'en',
    label: 'Roboto',
    desc: 'Google 经典无衬线',
    family: `'Roboto', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap'],
  },
  {
    id: 'poppins',
    lang: 'en',
    label: 'Poppins',
    desc: '几何圆润，友好现代',
    family: `'Poppins', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;700&display=swap'],
  },
  {
    id: 'montserrat',
    lang: 'en',
    label: 'Montserrat',
    desc: '都市感无衬线',
    family: `'Montserrat', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700&display=swap'],
  },
  {
    id: 'playfair-display',
    lang: 'en',
    label: 'Playfair Display（艺术）',
    desc: '优雅高对比衬线',
    family: `'Playfair Display', Georgia, 'Noto Serif SC', serif`,
    css: ['https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&display=swap'],
  },
  {
    id: 'bebas-neue',
    lang: 'en',
    label: 'Bebas Neue（艺术）',
    desc: '窄体大写海报风',
    family: `'Bebas Neue', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap'],
  },
  {
    id: 'pacifico',
    lang: 'en',
    label: 'Pacifico（艺术）',
    desc: '手写花体',
    family: `'Pacifico', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Pacifico&display=swap'],
  },
  {
    id: 'orbitron',
    lang: 'en',
    label: 'Orbitron（艺术）',
    desc: '科幻未来感',
    family: `'Orbitron', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap'],
  },
  {
    id: 'press-start-2p',
    lang: 'en',
    label: 'Press Start 2P（艺术）',
    desc: '8-bit 像素复古',
    family: `'Press Start 2P', 'Inter', ${ZH_FALLBACK}`,
    css: ['https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'],
  },
  // ── 日语 / 韩语字体已随语言精简移除 ──
]

function findOption(id) {
  return UI_FONT_OPTIONS.find((o) => o.id === id) || UI_FONT_OPTIONS[0]
}

export function getUiFontPreference() {
  return findOption(getPanelSetting(UI_FONT_KEY, 'system')).id
}

/** 当前所选字体所属的语言分组（未知/已下线的分组回落到中文字体） */
export function getUiFontGroupOf(id = getUiFontPreference()) {
  const group = findOption(id).lang
  return group === UI_FONT_GROUP_EN ? UI_FONT_GROUP_EN : UI_FONT_GROUP_ZH
}

/** 应用字体：懒加载/移除 CDN 样式 + 覆盖字体变量（即时生效） */
export function applyUiFontPreference(id = getUiFontPreference()) {
  const opt = findOption(id)
  if (typeof document === 'undefined') return opt.id

  document.querySelectorAll(`link[${FONT_LINK_ATTR}]`).forEach((el) => el.remove())
  if (opt.css && opt.css.length) {
    for (const href of opt.css) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      link.setAttribute(FONT_LINK_ATTR, '1')
      document.head.appendChild(link)
    }
  }

  const root = document.documentElement
  if (opt.family) {
    root.style.setProperty('--gogo-ui-font-family', opt.family)
    root.style.setProperty('--font-sans', opt.family)
    root.style.setProperty('--font-sans-chat', opt.family)
  } else {
    root.style.removeProperty('--gogo-ui-font-family')
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-sans-chat')
  }
  return opt.id
}

/** 保存偏好（面板设置持久化）并即时应用 */
export async function setUiFontPreference(id) {
  const opt = findOption(id)
  applyUiFontPreference(opt.id)
  window.dispatchEvent(new CustomEvent(UI_FONT_EVENT, { detail: { id: opt.id } }))
  await patchPanelSettings({ [UI_FONT_KEY]: opt.id })
  return opt.id
}

/** 启动时应用；面板设置（可能来自远端）加载后重新应用 */
export function initUiFontPreference() {
  applyUiFontPreference()
  window.addEventListener('evopanel:panel-settings-loaded', () => applyUiFontPreference())
}
