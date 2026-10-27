/**
 * IDE 工作台（deepseek-harness / main 专属编码工作台）
 * - 全宽嵌入 openvscode-server iframe（http://localhost:18082，挂载 /d:/Myproject/smart-qa-v2.0-main）
 * - AI 对话使用 IDE 内置 Copilot 面板（VSCode 自带），不再自绘右侧对话
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/tauri-api.js'
import { navigate } from '../../router.js'
import { getTheme } from '../../lib/theme.js'
import { THEME_PRESET_EVENT } from '../../lib/theme-presets.js'

const VSCODE_BASE = 'http://localhost:18082'
const VSCODE_FOLDER = '/d:/Myproject/smart-qa-v2.0-main'
const WORKSPACE_DISPLAY = 'D:\\Myproject\\smart-qa-v2.0-main'

/** GoGo 主题 → VSCode 颜色主题名 */
function resolveVscodeTheme(): string {
  const t = getTheme() // 'light' | 'dark' | 'warm'
  if (t === 'dark') return 'Default Dark+'
  return 'Default Light+'
}

function buildVscodeUrl(): string {
  const theme = encodeURIComponent(resolveVscodeTheme())
  return `${VSCODE_BASE}/?folder=${VSCODE_FOLDER}&window.colorTheme=${theme}`
}

export default function IdeApp() {
  const [engineUp, setEngineUp] = useState<boolean | null>(null)
  const [starting, setStarting] = useState(false)
  const [vscodeUrl, setVscodeUrl] = useState<string>(buildVscodeUrl)

  // 监听 GoGo 主题切换 + 主题预设切换，动态刷新 iframe URL
  useEffect(() => {
    const onThemeChange = () => setVscodeUrl(buildVscodeUrl())
    window.addEventListener('evopanel-theme-pref-changed', onThemeChange)
    window.addEventListener(THEME_PRESET_EVENT, onThemeChange)
    return () => {
      window.removeEventListener('evopanel-theme-pref-changed', onThemeChange)
      window.removeEventListener(THEME_PRESET_EVENT, onThemeChange)
    }
  }, [])

  // ---- 引擎探测（:18082）+ 首次失败自动拉起 ----
  useEffect(() => {
    let alive = true
    let autoStarted = false
    const check = async () => {
      try {
        await fetch(`${VSCODE_BASE}/`, { mode: 'no-cors' })
        if (alive) setEngineUp(true)
      } catch {
        if (alive) {
          setEngineUp(false)
          // 引擎没起 → 自动启动一次（按钮仍可兜底）
          if (!autoStarted) {
            autoStarted = true
            void startEngine()
          }
        }
      }
    }
    check()
    const t = window.setInterval(check, 5000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 一键启动本地引擎（无 Docker） ----
  const startEngine = useCallback(async () => {
    if (starting) return
    setStarting(true)
    setEngineUp(null)
    try {
      const r = await api.ide_engine_start()
      console.log('[ide] engine start:', r)
      // 启动后轮询探测，最多等 30s
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 1000))
        try {
          await fetch(`${VSCODE_BASE}/`, { mode: 'no-cors' })
          setEngineUp(true)
          break
        } catch {
          /* keep polling */
        }
      }
    } catch (e) {
      console.warn('[ide] engine start failed', e)
      setStarting(false)
      setEngineUp(false)
    } finally {
      setStarting(false)
    }
  }, [starting])

  const engineStateClass = engineUp === null ? 'checking' : engineUp ? 'up' : 'down'
  const engineStateLabel = engineUp === null ? '检测中' : engineUp ? '引擎运行中 :18082' : '引擎未启动'

  return (
    <div className="ide-app">
      {/* 顶栏 */}
      <div className="ide-top">
        <button
          type="button"
          className="back"
          onClick={() => navigate('/chat')}
          title="返回对话"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          返回对话
        </button>
        <span className="title">
          <span className="ide-tag">IDE</span>
          deepseek-harness · 编码工作台
        </span>
        <span className="spacer" />
        <span className="ws-path" title={WORKSPACE_DISPLAY}>{WORKSPACE_DISPLAY}</span>
        <span className={`engine-state ${engineStateClass}`}>
          <span className="dot" />
          {engineStateLabel}
        </span>
      </div>

      <div className="ide-main">
        {/* openvscode-server 嵌入区（全宽，AI 对话用 IDE 内置 Copilot） */}
        <div className="ide-vsc">
          {engineUp ? (
            <iframe
              src={vscodeUrl}
              title="openvscode-server"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <div className="ide-engine-off">
              <div className="card">
                <h2>VSCode 引擎未启动</h2>
                <p className="sub">
                  IDE 工作台需要 GoGo IDE 本地引擎（openvscode-server，端口 18082，纯本地 node 进程，无 Docker）。
                  点击下方按钮一键启动，启动后自动嵌入左侧编辑器，文件树为当前工作区项目。
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={starting}
                    onClick={() => void startEngine()}
                  >
                    {starting ? '引擎启动中…' : '启动 GoGo IDE 引擎'}
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setEngineUp(null)}>
                    重新检测引擎
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
