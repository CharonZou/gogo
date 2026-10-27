/**
 * React bridge for the panel i18n dictionary (src/lib/i18n.js).
 *
 * The vanilla shell calls the module-level `t()` directly; React islands need to
 * re-render when the locale changes, so `useT()` subscribes to `onLangChange` and
 * returns a `t` bound to the current language.
 */
import { useEffect, useState } from 'react'
import { getLang, onLangChange, t } from '../../lib/i18n.js'

/** `t(key, params)` bound to the current locale; re-renders the component on locale switch. */
export function useT() {
  const [lang, setLang] = useState<string>(() => getLang())
  useEffect(() => onLangChange((next: string) => setLang(next)), [])
  // `t` reads the module-level dictionary, which `setLang` has already swapped by the
  // time listeners run; `lang` only exists to force this render.
  void lang
  return t
}

/** Current UI locale code ('zh-CN' | 'en'), reactive. */
export function useLang() {
  const [lang, setLang] = useState<string>(() => getLang())
  useEffect(() => onLangChange((next: string) => setLang(next)), [])
  return lang
}
