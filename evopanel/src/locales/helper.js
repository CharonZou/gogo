/**
 * i18n 多语言辅助函数
 * 参数顺序: zhCN, en, zhTW, ja, ko, vi, es, pt, ru, fr, de
 * 缺省 fallback: zhTW→zhCN, 其余→en
 *
 * 本界面只启用简体中文 + English：SUPPORTED_LANGS 决定实际构建哪些语言字典，
 * _(… ) 的多余参数仍保留（历史文案数据，不再对外暴露）。
 */
export const SUPPORTED_LANGS = ['zh-CN', 'en']

export function _(zhCN, en, zhTW, ja, ko, vi, es, pt, ru, fr, de) {
  return {
    'zh-CN': zhCN,
    en,
    'zh-TW': zhTW || zhCN,
    ja: ja || en,
    ko: ko || en,
    vi: vi || en,
    es: es || en,
    pt: pt || en,
    ru: ru || en,
    fr: fr || en,
    de: de || en,
  }
}
