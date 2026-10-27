import { useEffect, useState, type SyntheticEvent } from 'react'
import { showChatLightbox } from '../../lib/chat-lightbox.js'
import {
  parseBrowserScreenshotToolOutput,
  resolveBrowserScreenshotSrc,
  resolveBrowserScreenshotSrcAsync,
} from '../../lib/chat-normalize.js'
import { useT } from '../lib/useI18n'

const isTauri =
  typeof window !== 'undefined' &&
  // @ts-ignore
  !!(window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__)

export type BrowserScreenshotPreviewProps = {
  /** Raw tool output (JSON string or object), not formatToolOutputForUserDisplay text */
  output: unknown
}

export function BrowserScreenshotPreview({ output }: BrowserScreenshotPreviewProps) {
  const t = useT()
  const shot = parseBrowserScreenshotToolOutput(output)
  const [src, setSrc] = useState('')
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    if (!shot?.src) {
      queueMicrotask(() => {
        setSrc('')
        setBroken(false)
      })
      return
    }
    let cancelled = false
    queueMicrotask(() => setBroken(false))
    ;(async () => {
      try {
        const resolved = isTauri
          ? await resolveBrowserScreenshotSrcAsync(shot.src)
          : resolveBrowserScreenshotSrc(shot.src)
        if (!cancelled) setSrc(resolved)
      } catch {
        if (!cancelled) {
          setSrc('')
          setBroken(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [shot?.src])

  if (!shot?.src) return null

  const onImgError = (_e: SyntheticEvent<HTMLImageElement>) => {
    setBroken(true)
  }

  return (
    <div className="msg-tool-block msg-tool-block--screenshot">
      <span className="msg-tool-title">{t('chatShell.bspTitle')}</span>
      {shot.summary ? (
        <p className="msg-tool-screenshot-summary">{shot.summary}</p>
      ) : null}
      {shot.pageUrl ? (
        <p className="msg-tool-screenshot-page">
          <a href={shot.pageUrl} target="_blank" rel="noopener noreferrer">
            {shot.pageUrl}
          </a>
        </p>
      ) : null}
      {broken ? (
        <p className="msg-tool-screenshot-error">
          {t('chatShell.bspLoadFailed')}{' '}
          {src ? (
            <a href={src} target="_blank" rel="noopener noreferrer">
              {t('chatShell.bspOpenNewTab')}
            </a>
          ) : (
            <span>{t('chatShell.bspRetryLater')}</span>
          )}
        </p>
      ) : src ? (
        <button
          type="button"
          className="msg-tool-screenshot-btn"
          title={t('chatShell.zoomIn')}
          aria-label={t('chatShell.bspOpenPreviewAria')}
          onClick={() => showChatLightbox(src)}
        >
          <img
            className="msg-tool-screenshot-img"
            src={src}
            alt={t('chatShell.bspAlt')}
            loading="lazy"
            onError={onImgError}
          />
          <span className="msg-tool-screenshot-hint">{t('chatShell.bspZoomHint')}</span>
        </button>
      ) : (
        <p className="msg-tool-screenshot-loading">{t('chatShell.bspLoading')}</p>
      )}
    </div>
  )
}