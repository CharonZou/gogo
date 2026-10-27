/**
 * 员工工作空间：在当前员工下切换 / 新开对话会话（duty·task·chat）。
 */
import { useEffect, useState } from 'react'
import { api } from '../../lib/tauri-api.js'
import { useT } from '../lib/useI18n'
import {
  mintEmployeeChatEpisodeId,
  type EmployeeTalkMode,
} from './EmployeeTalkModeBar.js'

export type EmployeeConversationRow = {
  session_key: string
  title?: string
  kind?: string
  task_id?: string | null
  run_status?: string
  updated_at?: string
  legacy?: boolean
}

export type EmployeeWorkspaceSwitcherProps = {
  agentCode: string
  activeSessionKey: string
  onSelectSession: (sessionKey: string) => void
  onNewChatSession: (sessionKey: string) => void
  talkMode?: EmployeeTalkMode
}

/** 会话类型标签：未知 kind 原样展示后端值，空值才用 UI 兜底文案 */
function kindLabel(kind: string | undefined, translate: (key: string) => string): string {
  const k = String(kind || '').trim()
  if (k === 'task') return translate('chatShell.kindTask')
  if (k === 'duty') return translate('chatShell.kindDuty')
  if (k === 'chat') return translate('chatShell.kindChat')
  if (k === 'legacy') return translate('chatShell.kindLegacy')
  return k || translate('chatShell.sessionFallbackTitle')
}

export function EmployeeWorkspaceSwitcher({
  agentCode,
  activeSessionKey,
  onSelectSession,
  onNewChatSession,
}: EmployeeWorkspaceSwitcherProps) {
  const t = useT()
  const [rows, setRows] = useState<EmployeeConversationRow[]>([])
  const [loading, setLoading] = useState(false)
  const code = String(agentCode || '').trim()

  useEffect(() => {
    let cancelled = false
    if (!code) {
      setRows([])
      return
    }
    setLoading(true)
    void (async () => {
      try {
        const res = await api.proactiveListConversations(code, { limit: 40 })
        if (cancelled) return
        const list = Array.isArray(res?.conversations) ? res.conversations : []
        setRows(list)
      } catch {
        if (!cancelled) setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, activeSessionKey])

  if (!code) return null

  const taskRows = rows.filter((r) => r.kind === 'task')
  const otherRows = rows.filter((r) => r.kind !== 'task')

  return (
    <div className="employee-workspace-switcher" title={t('chatShell.employeeWorkspaceTitle')}>
      <label className="employee-workspace-switcher-label">
        <span className="sr-only">{t('chatShell.employeeSessionsAria')}</span>
        <select
          className="employee-talk-resume-select"
          value={activeSessionKey || ''}
          disabled={loading}
          onChange={(e) => {
            const v = String(e.target.value || '').trim()
            if (v === '__new_chat__') {
              const stamp = mintEmployeeChatEpisodeId().replace(/^chat:/, '')
              const sk = `proactive:${code}:chat:${stamp.replace(/[:/\\]/g, '-')}`
              onNewChatSession(sk)
              return
            }
            if (v) onSelectSession(v)
          }}
        >
          <option value="">{t('chatShell.selectSessionPrompt')}</option>
          <option value="__new_chat__">{t('chatShell.newChatOption')}</option>
          {taskRows.length ? (
            <optgroup label={t('chatShell.taskSessionsGroup')}>
              {taskRows.map((r) => (
                <option key={r.session_key} value={r.session_key}>
                  [{kindLabel(r.kind, t)}] {r.title || r.task_id || r.session_key}
                  {r.run_status === 'running' ? t('chatShell.runningStatus') : ''}
                </option>
              ))}
            </optgroup>
          ) : null}
          {otherRows.length ? (
            <optgroup label={t('chatShell.otherGroup')}>
              {otherRows.map((r) => (
                <option key={r.session_key} value={r.session_key}>
                  [{kindLabel(r.kind, t)}] {r.title || r.session_key}
                  {r.run_status === 'running' ? t('chatShell.runningStatus') : ''}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
    </div>
  )
}
