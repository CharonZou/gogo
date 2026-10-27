import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WorkflowToolItem } from '../../hooks/useWorkflowResources.ts'
import { useT } from '../../lib/useI18n'

type Props = {
  open: boolean
  onClose: () => void
  tools: WorkflowToolItem[]
  loading: boolean
  selected: string[]
  onConfirm: (next: string[]) => void
}

export function ToolPickerModal({ open, onClose, tools, loading, selected, onConfirm }: Props) {
  // 命名 tr：文件内已有局部变量/回调参数 t（setTimeout、filter 回调）
  const tr = useT()
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<string[]>(selected)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) queueMicrotask(() => setDraft(selected))
  }, [open, selected])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tools
    return tools.filter(
      (t) =>
        t.value.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q),
    )
  }, [query, tools])

  if (!open) return null

  return createPortal(
    <div className="wf-picker-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="wf-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wf-picker-head">
          <h4>{tr('workflow.pickToolsTitle')}</h4>
          <button type="button" className="wf-picker-close" onClick={onClose} aria-label={tr('workflow.close')}>
            ×
          </button>
        </div>
        <input
          ref={searchRef}
          className="wf-picker-search"
          placeholder={tr('workflow.searchTools')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wf-picker-body">
          {loading ? <div className="wf-picker-empty">{tr('workflow.loading')}</div> : null}
          {!loading && filtered.length === 0 ? <div className="wf-picker-empty">{tr('workflow.noMatchTool')}</div> : null}
          {filtered.map((t) => {
            const checked = draft.includes(t.value)
            return (
              <label key={t.value} className={`wf-picker-row${checked ? ' is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setDraft((cur) =>
                      checked ? cur.filter((v) => v !== t.value) : [...cur, t.value],
                    )
                  }
                />
                <span className="wf-picker-row-icon">{t.icon || '⚙'}</span>
                <span className="wf-picker-row-copy">
                  <strong>{t.label}</strong>
                  {t.desc ? <small>{t.desc}</small> : null}
                </span>
              </label>
            )
          })}
        </div>
        <div className="wf-picker-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {tr('workflow.cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onConfirm(draft)}>
            {tr('workflow.confirm')} ({draft.length})
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
