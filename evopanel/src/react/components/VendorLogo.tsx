/**
 * 模型厂商品牌图标：复用设置-模型页的官方品牌图标（public/icons）。
 * 映射与 src/pages/models.js vendorBrandIcon 保持一致；未收录厂商回退到通用图标。
 */
import { vendorRootKey } from '../lib/model-catalog.js'

type VendorLogoProps = {
  vendor?: string | null
  size?: number
  className?: string
}

/** vendor key → /icons 文件名（个别厂商为 PNG 透明底，其余 SVG） */
const VENDOR_ICON_MAP: Record<string, { name: string; ext: 'svg' | 'png' }> = {
  openai: { name: 'openai', ext: 'png' },
  anthropic: { name: 'anthropic', ext: 'svg' },
  deepseek: { name: 'deepseek', ext: 'svg' },
  google: { name: 'google', ext: 'svg' },
  nvidia: { name: 'nvidia', ext: 'svg' },
  ollama: { name: 'ollama', ext: 'svg' },
  zhipu: { name: 'zhipu', ext: 'png' },
  minimax: { name: 'minimax', ext: 'svg' },
  moonshot: { name: 'moonshot', ext: 'png' },
  volcengine: { name: 'volcengine', ext: 'png' },
  aliyun: { name: 'alibabacloud', ext: 'png' },
  siliconflow: { name: 'siliconcloud', ext: 'svg' },
  shengsuanyun: { name: 'shengsuanyun', ext: 'svg' },
}

function FallbackMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 4h16v16H4z" />
      <path d="M9 9h6v6H9z" />
    </svg>
  )
}

export function VendorLogo({ vendor, size = 14, className }: VendorLogoProps) {
  const root = vendorRootKey(String(vendor || '').trim())
  const icon = VENDOR_ICON_MAP[root]
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {icon ? (
        <img
          src={`/icons/${icon.name}.${icon.ext}`}
          alt=""
          width={size}
          height={size}
          aria-hidden="true"
          style={{ width: size, height: size, objectFit: 'contain' }}
        />
      ) : (
        <FallbackMark size={size} />
      )}
    </span>
  )
}

export default VendorLogo
