/**
 * 终端后台进程查看面板：
 * - 收起态：浮动胶囊（终端 · 最早运行中任务时长 · N 后台），锚定聊天消息区顶部右侧；
 * - 展开态：列表面板（命令摘要 + 已运行时长 + 停止按钮）；
 * - BgProcessChip：输入框工具栏小芯片（[终端图标] N 后台），经 ChatApp renderBottomControls 注入。
 * 数据一律来自模块级共享 store（bg-processes-store.js），通过 useSyncExternalStore 订阅，
 * 避免 ChatApp 巨型组件自身订阅轮询导致整体重渲染。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronUp, Square, Terminal } from 'lucide-react'
import {
  getBgProcessesSnapshot,
  stopBgProcessById,
  subscribeBgProcesses,
} from '../../lib/bg-processes-store.js'
import { useT } from '../lib/useI18n'

/** 后端 /api/bg-processes 返回的进程条目 */
type BgProcessEntry = {
  id: string
  command?: string
  thread_id?: string | null
  pid?: number | null
  start_time?: number | null
  elapsed_s?: number | null
  running?: boolean
  exited?: boolean
  exit_code?: number | null
  killed?: boolean
}

type BgProcessesSnapshot = {
  processes: BgProcessEntry[]
  runningCount: number
  error: string | null
  lastFetchedAt: number
}

type BackgroundProcessesBarProps = {
  /** 面板是否展开（状态由 ChatApp 持有） */
  open: boolean
  onToggle: () => void
}

/** 命令摘要：取首行，超过 ~48 字符截断加省略号 */
function summarizeCommand(command: string | undefined): string {
  const firstLine = String(command ?? '').split('\n', 1)[0]?.trim() ?? ''
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine
}

/** 已运行秒数：优先用 start_time（epoch 秒，与本机同钟），缺失时回退 elapsed_s */
function elapsedSecondsOf(entry: BgProcessEntry, nowMs: number): number {
  const start = entry.start_time
  if (typeof start === 'number' && Number.isFinite(start) && start > 0) {
    return Math.max(0, Math.floor(nowMs / 1000 - start))
  }
  return Math.max(0, Math.floor(Number(entry.elapsed_s) || 0))
}

/** 时长格式化：<60s → X 秒；<1h → X 分 X 秒；≥1h → X 小时 X 分 X 秒 */
function formatDuration(t: (key: string, params?: Record<string, unknown>) => string, totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return t('chatShell.bgpSeconds', { n: s })
  const minutes = Math.floor(s / 60)
  const hours = Math.floor(minutes / 60)
  if (hours < 1) return t('chatShell.bgpMinSec', { m: minutes, s: s % 60 })
  return t('chatShell.bgpHourMinSec', { h: hours, m: minutes % 60, s: s % 60 })
}

export function BackgroundProcessesBar({ open, onToggle }: BackgroundProcessesBarProps) {
  const t = useT()
  const snapshot = useSyncExternalStore(subscribeBgProcesses, getBgProcessesSnapshot) as BgProcessesSnapshot
  const [now, setNow] = useState(() => Date.now())
  const [stoppingId, setStoppingId] = useState<string | null>(null)

  const runningEntries = snapshot.processes.filter((p) => p?.running === true)
  const runningCount = runningEntries.length

  // 秒级时钟：有运行中进程或面板展开时才启动，避免空转
  useEffect(() => {
    if (!open && runningCount === 0) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open, runningCount])

  // 没有运行中进程时自动复位关闭，防止下次出现进程时面板意外弹开
  useEffect(() => {
    if (open && runningCount === 0) onToggle()
  }, [open, runningCount, onToggle])

  const handleStop = useCallback(async (id: string) => {
    setStoppingId(id)
    try {
      await stopBgProcessById(id)
    } catch {
      /* store 已保留上次数据并记录 error；此处静默，列表会随后续轮询收敛 */
    } finally {
      setStoppingId(null)
    }
  }, [])

  if (runningCount === 0) return null

  // 最早启动的运行中任务（用于胶囊上的时长展示）
  const earliest = runningEntries.reduce<BgProcessEntry | null>((acc, p) => {
    if (!acc) return p
    const at = typeof acc.start_time === 'number' ? acc.start_time : Number.POSITIVE_INFINITY
    const bt = typeof p.start_time === 'number' ? p.start_time : Number.POSITIVE_INFINITY
    return bt < at ? p : acc
  }, null)
  const earliestElapsed = earliest ? elapsedSecondsOf(earliest, now) : 0

  return (
    <div className="react-chat-bgpill-host">
      {open ? (
        <div className="react-chat-bgpill-panel" role="region" aria-label={t('chatShell.bgpAriaLabel')}>
          <button type="button" className="react-chat-bgpill-panel-head" onClick={onToggle} title={t('chatShell.bgpCollapse')}>
            <Terminal size={13} className="react-chat-bgpill-panel-head-icon" aria-hidden />
            <span>{t('chatShell.bgpTerminal')}</span>
            <span className="react-chat-bgpill-panel-head-sub">{t('chatShell.bgpRunningCount', { count: runningCount })}</span>
            <ChevronUp size={14} className="react-chat-bgpill-panel-head-caret" aria-hidden />
          </button>
          <ul className="react-chat-bgpill-list">
            {runningEntries.map((p) => {
              const idStr = String(p?.id ?? '')
              const cmd = summarizeCommand(p?.command)
              return (
                <li key={idStr} className="react-chat-bgpill-item">
                  <Terminal size={13} className="react-chat-bgpill-item-icon" aria-hidden />
                  <span className="react-chat-bgpill-item-cmd" title={String(p?.command ?? '')}>
                    {cmd || idStr}
                  </span>
                  <span className="react-chat-bgpill-item-time">{formatDuration(t, elapsedSecondsOf(p, now))}</span>
                  <button
                    type="button"
                    className="react-chat-bgpill-item-stop"
                    title={t('chatShell.bgpStopTitle')}
                    aria-label={t('chatShell.bgpStopAria', { name: cmd || idStr })}
                    disabled={stoppingId === idStr}
                    onClick={() => void handleStop(idStr)}
                  >
                    <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <button type="button" className="react-chat-bgpill-capsule" onClick={onToggle} title={t('chatShell.bgpAriaLabel')}>
          <Terminal size={13} className="react-chat-bgpill-capsule-icon" aria-hidden />
          <span>{t('chatShell.bgpTerminal')}</span>
          <span className="react-chat-bgpill-capsule-sep" aria-hidden>
            ·
          </span>
          <span>{formatDuration(t, earliestElapsed)}</span>
          <span className="react-chat-bgpill-capsule-sep" aria-hidden>
            ·
          </span>
          <span>{t('chatShell.bgpBgCount', { count: runningCount })}</span>
          <ChevronUp size={13} className="react-chat-bgpill-capsule-caret" aria-hidden />
        </button>
      )}
    </div>
  )
}

type BgProcessChipProps = {
  onToggle: () => void
  /** 面板展开时高亮 */
  active?: boolean
}

/** 输入框工具栏小芯片：仅存在运行中进程时显示，点击切换面板开合 */
export function BgProcessChip({ onToggle, active = false }: BgProcessChipProps) {
  const t = useT()
  const snapshot = useSyncExternalStore(subscribeBgProcesses, getBgProcessesSnapshot) as BgProcessesSnapshot
  if (!snapshot.runningCount) return null
  return (
    <button
      type="button"
      className={`react-chat-bottom-pill react-chat-bgchip${active ? ' react-chat-bottom-pill--open' : ''}`}
      title={t('chatShell.bgpAriaLabel')}
      onClick={onToggle}
    >
      <Terminal size={12} className="react-chat-bgchip-icon" aria-hidden />
      <span className="react-chat-bottom-pill-text">{t('chatShell.bgpBgCount', { count: snapshot.runningCount })}</span>
    </button>
  )
}
