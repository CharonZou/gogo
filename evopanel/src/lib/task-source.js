/**
 * 任务来源 — 仅三种：chat / workflow / role（与后端 task_source 对齐）。
 * 展示文案跟随界面语言（zh 侧与改造前逐字一致）；筛选/统计请用 normalizeTaskSource 的规范 key。
 */

import { getLang, t as i18nT } from './i18n.js'

const SOURCE_LABELS = {
  chat: '主对话',
  workflow: '工作流',
  role: '智能体岗位',
}

const SOURCE_ALIASES = {
  conversation: 'chat',
  chat_mention: 'chat',
  main_chat: 'chat',
  manual: 'chat',
  cli: 'chat',
  api: 'chat',
  restart_task: 'chat',
  automation: 'workflow',
  task_center: 'workflow',
  app: 'workflow',
  app_runner: 'workflow',
  app_runner_lead: 'workflow',
  supervisor: 'workflow',
  proactive: 'role',
  proactive_patrol: 'role',
  proactive_dispatch: 'role',
  proactive_initiative: 'role',
  proactive_think: 'role',
  xiaomi: 'role',
  employee_page: 'role',
  role_work: 'role',
}

/** @param {unknown} raw */
export function normalizeTaskSource(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if (!s) return ''
  if (SOURCE_LABELS[s]) return s
  if (s.startsWith('event:') || s.startsWith('dispatch:')) return 'role'
  return SOURCE_ALIASES[s] || 'chat'
}

/** 规范来源 key → i18n key（见 locales/modules/tasks.js） */
const SOURCE_I18N_KEY = {
  chat: 'tasks.sourceChat',
  workflow: 'tasks.sourceWorkflow',
  role: 'tasks.sourceRole',
}

/** @param {unknown} raw */
export function formatTaskSourceZh(raw) {
  const canon = normalizeTaskSource(raw)
  if (!canon) return i18nT('tasks.sourceUnset')
  if (getLang() === 'en') {
    const key = SOURCE_I18N_KEY[canon]
    const label = key ? i18nT(key) : ''
    // 词典缺键时 t() 会把 key 原样返回，此时退回中文
    if (label && label !== key) return label
  }
  return SOURCE_LABELS[canon] || canon
}

/**
 * 按界面语言返回来源展示文案（仅供展示）。
 * 筛选 / 统计 / 下钻一律继续用 normalizeTaskSource 的规范 key（chat / workflow / role），
 * 也不要拿本函数的返回值做字符串比较——判空请用 normalizeTaskSource（空串即未标注）。
 * @param {unknown} raw
 * @param {(key: string, params?: object) => string} [translate] i18n 的 t / React 的 useT()；缺省用全局 t
 */
export function formatTaskSourceLabel(raw, translate) {
  const zh = formatTaskSourceZh(raw)
  const tr = typeof translate === 'function' ? translate : i18nT
  const key = SOURCE_I18N_KEY[normalizeTaskSource(raw)] || 'tasks.sourceUnset'
  const label = tr(key)
  // 词典缺键时 t() 会把 key 原样返回，此时退回中文，避免界面出现 tasks.xxx
  return label && label !== key ? label : zh
}

export function listTaskSources() {
  return Object.entries(SOURCE_LABELS).map(([id, labelZh]) => ({ id, labelZh }))
}
