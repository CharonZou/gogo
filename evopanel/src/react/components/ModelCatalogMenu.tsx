import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import {
  groupModelCatalogByVendor,
  modelDisplayLabel,
  type ModelCatalogEntry,
} from '../lib/model-catalog.js'
import { VendorLogo } from './VendorLogo.js'
import { navigate } from '../../router.js'
import { useT } from '../lib/useI18n'

export type ThinkingLevelOption = { value: string; label: string }

export type ModelCatalogMenuThinking = {
  /** 当前模型是否支持思考；false/未传则不渲染思考区块 */
  supported: boolean
  /** 当前思考等级（如 auto/off/low/medium/high） */
  level: string
  options: ThinkingLevelOption[]
  onSelect: (value: string) => void
}

export type ModelCatalogMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  catalog: ModelCatalogEntry[]
  connNameMap?: Record<string, string>
  selectedModel: string
  pillLabel: string
  loading?: boolean
  disabled?: boolean
  /** 选择模型（仅 name）；关闭菜单由组件内部处理 */
  onSelect: (modelName: string) => void
  /** 打开前钩子（例如互斥关闭其它菜单） */
  onBeforeOpen?: () => void
  /** 思考强度区块（合并进模型菜单底部；模型不支持时不展示） */
  thinking?: ModelCatalogMenuThinking
  /** 暴露根节点，供外层统一处理点击外部关闭 */
  rootRef?: Ref<HTMLDivElement | null>
  /** 是否自行处理点击外部 / Esc 关闭；外层已管时设 false */
  manageDismiss?: boolean
  /** 上拉（会话底栏）或下拉（首页靠顶输入区） */
  placement?: 'up' | 'down'
  /**
   * 挂到 body + fixed，避开父级 overflow 裁切（输入区上拉后桌面/手机均需要）。
   * 外层点外部关闭请同时识别 `.react-chat-bottom-dropdown--model-portal`。
   */
  portalFixed?: boolean
  /**
   * portal 下改为纵向堆叠厂商+模型（窄屏触控）。
   * false 时保留桌面右侧级联，并对 flyout 使用 fixed 定位以免被裁切。
   */
  portalStack?: boolean
  className?: string
  /** 触发按钮额外 class（如首页 chip） */
  triggerClassName?: string
}

/** 思考强度滑杆：低 / 高 / 最高 三档（对应 low / medium / high） */
const THINKING_SLIDER_STEPS: { value: string; labelKey: string }[] = [
  { value: 'low', labelKey: 'chatShell.levelLow' },
  { value: 'medium', labelKey: 'chatShell.levelHigh' },
  { value: 'high', labelKey: 'chatShell.levelHighest' },
]

function thinkingSliderIndex(level: string): number {
  const i = THINKING_SLIDER_STEPS.findIndex((s) => s.value === level)
  return i >= 0 ? i : 0
}

/**
 * 「最高」档的火箭喷发气泡：从右向左流动，速度/位置/大小错峰，
 * 右端（滑块处）更密，像火箭向右推进的尾焰。
 */
const THINKING_SPARKS: { top: string; size: number; dur: string; delay: string }[] = [
  { top: '30%', size: 3.5, dur: '1.5s', delay: '0s' },
  { top: '62%', size: 2.5, dur: '1.1s', delay: '0.15s' },
  { top: '48%', size: 3, dur: '1.3s', delay: '0.3s' },
  { top: '22%', size: 2.5, dur: '0.9s', delay: '0.05s' },
  { top: '70%', size: 4, dur: '1.6s', delay: '0.45s' },
  { top: '38%', size: 2.5, dur: '1.0s', delay: '0.6s' },
  { top: '55%', size: 3.5, dur: '1.4s', delay: '0.2s' },
  { top: '28%', size: 2.5, dur: '1.2s', delay: '0.75s' },
  { top: '65%', size: 3, dur: '0.95s', delay: '0.5s' },
  { top: '42%', size: 4, dur: '1.7s', delay: '0.9s' },
  { top: '35%', size: 2.5, dur: '1.05s', delay: '0.35s' },
  { top: '58%', size: 3, dur: '1.25s', delay: '1.0s' },
]

function ModelThinkingSlider({
  level,
  options,
  onSelect,
}: {
  level: string
  options: ThinkingLevelOption[]
  onSelect: (value: string) => void
  onClose: (open: boolean) => void
}) {
  const t = useT()
  // 拖动中记录连续位置（0~2），松手吸附到最近档位
  const [drag, setDrag] = useState<number | null>(null)
  // 档位落在滑杆三档内时徽标用刻度词（低/高/最高），保持与刻度一致；auto/off 用原标签
  const step = THINKING_SLIDER_STEPS.find((s) => s.value === level)
  const currentLabel = step
    ? t(step.labelKey)
    : options.find((o) => o.value === level)?.label ?? t(THINKING_SLIDER_STEPS[thinkingSliderIndex(level)].labelKey)
  const idx = thinkingSliderIndex(level)
  const pos = drag ?? idx
  const nearest = Math.min(2, Math.max(0, Math.round(pos)))

  const commit = () => {
    if (drag === null) return
    const target = THINKING_SLIDER_STEPS[nearest]
    setDrag(null)
    if (target && target.value !== level) onSelect(target.value)
  }

  return (
    <div className="react-chat-model-thinking-section">
      <div className="react-chat-model-thinking-title">
        <span className="react-chat-model-thinking-title-label">
          {t('chatShell.mcmThinkingLabel')} <b>{currentLabel}</b>
        </span>
        <button
          type="button"
          className={`react-chat-model-thinking-kbd react-chat-model-thinking-auto${
            level === 'auto' ? ' is-active' : ''
          }`}
          title={t('chatShell.mcmAutoTitle')}
          onClick={(e) => {
            e.stopPropagation()
            if (level !== 'auto') onSelect('auto')
          }}
        >
          {t('chatShell.levelAuto')}
        </button>
      </div>
      <div className={`react-chat-model-thinking-slider${pos >= 2 ? ' is-max' : ''}`}>
        <div
          className={`react-chat-model-thinking-track${pos >= 2 ? ' is-max' : ''}`}
          style={{ '--p': String(pos / 2) } as CSSProperties}
        >
          <span className="react-chat-model-thinking-base" aria-hidden="true" />
          <span className="react-chat-model-thinking-fill" aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={pos}
            aria-label={t('chatShell.mcmThinkingLabel')}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={commit}
            onTouchEnd={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          {pos >= 2 ? (
            <div className="react-chat-model-thinking-sparks" aria-hidden="true">
              {THINKING_SPARKS.map((s, i) => (
                <i
                  key={i}
                  style={{
                    top: s.top,
                    width: s.size,
                    height: s.size,
                    animationDuration: s.dur,
                    animationDelay: s.delay,
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="react-chat-model-thinking-ticks">
          {THINKING_SLIDER_STEPS.map((s, i) => (
            <button
              key={s.value}
              type="button"
              className={`react-chat-model-thinking-tick${idx === i ? ' is-active' : ''}`}
              onClick={() => {
                if (s.value !== level) onSelect(s.value)
              }}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ModelCatalogMenu({
  open,
  onOpenChange,
  catalog,
  connNameMap,
  selectedModel,
  pillLabel,
  loading = false,
  disabled = false,
  onSelect,
  onBeforeOpen,
  thinking,
  rootRef,
  manageDismiss = true,
  placement = 'up',
  portalFixed = false,
  portalStack = false,
  className = '',
  triggerClassName = '',
}: ModelCatalogMenuProps) {
  const t = useT()
  const [vendorHover, setVendorHover] = useState<string | null>(null)
  const [flyoutSide, setFlyoutSide] = useState<'right' | 'left'>('right')
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null)
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localRootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const vendorItemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const setRootNode = (node: HTMLDivElement | null) => {
    localRootRef.current = node
    if (typeof rootRef === 'function') rootRef(node)
    else if (rootRef && typeof rootRef === 'object') {
      ;(rootRef as { current: HTMLDivElement | null }).current = node
    }
  }

  const cascadePortal = portalFixed && !portalStack

  useEffect(() => {
    if (!open) {
      setVendorHover(null)
      setFlyoutSide('right')
      setFlyoutStyle(null)
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
    }
  }, [open])

  useLayoutEffect(() => {
    if (!vendorHover || typeof window === 'undefined') {
      setFlyoutSide('right')
      setFlyoutStyle(null)
      return
    }

    // 手机堆叠：flyout 在文档流内，无需 fixed
    if (portalStack) {
      setFlyoutSide('right')
      setFlyoutStyle(null)
      return
    }

    const vendorEl = vendorItemRefs.current.get(vendorHover)
    const flyout = flyoutRef.current
    if (!vendorEl || !flyout) return

    // 桌面 portal：fixed 贴厂商行底边向上展开（与旧 absolute bottom:0 一致），
    // 勿改成「贴顶向下」——会把列表甩到视口很上方，看起来不在厂商旁边。
    if (cascadePortal) {
      const row = vendorEl.getBoundingClientRect()
      const pad = 10
      const gap = 4
      const estimatedW = Math.min(340, Math.max(200, flyout.offsetWidth || 240))
      let side: 'right' | 'left' = 'right'
      let left = row.right + gap
      if (left + estimatedW > window.innerWidth - pad) {
        side = 'left'
        left = Math.max(pad, row.left - gap - estimatedW)
      }

      const spaceAbove = Math.max(0, row.bottom - pad)
      const spaceBelow = Math.max(0, window.innerHeight - row.top - pad)
      // 默认底对齐向上；上方实在不够再改为顶对齐向下
      const flipDown = spaceAbove < 140 && spaceBelow > spaceAbove
      if (flipDown) {
        const maxH = Math.max(120, Math.min(320, spaceBelow))
        setFlyoutSide(side)
        setFlyoutStyle({
          position: 'fixed',
          left,
          top: row.top,
          bottom: 'auto',
          right: 'auto',
          maxHeight: maxH,
          zIndex: 10061,
        })
      } else {
        const maxH = Math.max(120, Math.min(320, spaceAbove))
        setFlyoutSide(side)
        setFlyoutStyle({
          position: 'fixed',
          left,
          top: 'auto',
          bottom: Math.max(pad, window.innerHeight - row.bottom),
          right: 'auto',
          maxHeight: maxH,
          zIndex: 10061,
        })
      }
      return
    }

    // 非 portal：absolute 级联，贴边时改向左
    setFlyoutStyle(null)
    flyout.classList.remove('is-left')
    vendorEl.classList.remove('is-flyout-left')
    const rect = flyout.getBoundingClientRect()
    const overflowRight = rect.right > window.innerWidth - 10
    if (overflowRight) {
      setFlyoutSide('left')
      flyout.classList.add('is-left')
      vendorEl.classList.add('is-flyout-left')
    } else {
      setFlyoutSide('right')
    }
  }, [vendorHover, portalStack, cascadePortal, catalog, connNameMap])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    if (!open || !portalFixed || typeof window === 'undefined') {
      setPortalStyle(null)
      return
    }
    const update = () => {
      const btn = triggerRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const gap = 10
      const sidePad = 10
      if (portalStack) {
        const maxW = Math.min(window.innerWidth - sidePad * 2, 340)
        const left = Math.max(sidePad, Math.min(r.left, window.innerWidth - sidePad - maxW))
        if (placement === 'down') {
          const top = r.bottom + gap
          const maxH = Math.max(120, Math.min(window.innerHeight * 0.55, window.innerHeight - top - sidePad))
          setPortalStyle({
            position: 'fixed',
            left,
            top,
            bottom: 'auto',
            width: maxW,
            maxWidth: maxW,
            maxHeight: maxH,
            zIndex: 10060,
          })
          return
        }
        const bottom = Math.max(sidePad, window.innerHeight - r.top + gap)
        const maxH = Math.max(120, Math.min(window.innerHeight * 0.55, r.top - gap - sidePad))
        setPortalStyle({
          position: 'fixed',
          left,
          bottom,
          top: 'auto',
          width: maxW,
          maxWidth: maxW,
          maxHeight: maxH,
          zIndex: 10060,
        })
        return
      }

      // 桌面平铺列表：固定宽度
      const vendorMaxW = 280
      const left = Math.max(sidePad, Math.min(r.left, window.innerWidth - sidePad - vendorMaxW))
      if (placement === 'down') {
        const top = r.bottom + gap
        const maxH = Math.max(120, Math.min(window.innerHeight * 0.55, window.innerHeight - top - sidePad))
        setPortalStyle({
          position: 'fixed',
          left,
          top,
          bottom: 'auto',
          maxWidth: vendorMaxW,
          maxHeight: maxH,
          zIndex: 10060,
        })
        return
      }
      const bottom = Math.max(sidePad, window.innerHeight - r.top + gap)
      const maxH = Math.max(120, Math.min(window.innerHeight * 0.55, r.top - gap - sidePad))
      setPortalStyle({
        position: 'fixed',
        left,
        bottom,
        top: 'auto',
        maxWidth: vendorMaxW,
        maxHeight: maxH,
        zIndex: 10060,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, portalFixed, portalStack, placement, pillLabel])

  useEffect(() => {
    if (!open || !manageDismiss) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (localRootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      if (flyoutRef.current?.contains(target)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, manageDismiss, onOpenChange])

  const modelDisabled = disabled || (loading && !catalog.length)
  // 当前所选模型的厂商（触发按钮显示厂商 logo）
  const selectedVendor = catalog.find((m) => m.name === selectedModel)?.vendor

  const menuBody =
    open && !modelDisabled ? (
      <div
        ref={menuRef}
        className={`react-chat-bottom-dropdown react-chat-bottom-dropdown--model${
          portalFixed ? ' react-chat-bottom-dropdown--model-portal' : ''
        }${portalStack ? ' is-portal-stack' : ''}${cascadePortal ? ' is-portal-cascade' : ''}`}
        role="menu"
        style={portalFixed ? portalStyle || { display: 'none' } : undefined}
      >
        {catalog.length > 0 ? (
          <div className="react-chat-model-flat-list" role="group" aria-label={t('chatShell.mcmListAria')}>
            {catalog.map((row) => {
              const label = modelDisplayLabel(row)
              const fullTitle =
                row.availabilityStatus === 'unavailable'
                  ? row.unavailableReason || t('chatShell.mcmUnavailableTitle')
                  : row.name && label !== row.name
                    ? `${label}\n${row.name}`
                    : label || row.name
              const selected = row.name === selectedModel
              return (
                <button
                  key={row.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`react-chat-model-flat-item${selected ? ' is-active' : ''}${
                    row.availabilityStatus === 'unavailable' ? ' is-unavailable' : ''
                  }`}
                  title={fullTitle}
                  onClick={() => {
                    onSelect(row.name)
                    onOpenChange(false)
                  }}
                >
                  <span className="react-chat-model-flat-item-logo">
                    <VendorLogo vendor={row.vendor} size={15} />
                  </span>
                  <span className="react-chat-model-flat-item-label">{label}</span>
                  {row.availabilityStatus === 'unavailable' ? (
                    <span className="react-chat-model-item-badge">{t('models.unavailable')}</span>
                  ) : null}
                  {selected ? (
                    <svg className="react-chat-model-flat-item-check" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="react-chat-bottom-dropdown-empty">
            {loading ? t('chatShell.mcmLoading') : t('chatShell.mcmEmpty')}
          </div>
        )}
        {/* ── 模型管理入口（跳转设置-模型配置） ── */}
        <div className="react-chat-model-manage-entry">
          <button
            type="button"
            role="menuitem"
            title={t('chatShell.mcmManageTitle')}
            onClick={() => {
              onOpenChange(false)
              navigate('/models')
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68 1.65 1.65 0 0010 3.17V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.6.66 1.03 1.28 1.03H21a2 2 0 010 4h-.09c-.62 0-1.14.43-1.28 1.03z" />
            </svg>
            <span>{t('chatShell.mcmManageLabel')}</span>
          </button>
        </div>
        {thinking?.supported && thinking.options.length ? (
          <ModelThinkingSlider
            level={thinking.level}
            options={thinking.options}
            onSelect={thinking.onSelect}
            onClose={onOpenChange}
          />
        ) : null}
      </div>
    ) : null

  return (
    <div
      className={`react-chat-bottom-pill-root${
        placement === 'down' ? ' react-chat-bottom-pill-root--down' : ''
      } ${className}`.trim()}
      ref={setRootNode}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`react-chat-bottom-pill react-chat-bottom-model-pill${
          modelDisabled ? ' react-chat-bottom-pill--disabled' : ''
        }${open ? ' react-chat-bottom-pill--open' : ''}${triggerClassName ? ` ${triggerClassName}` : ''}`}
        title={modelDisabled ? undefined : pillLabel}
        disabled={modelDisabled}
        onClick={() => {
          const next = !open
          if (next) onBeforeOpen?.()
          onOpenChange(next)
        }}
      >
        <VendorLogo vendor={selectedVendor} size={14} className="react-chat-bottom-pill-vendor-logo" />
        <span className="react-chat-bottom-pill-text react-chat-bottom-pill-text--model">
          {pillLabel}
        </span>
        <span className="react-chat-bottom-pill-caret">▾</span>
      </button>
      {portalFixed && typeof document !== 'undefined' && menuBody
        ? createPortal(menuBody, document.body)
        : menuBody}
    </div>
  )
}

export default ModelCatalogMenu
