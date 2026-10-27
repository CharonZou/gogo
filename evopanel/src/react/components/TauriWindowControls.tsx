import { useCallback, useEffect, useState } from 'react'
import { useT } from '../lib/useI18n'

function isTauriRuntime(): boolean {
  return !!(typeof window !== 'undefined' && ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ || (window as unknown as { __TAURI__?: unknown }).__TAURI__))
}

export function TauriWindowControls() {
  const t = useT()
  const [show, setShow] = useState(false)

  useEffect(() => {
    queueMicrotask(() => setShow(isTauriRuntime()))
  }, [])

  const minimize = useCallback(() => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => void getCurrentWindow().minimize())
  }, [])
  const toggleMaximize = useCallback(() => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => void getCurrentWindow().toggleMaximize())
  }, [])
  const close = useCallback(() => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => void getCurrentWindow().close())
  }, [])

  if (!show) return null

  return (
    <div className="ep-window-controls">
      <button
        type="button"
        className="ep-window-controls-btn ep-window-controls-btn--min"
        data-tauri-no-drag
        onClick={minimize}
        title={t('shell.windowMinimize')}
        aria-label={t('shell.windowMinimize')}
      >
        −
      </button>
      <button
        type="button"
        className="ep-window-controls-btn ep-window-controls-btn--max"
        data-tauri-no-drag
        onClick={toggleMaximize}
        title={t('shell.windowMaximize')}
        aria-label={t('shell.windowMaximize')}
      >
        □
      </button>
      <button
        type="button"
        className="ep-window-controls-btn ep-window-controls-btn--close"
        data-tauri-no-drag
        onClick={close}
        title={t('chatShell.closeAria')}
        aria-label={t('chatShell.closeAria')}
      >
        ×
      </button>
    </div>
  )
}
