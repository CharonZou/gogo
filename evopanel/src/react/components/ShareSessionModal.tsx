import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, getGatewayBaseUrl } from '../../lib/tauri-api.js'
import { getAccessUrls, getWebuiStatus } from '../../lib/webui-remote.js'
import { toast } from '../../components/toast.js'
import {
  messagesToShareMarkdown,
  saveMarkdownExport,
  type ShareMarkdownMessage,
} from '../lib/session-share-markdown.js'
import { useT } from '../lib/useI18n'

type CreatedShare = {
  token: string
  url_path: string
  title: string
  expires_at?: string | null
  message_count?: number
}

function isLocalOnlyBase(url: string): boolean {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url)
  }
}

async function resolveShareBaseUrl(): Promise<{ base: string; localOnly: boolean }> {
  const candidates: string[] = []
  try {
    const status = await getWebuiStatus()
    for (const u of status?.access_urls || []) {
      const s = String(u || '').trim().replace(/\/$/, '')
      if (s) candidates.push(s)
    }
  } catch {
    /* optional */
  }
  try {
    const access = await getAccessUrls()
    for (const u of access?.urls || []) {
      const s = String(u || '').trim().replace(/\/$/, '')
      if (s) candidates.push(s)
    }
  } catch {
    /* optional */
  }
  try {
    const gw = String((await getGatewayBaseUrl()) || '').trim().replace(/\/$/, '')
    if (gw) candidates.push(gw)
  } catch {
    /* optional */
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    candidates.push(String(window.location.origin).replace(/\/$/, ''))
  }
  const unique = [...new Set(candidates.filter(Boolean))]
  const lan = unique.find((u) => !isLocalOnlyBase(u))
  const base = lan || unique[0] || (typeof window !== 'undefined' ? window.location.origin : '')
  return { base: String(base || '').replace(/\/$/, ''), localOnly: isLocalOnlyBase(base) }
}

function buildAbsoluteShareUrl(base: string, urlPath: string): string {
  const path = String(urlPath || '').trim()
  if (/^https?:\/\//i.test(path)) return path
  const b = String(base || '').replace(/\/$/, '')
  if (path.startsWith('/#/')) return `${b}${path}`
  if (path.startsWith('#')) return `${b}/${path}`
  if (path.startsWith('/share/')) return `${b}/#${path}`
  return `${b}/#/share/${path.replace(/^\//, '')}`
}

export function ShareSessionModal({
  open,
  onClose,
  sessionKey,
  sessionTitle,
}: {
  open: boolean
  onClose: () => void
  sessionKey: string
  sessionTitle: string
}) {
  const t = useT()
  const [includeTools, setIncludeTools] = useState(false)
  const [expiresDays, setExpiresDays] = useState<number | null>(7)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedShare | null>(null)
  const [absoluteUrl, setAbsoluteUrl] = useState('')
  const [localOnly, setLocalOnly] = useState(false)
  const [latestToken, setLatestToken] = useState('')

  const sk = String(sessionKey || '').trim()
  const title = String(sessionTitle || '').trim() || t('chatShell.unnamedSession')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setCreated(null)
      setAbsoluteUrl('')
      setBusy(false)
      return
    }
    let cancelled = false
    void (async () => {
      if (!sk) return
      try {
        const res = await api.shareLatestForSession(sk)
        if (cancelled) return
        const share = res?.share
        if (share?.active && share?.token) {
          setLatestToken(String(share.token))
          setCreated({
            token: String(share.token),
            url_path: String(share.url_path || `/#/share/${share.token}`),
            title: String(share.title || title),
            expires_at: share.expires_at,
          })
        } else {
          setLatestToken('')
        }
      } catch {
        if (!cancelled) setLatestToken('')
      }
      try {
        const { base, localOnly: lo } = await resolveShareBaseUrl()
        if (cancelled) return
        setLocalOnly(lo)
        if (created?.url_path || latestToken) {
          const path = created?.url_path || `/#/share/${latestToken}`
          setAbsoluteUrl(buildAbsoluteShareUrl(base, path))
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sk])

  useEffect(() => {
    if (!open || !created?.url_path) return
    let cancelled = false
    void resolveShareBaseUrl().then(({ base, localOnly: lo }) => {
      if (cancelled) return
      setLocalOnly(lo)
      setAbsoluteUrl(buildAbsoluteShareUrl(base, created.url_path))
    })
    return () => {
      cancelled = true
    }
  }, [open, created?.url_path])

  const loadMessagesForExport = useCallback(async (): Promise<ShareMarkdownMessage[]> => {
    const { wsClient } = await import('../../lib/ws-client.js')
    const hist = await wsClient.chatHistory(sk, 5000, { all: true })
    return Array.isArray(hist?.messages) ? hist.messages : []
  }, [sk])

  const copyText = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(okMsg, 'success')
    } catch {
      toast(t('chatShell.ssmCopyManualFail'), 'error')
    }
  }

  const onExportCopy = async () => {
    if (!sk || busy) return
    setBusy(true)
    try {
      const messages = await loadMessagesForExport()
      const md = messagesToShareMarkdown(title, messages, { includeTools })
      await copyText(md, t('chatShell.ssmCopiedMarkdown'))
    } catch (e) {
      toast(t('chatShell.ssmExportFailed', { err: String((e as Error)?.message || e) }), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onExportDownload = async () => {
    if (!sk || busy) return
    setBusy(true)
    try {
      const messages = await loadMessagesForExport()
      const md = messagesToShareMarkdown(title, messages, { includeTools })
      const result = await saveMarkdownExport(title, md)
      if (!result.ok) {
        toast(t('chatShell.ssmSaveCancelled'), 'info')
        return
      }
      if (result.mode === 'path') {
        toast(t('chatShell.ssmSavedTo', { path: result.path }), 'success', { duration: 6000 })
      } else {
        toast(t('chatShell.ssmDownloadStarted', { name: result.filename }), 'success', {
          duration: 6000,
        })
      }
    } catch (e) {
      toast(t('chatShell.ssmDownloadFailed', { err: String((e as Error)?.message || e) }), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onCreateLink = async () => {
    if (!sk || busy) return
    setBusy(true)
    try {
      const res = await api.shareCreate({
        session_key: sk,
        expires_in_days: expiresDays,
        include_tools: includeTools,
      })
      const next: CreatedShare = {
        token: String(res?.token || ''),
        url_path: String(res?.url_path || ''),
        title: String(res?.title || title),
        expires_at: res?.expires_at,
        message_count: res?.message_count,
      }
      setCreated(next)
      setLatestToken(next.token)
      const { base, localOnly: lo } = await resolveShareBaseUrl()
      setLocalOnly(lo)
      const abs = buildAbsoluteShareUrl(base, next.url_path || `/#/share/${next.token}`)
      setAbsoluteUrl(abs)
      await copyText(abs, t('chatShell.ssmShareLinkCopied'))
    } catch (e) {
      toast(t('chatShell.ssmCreateFailed', { err: String((e as Error)?.message || e) }), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRevoke = async () => {
    const token = String(created?.token || latestToken || '').trim()
    if (!token || busy) return
    setBusy(true)
    try {
      await api.shareRevoke(token)
      setCreated(null)
      setLatestToken('')
      setAbsoluteUrl('')
      toast(t('chatShell.ssmRevoked'), 'success')
    } catch (e) {
      toast(t('chatShell.ssmRevokeFailed', { err: String((e as Error)?.message || e) }), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="react-chat-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('chatShell.ssmTitle')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="react-chat-modal-card react-chat-share-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="react-chat-modal-header">
          <div>
            <div className="react-chat-modal-title">{t('chatShell.ssmTitle')}</div>
            <div className="react-chat-share-modal-sub" title={title}>
              {title}
            </div>
          </div>
          <button type="button" className="react-chat-modal-close" onClick={onClose} aria-label={t('chatShell.closeAria')}>
            ×
          </button>
        </div>

        <div className="react-chat-modal-body react-chat-share-modal-body">
          <section className="react-chat-share-section" aria-label={t('chatShell.ssmLinkSection')}>
            <div className="react-chat-share-section-title">{t('chatShell.ssmLinkSection')}</div>
            <p className="react-chat-share-hint">
              {t('chatShell.ssmLinkHint')}
            </p>
            <label className="react-chat-share-check">
              <input
                type="checkbox"
                checked={includeTools}
                onChange={(e) => setIncludeTools(e.target.checked)}
                disabled={busy}
              />
              {t('chatShell.ssmIncludeTools')}
            </label>
            <label className="react-chat-share-field">
              <span>{t('chatShell.ssmExpiryLabel')}</span>
              <select
                value={expiresDays == null ? 'never' : String(expiresDays)}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value
                  setExpiresDays(v === 'never' ? null : Number(v))
                }}
              >
                <option value="7">{t('chatUi.days7')}</option>
                <option value="30">{t('chatUi.days30')}</option>
                <option value="never">{t('chatUi.neverExpires')}</option>
              </select>
            </label>
            {absoluteUrl ? (
              <div className="react-chat-share-link-box">
                <input
                  className="react-chat-modal-input"
                  readOnly
                  value={absoluteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                {localOnly ? (
                  <p className="react-chat-share-warn">
                    {t('chatShell.ssmLocalhostWarn')}
                  </p>
                ) : null}
                {created?.expires_at ? (
                  <p className="react-chat-share-meta">{t('chatShell.ssmExpireAt', { time: String(created.expires_at) })}</p>
                ) : created ? (
                  <p className="react-chat-share-meta">{t('chatUi.neverExpires')}</p>
                ) : null}
              </div>
            ) : null}
            <div className="react-chat-share-actions">
              <button
                type="button"
                className="react-chat-modal-btn react-chat-modal-btn--primary"
                disabled={busy || !sk}
                onClick={() => void onCreateLink()}
              >
                {absoluteUrl ? t('chatShell.ssmRegenerate') : t('chatShell.ssmCreate')}
              </button>
              {absoluteUrl ? (
                <button
                  type="button"
                  className="react-chat-modal-btn react-chat-modal-btn--ghost"
                  disabled={busy}
                  onClick={() => void copyText(absoluteUrl, t('chatShell.ssmLinkCopied'))}
                >
                  {t('chatShell.ssmCopyLink')}
                </button>
              ) : null}
              {created?.token || latestToken ? (
                <button
                  type="button"
                  className="react-chat-modal-btn react-chat-modal-btn--ghost"
                  disabled={busy}
                  onClick={() => void onRevoke()}
                >
                  {t('chatShell.ssmRevokeLink')}
                </button>
              ) : null}
            </div>
          </section>

          <section className="react-chat-share-section" aria-label={t('chatShell.ssmExportSection')}>
            <div className="react-chat-share-section-title">{t('chatShell.ssmExportSection')}</div>
            <p className="react-chat-share-hint">{t('chatShell.ssmExportHint')}</p>
            <div className="react-chat-share-actions">
              <button
                type="button"
                className="react-chat-modal-btn react-chat-modal-btn--ghost"
                disabled={busy || !sk}
                onClick={() => void onExportCopy()}
              >
                {t('chatShell.ssmCopyMarkdown')}
              </button>
              <button
                type="button"
                className="react-chat-modal-btn react-chat-modal-btn--ghost"
                disabled={busy || !sk}
                onClick={() => void onExportDownload()}
              >
                {t('chatShell.ssmSaveMd')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
