import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import {
  formatToolApprovalPrimaryLine,
  TOOL_APPROVAL_OP_ZH,
} from '../../lib/tool-approval.js'
import { useT } from '../lib/useI18n'

export type ToolApprovalChoice = 'allow_once' | 'always_project' | 'deny'

type Props = {
  toolName: string
  summary: string
  /** Optional trailing metrics e.g. "+2 -1" */
  detailExtra?: string
  busy?: boolean
  /** Auto-focus the panel for keyboard navigation when mounted */
  autoFocus?: boolean
  onConfirm: (choice: ToolApprovalChoice) => void
}

const CHOICE_IDS: ToolApprovalChoice[] = ['allow_once', 'always_project', 'deny']

function toolOpLabel(toolName: string): string {
  const key = String(toolName || '')
    .trim()
    .toLowerCase()
  return (TOOL_APPROVAL_OP_ZH as Record<string, string>)[key] || key || t('chatUi.toolStubName')
}

function ToolApprovalPanelInner({
  toolName,
  summary,
  detailExtra,
  busy,
  autoFocus = true,
  onConfirm,
}: Props) {
  const tr = useT()
  const CHOICES: Array<{ id: ToolApprovalChoice; title: string; desc: string }> = [
    { id: 'allow_once', title: tr('chatUi.approveAllowOnce'), desc: tr('chatUi.approveAllowOnceDesc') },
    {
      id: 'always_project',
      title: tr('chatUi.approveAlwaysProject'),
      desc: tr('chatUi.approveAlwaysProjectDesc'),
    },
    { id: 'deny', title: tr('chatUi.approveDeny'), desc: tr('chatUi.approveDenyDesc') },
  ]
  const labelId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState(0)
  // 同步 selected 供键盘事件读取，避免闭包过期导致重渲染丢键
  const selectedRef = useRef(0)
  // 记录 Tab 是否刚按下，用于 Tab+数字 快速选择
  const tabHeldRef = useRef(false)
  const tabTimerRef = useRef<number | null>(null)
  const primary = useMemo(
    () => formatToolApprovalPrimaryLine(toolName, summary),
    [toolName, summary],
  )
  const contextLabel = useMemo(() => {
    const detail = String(summary || '').trim() || primary
    const extra = String(detailExtra || '').trim()
    return extra ? `${detail} ${extra}` : detail
  }, [summary, primary, detailExtra])

  const move = useCallback((delta: number) => {
    setSelected((i) => {
      const n = CHOICE_IDS.length
      return (i + delta + n) % n
    })
  }, [])

  const submit = useCallback(() => {
    if (busy) return
    const choice = CHOICE_IDS[selectedRef.current] || 'allow_once'
    onConfirm(choice)
  }, [busy, onConfirm])

  // 同步 selected 到 ref，键盘事件始终读最新值
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    if (!autoFocus) return
    const el = rootRef.current
    if (!el) return
    // Defer so stream re-renders do not steal focus mid-type.
    const t = window.setTimeout(() => {
      try {
        el.focus({ preventScroll: true })
      } catch {
        el.focus()
      }
    }, 30)
    return () => window.clearTimeout(t)
  }, [autoFocus])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (e.key === 'Tab') {
        e.preventDefault()
        // 标记 Tab 刚按下，1500ms 内按数字可快速选择对应选项
        tabHeldRef.current = true
        if (tabTimerRef.current !== null) {
          window.clearTimeout(tabTimerRef.current)
        }
        tabTimerRef.current = window.setTimeout(() => {
          tabHeldRef.current = false
          tabTimerRef.current = null
        }, 1500)
        move(e.shiftKey ? -1 : 1)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        move(-1)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
        return
      }
      // 数字键 1-9：直接选择（支持 Tab+数字 快速选择）
      const digit = Number(e.key)
      if (e.key.length === 1 && digit >= 1 && digit <= 9) {
        e.preventDefault()
        const idx = digit - 1
        if (idx < CHOICE_IDS.length) {
          setSelected(idx)
        }
        if (tabHeldRef.current) {
          tabHeldRef.current = false
          if (tabTimerRef.current !== null) {
            window.clearTimeout(tabTimerRef.current)
            tabTimerRef.current = null
          }
        }
        return
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      if (tabTimerRef.current !== null) {
        window.clearTimeout(tabTimerRef.current)
        tabTimerRef.current = null
      }
    }
  }, [busy, move, submit])

  return (
    <div
      ref={rootRef}
      className="tool-approval-panel"
      role="group"
      aria-labelledby={labelId}
      tabIndex={0}
    >
      <div className="tool-approval-panel__eyebrow" id={labelId}>
        {tr('chatUi.approvalNeeded')}
      </div>
      <div className="tool-approval-panel__context">
        <span className="tool-approval-panel__context-icon" aria-hidden>
          ✎
        </span>
        <span className="tool-approval-panel__context-wait">{tr('chatUi.waitingConfirm')}</span>
        <span className="tool-approval-panel__context-sep" aria-hidden>
          ·
        </span>
        <span className="tool-approval-panel__context-detail" title={primary}>
          {toolOpLabel(toolName) ? (
            <span className="tool-approval-panel__op">{toolOpLabel(toolName)}</span>
          ) : null}{' '}
          {contextLabel}
        </span>
      </div>

      <ol className="tool-approval-panel__choices" role="listbox" aria-label={tr('chatUi.approvalOptionsAria')}>
        {CHOICES.map((c, idx) => {
          const active = idx === selected
          return (
            <li key={c.id} role="option" aria-selected={active}>
              <button
                type="button"
                className={`tool-approval-panel__choice${active ? ' is-selected' : ''}`}
                disabled={busy}
                onClick={() => {
                  setSelected(idx)
                  // 点击后把焦点收回到面板，确保随后按 Enter 能直接确认
                  rootRef.current?.focus({ preventScroll: true })
                }}
                onDoubleClick={() => {
                  if (busy) return
                  onConfirm(c.id)
                }}
              >
                <span className="tool-approval-panel__choice-index">{idx + 1}.</span>
                <span className="tool-approval-panel__choice-body">
                  <span className="tool-approval-panel__choice-title">{c.title}</span>
                  <span className="tool-approval-panel__choice-desc">{c.desc}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="tool-approval-panel__footer">
        <p className="tool-approval-panel__hint">
          <span className="tool-approval-panel__hint-icon" aria-hidden>
            i
          </span>
          {tr('chatUi.approvalKeyboardHint')}
        </p>
        <button
          type="button"
          className="tool-approval-panel__confirm"
          disabled={busy}
          onClick={submit}
        >
          {busy ? tr('chatUi.processingEllipsis') : tr('chatUi.confirm')}
        </button>
      </div>
    </div>
  )
}

export const ToolApprovalPanel = memo(ToolApprovalPanelInner)
