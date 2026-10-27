/**
 * 聊天头部「打开」分裂按钮：在 资源管理器 / VS Code / Trae / IDEA 中
 * 打开当前会话绑定的工作空间（由网关在宿主机启动对应程序）。
 * 记住上次使用的应用：按钮图标变为该应用 logo，菜单项打勾；
 * 点击左侧主体直接用上次应用打开，点击右侧箭头展开菜单。
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/tauri-api.js'
import { toast } from '../../components/toast.js'
import { useT } from '../lib/useI18n'

type AppId = 'explorer' | 'vscode' | 'trae' | 'idea'

type AppOption = { id: AppId; label: string; icon: string }

const APP_IDS: AppId[] = ['explorer', 'vscode', 'trae', 'idea']

function appOptions(t: (key: string) => string): AppOption[] {
  return [
    { id: 'explorer', label: t('chatShell.wolAppExplorer'), icon: '/images/apps/explorer.png' },
    { id: 'vscode', label: 'VS Code', icon: '/images/apps/vscode.png' },
    { id: 'trae', label: 'Trae', icon: '/images/apps/trae.png' },
    { id: 'idea', label: 'IntelliJ IDEA', icon: '/images/apps/idea.png' },
  ]
}

const LAST_APP_KEY = 'gogo_open_project_last_app'

function loadLastApp(): AppId | null {
  try {
    const v = window.localStorage.getItem(LAST_APP_KEY) as AppId | null
    if (v && APP_IDS.includes(v)) return v
  } catch { /* ignore */ }
  return null
}

function DefaultFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M3 8.5V6a1.5 1.5 0 011.5-1.5h3.9l1.8 1.8h7.3A1.5 1.5 0 0119 7.8v.7" fill="#ffb02e" />
      <path d="M2.3 8.5h19.4a.8.8 0 01.79.93l-1.5 8.6a1.6 1.6 0 01-1.57 1.32H4.58a1.6 1.6 0 01-1.57-1.32l-1.5-8.6a.8.8 0 01.79-.93z" fill="#4aa3ff" />
      <path d="M2.3 8.5h19.4a.8.8 0 01.79.93l-.28 1.62H1.79L1.51 9.43a.8.8 0 01.79-.93z" fill="#2f7fe0" />
    </svg>
  )
}

export function WorkspaceOpenLauncher({ workspaceRoot }: { workspaceRoot?: string | null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [lastApp, setLastApp] = useState<AppId | null>(loadLastApp)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const options = appOptions(t)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  const handleOpen = (appId: AppId) => {
    setOpen(false)
    setLastApp(appId)
    try { window.localStorage.setItem(LAST_APP_KEY, appId) } catch { /* ignore */ }
    const root = String(workspaceRoot || '').trim()
    toast(root ? t('home.toastOpening') : t('chatShell.wolOpeningNoWs'), 'info')
    api
      .openWorkspaceExternal(appId, root)
      .then((res: { ok?: boolean; launched?: boolean; detail?: string }) => {
        if (res && res.ok && res.launched) toast(res.detail || t('chatShell.wolOpened'), 'success')
        else toast((res && res.detail) || t('chatShell.wolOpenFailed'), 'error')
      })
      .catch((err: { detail?: string; message?: string }) => {
        const msg = err && (err.detail || err.message) ? (err.detail || err.message) : t('chatShell.wolOpenFailed')
        toast(String(msg), 'error')
      })
  }

  const lastAppInfo = lastApp ? options.find((o) => o.id === lastApp) : null

  return (
    <div className="ws-open-launcher" ref={rootRef}>
      <button
        type="button"
        className="react-chat-header-open-project-btn"
        title={
          lastAppInfo
            ? t('chatShell.wolOpenWithAppTitle', { app: lastAppInfo.label })
            : t('chatShell.wolOpenDefaultTitle')
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (lastAppInfo) handleOpen(lastAppInfo.id)
          else setOpen((v) => !v)
        }}
      >
        <span className="ws-open-launcher-main">
          {lastAppInfo ? <img src={lastAppInfo.icon} alt="" /> : <DefaultFolderIcon />}
          {t('chatShell.wsdOpen')}
        </span>
        <span
          className="ws-open-launcher-arrow"
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="ws-launcher-dropdown open" role="menu" aria-label={t('chatShell.wolMenuAria')}>
          {options.map((opt) => {
            const selected = lastApp === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                className={`ws-launcher-option${selected ? ' is-selected' : ''}`}
                role="menuitem"
                aria-checked={selected}
                title={t('chatShell.wolOpenInAppTitle', { app: opt.label })}
                onClick={() => handleOpen(opt.id)}
              >
                <img src={opt.icon} alt="" />
                <span>{opt.label}</span>
                {selected ? (
                  <svg className="ws-launcher-check" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
