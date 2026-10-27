/**
 * 运行旁白 tip：挂在气泡底部 StreamRunStatusLine（生成中旁），不进 Agent 卡片顶栏。
 */

import { t } from '../../lib/i18n.js'

/** i18n：tips 在调用时刻解析，避免模块级常量固化语言 */
function runProgressTips(): readonly string[] {
  return [
    t('chatUi.runTip01'),
    t('chatUi.runTip02'),
    t('chatUi.runTip03'),
    t('chatUi.runTip04'),
    t('chatUi.runTip05'),
    t('chatUi.runTip06'),
    t('chatUi.runTip07'),
    t('chatUi.runTip08'),
    t('chatUi.runTip09'),
    t('chatUi.runTip10'),
    t('chatUi.runTip11'),
    t('chatUi.runTip12'),
    t('chatUi.runTip13'),
    t('chatUi.runTip14'),
  ]
}

/** 按墙上时钟取稳定 tip，便于轮播间隔内不抖。 */
export function pickRunProgressTip(atMs = Date.now(), intervalMs = 9000): string {
  const list = runProgressTips()
  if (!list.length) return ''
  const idx = Math.floor(Math.max(0, atMs) / Math.max(1000, intervalMs)) % list.length
  return list[idx] || list[0]
}
