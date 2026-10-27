/**
 * 侧栏统一图标（lucide-react，与 shadcn / app-workflow 同一图标库）
 * 统一线宽，禁止 emoji / 彩色文件夹。
 */
import { memo } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  Archive,
  ChevronRight,
  CircleAlert,
  CircleMinus,
  Folder,
  FolderOpen,
  FolderPlus,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Star,
  Users,
  X,
} from 'lucide-react'

/** 侧栏统一描边（对齐 ChatGPT 细线图标） */
export const SHELL_ICON_STROKE = 1.5

type ShellIconProps = {
  icon: LucideIcon
  size?: number
  className?: string
  strokeWidth?: number
} & Omit<LucideProps, 'size' | 'strokeWidth' | 'className' | 'ref'>

export function ShellIcon({
  icon: Icon,
  size = 16,
  className,
  strokeWidth = SHELL_ICON_STROKE,
  ...rest
}: ShellIconProps) {
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
      {...rest}
    />
  )
}

/** 工作空间 */
export function ShellWorkspaceIcon({
  size = 15,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Layers} size={size} className={className} />
}

/** 智能体员工 */
export function ShellEmployeesIcon({
  size = 15,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Users} size={size} className={className} />
}

/** 普通目录 */
export function ShellFolderIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Folder} size={size} className={className} />
}

/** 展开目录 */
export function ShellFolderOpenIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={FolderOpen} size={size} className={className} />
}

/** 会话 */
export function ShellSessionIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={MessageSquare} size={size} className={className} />
}

/** 展开箭头：默认 ›，展开后由 CSS rotate(90deg) */
export function ShellChevronIcon({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={ChevronRight} size={size} className={className} />
}

export function ShellSearchIcon({
  size = 15,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Search} size={size} className={className} />
}

export function ShellFolderPlusIcon({
  size = 15,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={FolderPlus} size={size} className={className} />
}

export function ShellPlusIcon({
  size = 13,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Plus} size={size} className={className} />
}

export const ShellLoaderIcon = memo(function ShellLoaderIcon({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Loader2} size={size} className={className} />
})

export function ShellErrorIcon({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={CircleAlert} size={size} className={className} />
}

export function ShellWaitingIcon({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Info} size={size} className={className} />
}

export function ShellPinIcon({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Pin} size={size} className={className} />
}

/** 工作空间收藏 */
export function ShellStarIcon({
  size = 12,
  className,
  filled = false,
}: {
  size?: number
  className?: string
  filled?: boolean
}) {
  return (
    <ShellIcon
      icon={Star}
      size={size}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
    />
  )
}

/** 清除 / 关闭 */
export function ShellCloseIcon({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={X} size={size} className={className} />
}

/** 刷新列表 */
export function ShellRefreshIcon({
  size = 15,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={RefreshCw} size={size} className={className} />
}

/** 更多（三点，豆包式项目操作入口） */
export function ShellMoreIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={MoreHorizontal} size={size} className={className} />
}

/** 编辑项目标题 */
export function ShellEditIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Pencil} size={size} className={className} />
}

/** 归档项目中的对话 */
export function ShellArchiveIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={Archive} size={size} className={className} />
}

/** 移除项目 */
export function ShellRemoveIcon({
  size = 14,
  className,
}: {
  size?: number
  className?: string
}) {
  return <ShellIcon icon={CircleMinus} size={size} className={className} />
}
