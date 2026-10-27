import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { getSkillTags, getSkillTagMeta, SKILL_TAGS } from '../../../lib/skill-catalog.js'
import type { SkillPickerItem, SkillSelection } from '../SkillPickerModal.tsx'
import type { WorkflowToolItem } from '../../hooks/useWorkflowResources.ts'
import { useT } from '../../lib/useI18n'
import { t as tI18n } from '../../../lib/i18n.js'

export type CapabilityPickerResult = {
  skills: SkillSelection[]
  tools: string[]
}

type TabId = 'skills' | 'tools'

type ToolTierTag = { key: string; label: string; color: string }

// i18n：工具分层标签为展示文案，改为函数在调用时取词（避免模块级常量固化语言）
function toolTierTags(): ToolTierTag[] {
  return [
    { key: 'runtime', label: tI18n('workflow.tierRuntime'), color: '#6366f1' },
    { key: 'core', label: tI18n('workflow.tierCore'), color: '#0ea5e9' },
    { key: 'workspace', label: tI18n('workflow.tierWorkspace'), color: '#10b981' },
    { key: 'plan', label: tI18n('workflow.tierPlan'), color: '#f59e0b' },
    { key: 'goal', label: tI18n('workflow.tierGoal'), color: '#8b5cf6' },
    { key: 'optional', label: tI18n('workflow.tierOptional'), color: '#64748b' },
  ]
}

function toolTypeLabel(tool: WorkflowToolItem, tiers: ToolTierTag[]) {
  return tool.typeLabel || tiers.find((x) => x.key === tool.tier)?.label || tool.tier || ''
}

function toolTagMeta(tier: string, tiers: ToolTierTag[]) {
  return tiers.find((x) => x.key === tier) || null
}

/**
 * 技能 + 工具合一选择面板（标签筛选、多选、确定回写）。
 */
export function CapabilityPickerModal({
  open,
  onClose,
  skills,
  tools,
  loading,
  selectedSkills,
  selectedTools,
  onConfirm,
  initialTab = 'skills',
}: {
  open: boolean
  onClose: () => void
  skills: SkillPickerItem[]
  tools: WorkflowToolItem[]
  loading: boolean
  selectedSkills: SkillSelection[]
  selectedTools: string[]
  onConfirm: (next: CapabilityPickerResult) => void
  initialTab?: TabId
}) {
  // 命名 tr：文件内大量 map/filter 回调参数占用 t
  const tr = useT()
  const tierTags = toolTierTags()
  const [tab, setTab] = useState<TabId>(initialTab)
  const [query, setQuery] = useState('')
  const [skillDraft, setSkillDraft] = useState<SkillSelection[]>(selectedSkills)
  const [toolDraft, setToolDraft] = useState<string[]>(selectedTools)
  const [skillTag, setSkillTag] = useState('all')
  const [toolTag, setToolTag] = useState('all')
  const searchRef = useRef<HTMLInputElement | null>(null)

  const pickerTools = useMemo(
    () => tools.filter((t) => t.tier !== 'retired'),
    [tools],
  )

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
        setSkillDraft(selectedSkills)
        setToolDraft(selectedTools)
        setTab(initialTab)
        setQuery('')
        setSkillTag('all')
      })
    queueMicrotask(() => setToolTag('all'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
  }, [open, tab])

  const availableSkillTags = useMemo(() => {
    const keys = new Set<string>()
    for (const s of skills) {
      for (const t of getSkillTags(s.name)) keys.add(t)
    }
    return SKILL_TAGS.filter((t) => keys.has(t.key))
  }, [skills])

  const availableToolTags = useMemo(() => {
    const keys = new Set(pickerTools.map((t) => t.tier || 'optional'))
    return tierTags.filter((t) => keys.has(t.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerTools])

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter((s) => {
      const matchText =
        !q ||
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.label || '').toLowerCase().includes(q) ||
        String(s.description || '').toLowerCase().includes(q)
      const matchTag = skillTag === 'all' || getSkillTags(s.name).includes(skillTag)
      return matchText && matchTag
    })
  }, [skills, query, skillTag])

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pickerTools.filter((t) => {
      const matchText =
        !q ||
        t.value.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        toolTypeLabel(t, tierTags).toLowerCase().includes(q)
      const matchTag = toolTag === 'all' || (t.tier || 'optional') === toolTag
      return matchText && matchTag
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerTools, query, toolTag])

  if (!open || typeof document === 'undefined') return null

  const skillSelected = (name: string) => skillDraft.some((s) => s.name === name)
  const toggleSkill = (s: SkillPickerItem) => {
    setSkillDraft((prev) =>
      skillSelected(s.name)
        ? prev.filter((x) => x.name !== s.name)
        : [...prev, { name: s.name, label: s.label || s.name, icon: s.icon || '🧩' }],
    )
  }
  const toggleTool = (value: string) => {
    setToolDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  const totalSelected = skillDraft.length + toolDraft.length

  return createPortal(
    <div
      className="react-chat-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={tr('workflow.capPickerAria')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="react-chat-modal-card react-chat-skill-modal" onClick={(e) => e.stopPropagation()}>
        <div className="react-chat-modal-header">
          <div className="react-chat-skill-modal-header-main">
            <span className="react-chat-modal-title">{tr('workflow.capPickerTitle')}</span>
            <span className="react-chat-skill-modal-sub">{tr('workflow.capPickerSub')}</span>
          </div>
          <button type="button" className="react-chat-modal-close" onClick={onClose} aria-label={tr('workflow.close')}>
            ×
          </button>
        </div>

        <div className="react-chat-modal-body react-chat-skill-modal-body">
          <div className="wf-cap-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'skills'}
              className={`wf-cap-tab${tab === 'skills' ? ' is-active' : ''}`}
              onClick={() => setTab('skills')}
            >
              {tr('workflow.skillsTab')}{skillDraft.length ? ` · ${skillDraft.length}` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tools'}
              className={`wf-cap-tab${tab === 'tools' ? ' is-active' : ''}`}
              onClick={() => setTab('tools')}
            >
              {tr('workflow.toolsTab')}{toolDraft.length ? ` · ${toolDraft.length}` : ''}
            </button>
          </div>

          <div className="react-chat-skill-dropdown-search">
            <input
              ref={searchRef}
              type="search"
              className="react-chat-skill-dropdown-search-input"
              placeholder={tab === 'skills' ? tr('workflow.searchSkills') : tr('workflow.searchTools')}
              value={query}
              aria-label={tab === 'skills' ? tr('workflow.searchSkillsAria') : tr('workflow.searchToolsAria')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          {tab === 'skills' && availableSkillTags.length > 0 ? (
            <div className="react-chat-skill-tag-bar">
              <span
                className={`react-chat-skill-tag-chip${skillTag === 'all' ? ' active' : ''}`}
                onClick={() => setSkillTag('all')}
              >
                {tr('workflow.all')}
              </span>
              {availableSkillTags.map((t) => (
                <span
                  key={t.key}
                  className={`react-chat-skill-tag-chip${skillTag === t.key ? ' active' : ''}`}
                  onClick={() => setSkillTag(t.key)}
                >
                  {t.icon} {t.label}
                </span>
              ))}
            </div>
          ) : null}

          {tab === 'tools' && availableToolTags.length > 0 ? (
            <div className="react-chat-skill-tag-bar">
              <span
                className={`react-chat-skill-tag-chip${toolTag === 'all' ? ' active' : ''}`}
                onClick={() => setToolTag('all')}
              >
                {tr('workflow.all')}
              </span>
              {availableToolTags.map((t) => (
                <span
                  key={t.key}
                  className={`react-chat-skill-tag-chip${toolTag === t.key ? ' active' : ''}`}
                  style={{ ['--tag-color' as string]: t.color } as CSSProperties}
                  onClick={() => setToolTag(t.key)}
                >
                  {t.label}
                </span>
              ))}
            </div>
          ) : null}

          {totalSelected > 0 ? (
            <div className="react-chat-skill-modal-selected">
              {skillDraft.map((s) => (
                <span key={`s-${s.name}`} className="react-chat-skill-modal-chip">
                  <span className="react-chat-skill-modal-chip-icon" aria-hidden>
                    {s.icon || '🧩'}
                  </span>
                  <span className="react-chat-skill-modal-chip-label">{s.label}</span>
                  <button
                    type="button"
                    className="react-chat-skill-modal-chip-x"
                    aria-label={tr('workflow.removeSkill', { name: s.label })}
                    onClick={() => setSkillDraft((prev) => prev.filter((x) => x.name !== s.name))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {toolDraft.map((name) => {
                const hit = pickerTools.find((t) => t.value === name)
                return (
                  <span key={`t-${name}`} className="react-chat-skill-modal-chip wf-cap-chip--tool">
                    <span className="react-chat-skill-modal-chip-icon" aria-hidden>
                      {hit?.icon || '⚙'}
                    </span>
                    <span className="react-chat-skill-modal-chip-label">{hit?.label || name}</span>
                    <button
                      type="button"
                      className="react-chat-skill-modal-chip-x"
                      aria-label={tr('workflow.removeTool', { name: hit?.label || name })}
                      onClick={() => setToolDraft((prev) => prev.filter((v) => v !== name))}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
              <button
                type="button"
                className="react-chat-skill-modal-clear"
                onClick={() => {
                  setSkillDraft([])
                  setToolDraft([])
                }}
              >
                {tr('workflow.clearAll')}
              </button>
            </div>
          ) : null}

          <div className="react-chat-skill-dropdown-list react-chat-skill-modal-list">
            {loading ? (
              <div className="react-chat-bottom-dropdown-empty">{tr('workflow.loading')}</div>
            ) : tab === 'skills' ? (
              skills.length === 0 ? (
                <div className="react-chat-bottom-dropdown-empty">{tr('workflow.noSkillsAvailable')}</div>
              ) : filteredSkills.length === 0 ? (
                <div className="react-chat-bottom-dropdown-empty">{tr('workflow.noMatchSkill')}</div>
              ) : (
                filteredSkills.map((s) => {
                  const active = skillSelected(s.name)
                  const itemTags = getSkillTags(s.name)
                  return (
                    <button
                      key={s.name}
                      type="button"
                      className={`react-chat-bottom-dropdown-item react-chat-skill-item${
                        active ? ' react-chat-bottom-dropdown-item--active' : ''
                      }`}
                      onClick={() => toggleSkill(s)}
                    >
                      <span className="react-chat-skill-item-icon" aria-hidden>
                        {s.icon || '🧩'}
                      </span>
                      <span className="react-chat-skill-item-main">
                        <span className="react-chat-skill-item-label">{s.label || s.name}</span>
                        {s.description ? (
                          <span className="react-chat-skill-item-desc">{s.description}</span>
                        ) : null}
                        {itemTags.length ? (
                          <span className="react-chat-skill-item-tags">
                            {itemTags.map((tk) => {
                              const m = getSkillTagMeta(tk)
                              return (
                                <span
                                  key={tk}
                                  className="react-chat-skill-item-tag"
                                  style={
                                    m ? ({ ['--tag-color' as string]: m.color } as CSSProperties) : undefined
                                  }
                                >
                                  {m?.icon || ''} {m?.label || tk}
                                </span>
                              )
                            })}
                          </span>
                        ) : null}
                      </span>
                      <span className="react-chat-skill-item-check" aria-hidden>
                        {active ? '✓' : ''}
                      </span>
                    </button>
                  )
                })
              )
            ) : pickerTools.length === 0 ? (
              <div className="react-chat-bottom-dropdown-empty">{tr('workflow.noToolsAvailable')}</div>
            ) : filteredTools.length === 0 ? (
              <div className="react-chat-bottom-dropdown-empty">{tr('workflow.noMatchTool')}</div>
            ) : (
              filteredTools.map((t) => {
                const active = toolDraft.includes(t.value)
                const typeLabel = toolTypeLabel(t, tierTags)
                const meta = toolTagMeta(t.tier || 'optional', tierTags)
                return (
                  <button
                    key={t.value}
                    type="button"
                    className={`react-chat-bottom-dropdown-item react-chat-skill-item${
                      active ? ' react-chat-bottom-dropdown-item--active' : ''
                    }`}
                    onClick={() => toggleTool(t.value)}
                  >
                    <span className="react-chat-skill-item-icon" aria-hidden>
                      {t.icon || '⚙'}
                    </span>
                    <span className="react-chat-skill-item-main">
                      <span className="react-chat-skill-item-label">{t.label || t.value}</span>
                      {t.desc ? <span className="react-chat-skill-item-desc">{t.desc}</span> : null}
                      {typeLabel ? (
                        <span className="react-chat-skill-item-tags">
                          <span
                            className="react-chat-skill-item-tag"
                            style={
                              meta
                                ? ({ ['--tag-color' as string]: meta.color } as CSSProperties)
                                : undefined
                            }
                          >
                            {typeLabel}
                          </span>
                        </span>
                      ) : null}
                    </span>
                    <span className="react-chat-skill-item-check" aria-hidden>
                      {active ? '✓' : ''}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="react-chat-modal-actions react-chat-skill-modal-actions">
          <span className="react-chat-skill-modal-footer-count">
            {totalSelected > 0
              ? tr('workflow.selectedSummary', { s: skillDraft.length, t: toolDraft.length })
              : tr('workflow.unselected')}
          </span>
          <button type="button" className="react-chat-modal-btn react-chat-modal-btn--ghost" onClick={onClose}>
            {tr('workflow.cancel')}
          </button>
          <button
            type="button"
            className="react-chat-modal-btn react-chat-modal-btn--primary"
            onClick={() => {
              onConfirm({ skills: skillDraft, tools: toolDraft })
              onClose()
            }}
          >
            {tr('workflow.confirm')}{totalSelected > 0 ? `（${totalSelected}）` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
