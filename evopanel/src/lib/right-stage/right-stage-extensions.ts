import { defaultTitleForKind } from './right-stage-types.js'
import { t } from '../i18n.js'

/** 由顶栏「扩展」菜单手动打开的 Stage（与工作区/思维导图等独立入口区分）。 */
export type UserStageExtensionKind = 'web-embed'

export type UserStageExtensionEntry = {
  kind: UserStageExtensionKind
  label: string
  description: string
}

/** 资讯热榜已从菜单移除；保留浏览器内嵌。扩展应用列表由工具栏动态加载。 */
// i18n：常量化会固化导入时的语言，改为函数在调用时刻解析（词典见 locales/modules/chat-ui.js）
export function userStageExtensions(): UserStageExtensionEntry[] {
  return [
    {
      kind: 'web-embed',
      label: t('chatUi.stageExtBrowserLabel'),
      description: t('chatUi.stageExtBrowserDesc'),
    },
  ]
}

const EXTENSION_KIND_SET = new Set<string>(userStageExtensions().map((e) => e.kind))

export function isUserStageExtensionKind(kind: string | null | undefined): kind is UserStageExtensionKind {
  return !!kind && EXTENSION_KIND_SET.has(kind)
}

export function getUserStageExtensionEntry(
  kind: string | null | undefined,
): UserStageExtensionEntry | null {
  if (!isUserStageExtensionKind(kind)) return null
  return userStageExtensions().find((e) => e.kind === kind) ?? null
}

export function titleForUserStageExtension(kind: UserStageExtensionKind): string {
  return getUserStageExtensionEntry(kind)?.label ?? defaultTitleForKind(kind)
}
