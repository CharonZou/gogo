/**
 * 主题预设：一键应用背景图 + 明暗主题 + 强调色 + 不透明度
 * 预设图片位于 public/presets（vite 直接服务为 /presets/*）
 */
import { setThemePreference } from './theme.js'
import { setAccentCustomPreference } from './accent-theme.js'
import {
  getBackgroundImagePreference,
  setBackgroundImagePreference,
  setBackgroundOpacityPreference,
} from './appearance-background.js'

export const THEME_PRESET_EVENT = 'evopanel-theme-preset-changed'

export const THEME_PRESETS = [
  { id: 'yellow-black', name: '曜金黑', image: '/presets/ipad-2019-yellow-black-abstract.jpeg', theme: 'dark', accent: '#f59e0b', opacity: 0.5 },
  { id: 'white-cyan', name: '晴空白', image: '/presets/ipad-2019-white-cyan-abstract.jpeg', theme: 'light', accent: '#06b6d4', opacity: 0.35 },
  { id: 'red-black', name: '熔岩红', image: '/presets/ipad-2019-red-black-gradient.jpeg', theme: 'dark', accent: '#ef4444', opacity: 0.5 },
  { id: 'purple-silver', name: '星云紫', image: '/presets/ipad-2019-purple-silver-gradient.png', theme: 'dark', accent: '#8b5cf6', opacity: 0.45 },
  { id: 'orange-white', name: '晨曦橙', image: '/presets/ipad-2019-orange-white-abstract.jpg', theme: 'light', accent: '#f97316', opacity: 0.4 },
  { id: 'gold-black', name: '鎏金黑', image: '/presets/ipad-2019-gold-black-gradient.jpeg', theme: 'dark', accent: '#d97706', opacity: 0.45 },
  { id: 'blue-white', name: '晴空蓝', image: '/presets/ipad-2019-blue-white-gradient.jpeg', theme: 'dark', accent: '#6366f1', opacity: 0.45 },
  { id: 'black-orange', name: '烈焰橙', image: '/presets/ipad-2019-black-orange-gradient.jpeg', theme: 'dark', accent: '#f97316', opacity: 0.5 },
  { id: 'black-orange-alt-b', name: '暮光橙', image: '/presets/ipad-2019-black-orange-gradient-alt-b.png', theme: 'dark', accent: '#ef4444', opacity: 0.5 },
  { id: 'black-orange-alt-a', name: '琥珀橙', image: '/presets/ipad-2019-black-orange-gradient-alt-a.jpg', theme: 'dark', accent: '#ea580c', opacity: 0.5 },
  { id: 'black-orange-abstract', name: '流光橙', image: '/presets/ipad-2019-black-orange-abstract.jpg', theme: 'dark', accent: '#f59e0b', opacity: 0.5 },
  { id: 'black-cyan', name: '深空青', image: '/presets/ipad-2019-black-cyan-gradient.jpeg', theme: 'dark', accent: '#22d3ee', opacity: 0.5 },
  { id: 'black-brown', name: '可可棕', image: '/presets/ipad-2019-black-brown-gradient.jpeg', theme: 'dark', accent: '#a16207', opacity: 0.5 },
  { id: 'black-brown-alt-a', name: '榛栗棕', image: '/presets/ipad-2019-black-brown-gradient-alt-a.jpeg', theme: 'dark', accent: '#92400e', opacity: 0.5 },
  { id: 'black-blue', name: '曜夜蓝', image: '/presets/ipad-2019-black-blue-gradient.jpeg', theme: 'dark', accent: '#3b82f6', opacity: 0.5 },
  { id: 'beige-white', name: '暖沙白', image: '/presets/ipad-2019-beige-white-abstract.jpeg', theme: 'light', accent: '#c99a6b', opacity: 0.35 },
]

/** 当前背景是否为某预设（用于高亮选中态） */
export function getActiveThemePresetId() {
  const bg = getBackgroundImagePreference()
  if (!bg) return null
  const hit = THEME_PRESETS.find((p) => p.image === bg)
  return hit ? hit.id : null
}

/**
 * 应用主题预设：明暗主题 + 强调色 + 背景图 + 不透明度
 * @param {string} id
 * @returns {object|null} 命中的预设
 */
export function applyThemePreset(id) {
  const preset = THEME_PRESETS.find((p) => p.id === id)
  if (!preset) return null
  setThemePreference(preset.theme)
  setAccentCustomPreference(preset.accent)
  setBackgroundImagePreference(preset.image)
  setBackgroundOpacityPreference(preset.opacity)
  window.dispatchEvent(new CustomEvent(THEME_PRESET_EVENT, { detail: { id: preset.id } }))
  return preset
}
