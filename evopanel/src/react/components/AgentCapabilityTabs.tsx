import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCapabilityContextOverhead } from '../../lib/capability-context-overhead.js'
import { useT } from '../lib/useI18n'

export type AgentCapabilityPatch = {
  skills?: string[]
  tools?: string[] | null
  mcp_servers?: string[] | null
  knowledge_vault_ids?: string[]
}

type CapTab = 'skills' | 'tools' | 'mcp' | 'knowledge'

type CapRow = { id: string; name: string; tokens?: number | null }

type CatalogItem = { id: string; name: string }

// i18n: tab 只存稳定 id + 词典键，label 渲染期取词（原模块级中文 label 常量）；mcp 为固定缩写不接词典
const TABS: { id: CapTab; labelKey: string | null }[] = [
  { id: 'skills', labelKey: 'chatUi.capTabSkills' },
  { id: 'tools', labelKey: 'chatUi.capTabTools' },
  { id: 'mcp', labelKey: null },
  { id: 'knowledge', labelKey: 'chatUi.capTabKnowledge' },
]

function capTabLabel(tr: ReturnType<typeof useT>, id: CapTab): string {
  const tab = TABS.find((tabDef) => tabDef.id === id)
  return tab?.labelKey ? tr(tab.labelKey) : 'MCP'
}

const PREVIEW = 8

function formatTokExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.max(0, Math.round(n)).toLocaleString('en-US')
}

function formatTok(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const v = Math.max(0, Math.round(n))
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

async function loadSkillCatalog(): Promise<CatalogItem[]> {
  const { api } = await import('../../lib/tauri-api.js')
  try {
    const rows = await api.loadSkills()
    const list = Array.isArray(rows) ? rows : []
    return list
      .filter((s: { enabled?: boolean }) => s?.enabled !== false)
      .map((s: { name?: string }) => {
        const name = String(s?.name || '').trim()
        return name ? { id: name, name } : null
      })
      .filter(Boolean) as CatalogItem[]
  } catch {
    return []
  }
}

async function loadToolCatalog(): Promise<CatalogItem[]> {
  const { api } = await import('../../lib/tauri-api.js')
  try {
    const meta = await api.getToolsMetadata()
    const tools = Array.isArray(meta?.tools) ? meta.tools : []
    return tools
      .map((t: { value?: string; name?: string; label?: string }) => {
        const id = String(t?.value || t?.name || '').trim()
        if (!id) return null
        return { id, name: String(t?.label || t?.name || id).trim() || id }
      })
      .filter(Boolean) as CatalogItem[]
  } catch {
    return []
  }
}

async function loadMcpCatalog(): Promise<CatalogItem[]> {
  const { api } = await import('../../lib/tauri-api.js')
  try {
    const cfg = await api.getMCPConfig()
    const servers = cfg?.mcp_servers && typeof cfg.mcp_servers === 'object' ? cfg.mcp_servers : {}
    return Object.entries(servers)
      .filter(([, c]) => (c as { enabled?: boolean })?.enabled !== false)
      .map(([name, c]) => ({
        id: name,
        name: String((c as { description?: string })?.description || name).trim() || name,
      }))
  } catch {
    return []
  }
}

async function loadKnowledgeCatalog(): Promise<CatalogItem[]> {
  const { api } = await import('../../lib/tauri-api.js')
  try {
    const raw = await api.listOwnedKnowledgeBases()
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.bases)
        ? raw.bases
        : Array.isArray(raw?.items)
          ? raw.items
          : []
    return list
      .map((row: { id?: string; name?: string; title?: string }) => {
        const id = String(row?.id || '').trim()
        if (!id) return null
        return { id, name: String(row?.name || row?.title || id).trim() || id }
      })
      .filter(Boolean) as CatalogItem[]
  } catch {
    return []
  }
}

export function AgentCapabilityTabs({
  skillNames,
  toolNames,
  mcpServers = null,
  knowledgeVaultIds = [],
  modelName = '',
  editable = false,
  busy = false,
  onPatch,
}: {
  skillNames: string[]
  /** null = unrestricted (all tools) */
  toolNames?: string[] | null
  /** null = unrestricted */
  mcpServers?: string[] | null
  knowledgeVaultIds?: string[]
  modelName?: string
  editable?: boolean
  busy?: boolean
  onPatch?: (patch: AgentCapabilityPatch) => Promise<void>
}) {
  // 文案函数用 tr：渲染里 `t` 被 catalog map 参数占用，避免遮蔽
  const tr = useT()
  const [tab, setTab] = useState<CapTab>('skills')
  const [expanded, setExpanded] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQ, setPickerQ] = useState('')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [skillTok, setSkillTok] = useState<Map<string, number | null>>(() => new Map())
  const [toolTok, setToolTok] = useState<Map<string, number | null>>(() => new Map())
  const [skillsTotal, setSkillsTotal] = useState<number | null>(null)
  const [toolsTotal, setToolsTotal] = useState<number | null>(null)
  const [tokLoading, setTokLoading] = useState(false)
  const [kbCatalog, setKbCatalog] = useState<CatalogItem[]>([])
  const [mcpCatalog, setMcpCatalog] = useState<CatalogItem[]>([])
  const [toolCatalog, setToolCatalog] = useState<CatalogItem[]>([])
  const [patching, setPatching] = useState(false)

  const mcpUnrestricted = mcpServers == null
  const toolsUnrestricted = toolNames == null
  const boundToolNames = Array.isArray(toolNames) ? toolNames : []

  useEffect(() => {
    setExpanded(false)
    setPickerOpen(false)
    setPickerQ('')
  }, [tab])

  useEffect(() => {
    let cancelled = false
    void loadKnowledgeCatalog().then((rows) => {
      if (!cancelled) setKbCatalog(rows)
    })
    void loadMcpCatalog().then((rows) => {
      if (!cancelled) setMcpCatalog(rows)
    })
    void loadToolCatalog().then((rows) => {
      if (!cancelled) setToolCatalog(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const toolsForTok = boundToolNames
    if (!skillNames.length && !toolsForTok.length) {
      setTokLoading(false)
      return () => {
        cancelled = true
      }
    }
    setTokLoading(true)
    void fetchCapabilityContextOverhead({
      skills: skillNames,
      tools: toolsForTok,
      model: modelName || null,
    })
      .then((data) => {
        if (cancelled) return
        const sm = new Map<string, number | null>()
        for (const r of data.skills) sm.set(r.name, r.tokens)
        const tm = new Map<string, number | null>()
        for (const r of data.tools) tm.set(r.name, r.tokens)
        setSkillTok(sm)
        setToolTok(tm)
        setSkillsTotal(data.skillsTotal > 0 ? data.skillsTotal : null)
        setToolsTotal(data.toolsTotal > 0 ? data.toolsTotal : null)
      })
      .catch(() => {
        if (cancelled) return
        setSkillTok(new Map())
        setToolTok(new Map())
        setSkillsTotal(null)
        setToolsTotal(null)
      })
      .finally(() => {
        if (!cancelled) setTokLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [skillNames, boundToolNames, modelName])

  const knowledgeRows: CapRow[] = useMemo(() => {
    const byId = new Map(kbCatalog.map((k) => [k.id, k.name]))
    return knowledgeVaultIds.map((id) => ({
      id,
      name: byId.get(id) || id,
    }))
  }, [knowledgeVaultIds, kbCatalog])

  const mcpRows: CapRow[] = useMemo(() => {
    if (Array.isArray(mcpServers)) {
      const byId = new Map(mcpCatalog.map((k) => [k.id, k.name]))
      return mcpServers.map((id) => ({ id, name: byId.get(id) || id }))
    }
    return mcpCatalog.map((k) => ({ id: k.id, name: k.name }))
  }, [mcpServers, mcpCatalog])

  const skillRows: CapRow[] = useMemo(
    () => skillNames.map((name) => ({ id: name, name, tokens: skillTok.get(name) ?? null })),
    [skillNames, skillTok],
  )
  const toolRows: CapRow[] = useMemo(() => {
    if (toolsUnrestricted) {
      return toolCatalog.map((t) => ({ id: t.id, name: t.name, tokens: toolTok.get(t.id) ?? null }))
    }
    const byId = new Map(toolCatalog.map((t) => [t.id, t.name]))
    return boundToolNames.map((name) => ({
      id: name,
      name: byId.get(name) || name,
      tokens: toolTok.get(name) ?? null,
    }))
  }, [toolsUnrestricted, toolCatalog, boundToolNames, toolTok])

  const activeRows =
    tab === 'skills'
      ? skillRows
      : tab === 'tools'
        ? toolRows
        : tab === 'mcp'
          ? mcpRows
          : knowledgeRows

  const sumLabel =
    tab === 'skills'
      ? skillsTotal != null
        ? tr('chatUi.capTokSum', { tok: formatTok(skillsTotal), count: skillNames.length })
        : tokLoading
          ? tr('chatUi.capComputingSum', { count: skillNames.length })
          : tr('chatUi.capCountOnly', { count: skillNames.length })
      : tab === 'tools'
        ? toolsUnrestricted
          ? toolRows.length
            ? tr('chatUi.capAllSum', { count: toolRows.length })
            : tr('chatUi.capAllAvailable')
          : toolsTotal != null
            ? tr('chatUi.capTokSum', { tok: formatTok(toolsTotal), count: boundToolNames.length })
            : tokLoading
              ? tr('chatUi.capComputingSum', { count: boundToolNames.length })
              : tr('chatUi.capCountOnly', { count: boundToolNames.length })
        : tab === 'mcp'
          ? mcpUnrestricted
            ? mcpRows.length
              ? tr('chatUi.capAllSum', { count: mcpRows.length })
              : tr('chatUi.capAllAvailable')
            : mcpRows.length
              ? tr('chatUi.capCountOnly', { count: mcpRows.length })
              : tr('chatUi.capNotConnected')
          : knowledgeRows.length
            ? tr('chatUi.capCountOnly', { count: knowledgeRows.length })
            : tr('chatUi.capNotBound')

  const emptyText =
    tab === 'skills'
      ? tr('chatUi.capEmptySkills')
      : tab === 'tools'
        ? toolsUnrestricted
          ? tr('chatUi.capEmptyToolsAll')
          : tr('chatUi.capEmptyTools')
        : tab === 'mcp'
          ? mcpUnrestricted
            ? tr('chatUi.capEmptyMcpAll')
            : tr('chatUi.capEmptyMcp')
          : tr('chatUi.capEmptyKnowledge')

  const runPatch = useCallback(
    async (patch: AgentCapabilityPatch) => {
      if (!onPatch || patching || busy) return
      setPatching(true)
      try {
        await onPatch(patch)
        setPickerOpen(false)
      } finally {
        setPatching(false)
      }
    },
    [onPatch, patching, busy],
  )

  const openPicker = useCallback(async () => {
    if (!editable || patching || busy) return
    setPickerOpen(true)
    setCatalogLoading(true)
    setPickerQ('')
    try {
      const rows =
        tab === 'skills'
          ? await loadSkillCatalog()
          : tab === 'tools'
            ? await loadToolCatalog()
            : tab === 'mcp'
              ? await loadMcpCatalog()
              : await loadKnowledgeCatalog()
      setCatalog(rows)
    } finally {
      setCatalogLoading(false)
    }
  }, [editable, patching, busy, tab])

  const boundIds = useMemo(() => {
    if (tab === 'skills') return new Set(skillNames)
    if (tab === 'tools')
      return toolsUnrestricted ? new Set(toolCatalog.map((t) => t.id)) : new Set(boundToolNames)
    if (tab === 'mcp') return mcpUnrestricted ? new Set(mcpCatalog.map((m) => m.id)) : new Set(mcpServers || [])
    return new Set(knowledgeVaultIds)
  }, [
    tab,
    skillNames,
    toolsUnrestricted,
    toolCatalog,
    boundToolNames,
    mcpUnrestricted,
    mcpCatalog,
    mcpServers,
    knowledgeVaultIds,
  ])

  const pickerCandidates = useMemo(() => {
    const q = pickerQ.trim().toLowerCase()
    return catalog.filter((c) => {
      if (boundIds.has(c.id)) return false
      if (!q) return true
      return c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    })
  }, [catalog, boundIds, pickerQ])

  const onRemove = useCallback(
    async (id: string) => {
      if (!editable || !onPatch) return
      if (tab === 'skills') {
        await runPatch({ skills: skillNames.filter((s) => s !== id) })
        return
      }
      if (tab === 'tools') {
        if (toolsUnrestricted) {
          const all = toolCatalog.map((t) => t.id).filter((x) => x !== id)
          await runPatch({ tools: all })
          return
        }
        await runPatch({ tools: boundToolNames.filter((t) => t !== id) })
        return
      }
      if (tab === 'mcp') {
        if (mcpUnrestricted) {
          const all = mcpCatalog.map((m) => m.id).filter((x) => x !== id)
          await runPatch({ mcp_servers: all })
          return
        }
        await runPatch({ mcp_servers: (mcpServers || []).filter((m) => m !== id) })
        return
      }
      await runPatch({ knowledge_vault_ids: knowledgeVaultIds.filter((k) => k !== id) })
    },
    [
      editable,
      onPatch,
      tab,
      skillNames,
      toolsUnrestricted,
      toolCatalog,
      boundToolNames,
      mcpUnrestricted,
      mcpCatalog,
      mcpServers,
      knowledgeVaultIds,
      runPatch,
    ],
  )

  const onAdd = useCallback(
    async (id: string) => {
      if (!editable || !onPatch) return
      if (tab === 'skills') {
        if (skillNames.includes(id)) return
        await runPatch({ skills: [...skillNames, id] })
        return
      }
      if (tab === 'tools') {
        if (toolsUnrestricted) return
        if (boundToolNames.includes(id)) return
        await runPatch({ tools: [...boundToolNames, id] })
        return
      }
      if (tab === 'mcp') {
        if (mcpUnrestricted) return
        if ((mcpServers || []).includes(id)) return
        await runPatch({ mcp_servers: [...(mcpServers || []), id] })
        return
      }
      if (knowledgeVaultIds.includes(id)) return
      await runPatch({ knowledge_vault_ids: [...knowledgeVaultIds, id] })
    },
    [
      editable,
      onPatch,
      tab,
      skillNames,
      toolsUnrestricted,
      boundToolNames,
      mcpUnrestricted,
      mcpServers,
      knowledgeVaultIds,
      runPatch,
    ],
  )

  const visible = expanded ? activeRows : activeRows.slice(0, PREVIEW)
  const canExpand = activeRows.length > PREVIEW
  const showTokens = tab === 'skills' || tab === 'tools'
  const disabled = !editable || patching || busy

  const overviewCounts = {
    skills: skillNames.length,
    tools: toolsUnrestricted ? toolCatalog.length || toolRows.length : boundToolNames.length,
    knowledge: knowledgeVaultIds.length,
    mcp: mcpUnrestricted ? mcpCatalog.length || mcpRows.length : (mcpServers || []).length,
  }

  return (
    <section className="react-chat-agent-cap is-tabbed" aria-label={tr('chatUi.capAria')}>
      <div className="react-chat-agent-cap-overview" role="tablist" aria-label={tr('chatUi.capAria')}>
        {(
          [
            { id: 'skills' as CapTab, label: 'Skills', value: overviewCounts.skills },
            { id: 'tools' as CapTab, label: 'Tools', value: overviewCounts.tools },
            { id: 'knowledge' as CapTab, label: 'Knowledge', value: overviewCounts.knowledge },
            { id: 'mcp' as CapTab, label: 'MCP', value: overviewCounts.mcp },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`react-chat-agent-cap-overview-item${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <span className="react-chat-agent-cap-overview-value">{item.value}</span>
            <span className="react-chat-agent-cap-overview-label">{item.label}</span>
          </button>
        ))}
      </div>
      <div className="react-chat-agent-cap-tabs is-detail-tabs" role="tablist">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            type="button"
            role="tab"
            aria-selected={tab === tabDef.id}
            className={`react-chat-agent-cap-tab${tab === tabDef.id ? ' is-active' : ''}`}
            onClick={() => setTab(tabDef.id)}
          >
            {capTabLabel(tr, tabDef.id)}
          </button>
        ))}
      </div>
      <div className="react-chat-agent-cap-toolbar">
        <span className="react-chat-agent-cap-sum" title={sumLabel}>
          {sumLabel}
        </span>
        {editable ? (
          <button
            type="button"
            className="react-chat-agent-cap-add"
            disabled={disabled || (tab === 'mcp' && mcpUnrestricted) || (tab === 'tools' && toolsUnrestricted)}
            title={
              (tab === 'mcp' && mcpUnrestricted) || (tab === 'tools' && toolsUnrestricted)
                ? tr('chatUi.capAddRestrictedHint')
                : tr('chatUi.capAddTitle', { label: capTabLabel(tr, tab) })
            }
            onClick={() => void openPicker()}
          >
            {tr('chatUi.capAdd')}
          </button>
        ) : null}
      </div>

      <div className="react-chat-agent-cap-panel" role="tabpanel">
        {activeRows.length === 0 ? (
          <p className="react-chat-agent-cap-empty">{emptyText}</p>
        ) : (
          <>
            <ul className={`react-chat-agent-cap-list${expanded ? ' is-expanded' : ''}`}>
              {visible.map((row) => (
                <li key={row.id}>
                  <span className="react-chat-agent-cap-name" title={row.name}>
                    {row.name}
                  </span>
                  {showTokens ? (
                    <span
                      className={`react-chat-agent-cap-tok${row.tokens == null && tokLoading ? ' is-pending' : ''}`}
                    >
                      {row.tokens == null
                        ? tokLoading
                          ? tr('chatUi.capTokComputing')
                          : '—'
                        : formatTokExact(row.tokens)}
                    </span>
                  ) : null}
                  {editable ? (
                    <button
                      type="button"
                      className="react-chat-agent-cap-remove"
                      disabled={disabled}
                      aria-label={tr('chatUi.capRemoveAria', { name: row.name })}
                      title={tr('chatUi.removeAria')}
                      onClick={() => void onRemove(row.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canExpand ? (
              <button
                type="button"
                className="react-chat-agent-cap-more"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? tr('chatUi.collapse') : tr('chatUi.capMore', { count: activeRows.length - PREVIEW })}
              </button>
            ) : null}
          </>
        )}

        {pickerOpen ? (
          <div className="react-chat-agent-cap-picker">
            <div className="react-chat-agent-cap-picker-head">
              <input
                className="react-chat-agent-cap-picker-search"
                value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)}
                placeholder={tr('chatUi.capSearchPlaceholder')}
                autoFocus
              />
              <button
                type="button"
                className="react-chat-agent-cap-picker-close"
                onClick={() => setPickerOpen(false)}
              >
                {tr('chatUi.close')}
              </button>
            </div>
            {catalogLoading ? (
              <p className="react-chat-agent-cap-empty">{tr('chatUi.capCatalogLoading')}</p>
            ) : pickerCandidates.length === 0 ? (
              <p className="react-chat-agent-cap-empty">{tr('chatUi.capNoCandidates')}</p>
            ) : (
              <ul className="react-chat-agent-cap-picker-list">
                {pickerCandidates.slice(0, 40).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="react-chat-agent-cap-picker-item"
                      disabled={disabled}
                      onClick={() => void onAdd(c.id)}
                    >
                      <span className="react-chat-agent-cap-name" title={c.name}>
                        {c.name}
                      </span>
                      <span className="react-chat-agent-cap-picker-plus">+</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
