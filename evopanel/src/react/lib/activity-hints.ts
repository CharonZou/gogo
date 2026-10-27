/**
 * GoGo 运行状态提示话术
 * 根据当前活动类型和上下文，生成有趣、有用、定制化的提示文字
 *
 * i18n：话术池为模块级常量会固化导入时的语言，因此全部改为函数内
 * 通过 t() 在调用时刻解析（词典见 locales/modules/chat-ui.js）。
 */

import { t } from '../../lib/i18n.js'

// 工具调用话术池 - GoGo 定制版
function toolHints(): Record<string, string[]> {
  return {
    // 文件操作
    'write_file': [
      t('chatUi.hintWrite1'),
      t('chatUi.hintWrite2'),
      t('chatUi.hintWrite3'),
      t('chatUi.hintWrite4'),
      t('chatUi.hintWrite5'),
    ],
    'read_file': [
      t('chatUi.hintRead1'),
      t('chatUi.hintRead2'),
      t('chatUi.hintRead3'),
      t('chatUi.hintRead4'),
    ],
    'terminal': [
      t('chatUi.hintTerminal1'),
      t('chatUi.hintTerminal2'),
      t('chatUi.hintTerminal3'),
      t('chatUi.hintTerminal4'),
    ],
    'search': [
      t('chatUi.hintSearch1'),
      t('chatUi.hintSearch2'),
      t('chatUi.hintSearch3'),
      t('chatUi.hintSearch4'),
    ],

    // 子任务/协作
    'subagent': [
      t('chatUi.hintSubagent1'),
      t('chatUi.hintSubagent2'),
      t('chatUi.hintSubagent3'),
      t('chatUi.hintSubagent4'),
    ],
    'plan': [
      t('chatUi.hintPlan1'),
      t('chatUi.hintPlan2'),
      t('chatUi.hintPlan3'),
      t('chatUi.hintPlan4'),
    ],

    // 工具执行
    'tool_call': [
      t('chatUi.hintToolCall1'),
      t('chatUi.hintToolCall2'),
      t('chatUi.hintToolCall3'),
      t('chatUi.hintToolCall4'),
    ],

    // 思考
    'think': thinkingHints().slice(0, 5),

    // 澄清
    'clarification': clarificationHints().slice(0, 4),

    // 审批
    'approval': approvalHints().slice(0, 3),

    // 记忆整理
    'compacting': compactingHints().slice(0, 4),

    // 重试
    'retrying': retryingHints().slice(0, 4),

    // 默认
    'default': [
      t('chatUi.hintDefault1'),
      t('chatUi.hintDefault2'),
      t('chatUi.hintDefault3'),
      t('chatUi.hintDefault4'),
    ],
  }
}

// 思考/推理话术
function thinkingHints(): string[] {
  return [
    t('chatUi.hintThink1'),
    t('chatUi.hintThink2'),
    t('chatUi.hintThink3'),
    t('chatUi.hintThink4'),
    t('chatUi.hintThink5'),
    t('chatUi.hintThink6'),
    t('chatUi.hintThink7'),
  ]
}

// 澄清/等待用户话术
function clarificationHints(): string[] {
  return [
    t('chatUi.hintClarify1'),
    t('chatUi.hintClarify2'),
    t('chatUi.hintClarify3'),
    t('chatUi.hintClarify4'),
    t('chatUi.hintClarify5'),
  ]
}

// 工具审批话术
function approvalHints(): string[] {
  return [
    t('chatUi.hintApproval1'),
    t('chatUi.hintApproval2'),
    t('chatUi.hintApproval3'),
    t('chatUi.hintApproval4'),
  ]
}

// 记忆整理话术
function compactingHints(): string[] {
  return [
    t('chatUi.hintCompact1'),
    t('chatUi.hintCompact2'),
    t('chatUi.hintCompact3'),
    t('chatUi.hintCompact4'),
    t('chatUi.hintCompact5'),
  ]
}

// 重试话术
function retryingHints(): string[] {
  return [
    t('chatUi.hintRetry1'),
    t('chatUi.hintRetry2'),
    t('chatUi.hintRetry3'),
    t('chatUi.hintRetry4'),
    t('chatUi.hintRetry5'),
  ]
}

/**
 * 获取工具名称的友好显示
 */
export function getToolFriendlyName(toolName: string): string {
  const nameMap: Record<string, string> = {
    'write_file': t('chatUi.toolFriendlyWriteFile'),
    'read_file': t('chatUi.toolFriendlyReadFile'),
    'terminal': t('chatUi.toolFriendlyTerminal'),
    'search': t('chatUi.toolFriendlySearch'),
    'subagent': t('chatUi.toolFriendlySubagent'),
    'plan': t('chatUi.toolFriendlyPlan'),
    'tool_call': t('chatUi.toolFriendlyToolCall'),
    'think': t('chatUi.thinkingLabel'),
    'clarification': t('chatUi.toolFriendlyClarification'),
    'approval': t('chatUi.toolFriendlyApproval'),
    'compacting': t('chatUi.toolFriendlyCompacting'),
    'retry': t('chatUi.toolFriendlyRetry'),
  }
  return nameMap[toolName] || toolName
}

/**
 * 获取工具执行时的随机话术
 */
export function getToolHint(toolName?: string): string {
  const pool = toolName ? (toolHints()[toolName] || toolHints()['default']) : toolHints()['default']
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 获取思考阶段的随机话术
 */
export function getThinkingHint(): string {
  const pool = thinkingHints()
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 获取澄清阶段的随机话术
 */
export function getClarificationHint(): string {
  const pool = clarificationHints()
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 获取审批阶段的随机话术
 */
export function getApprovalHint(): string {
  const pool = approvalHints()
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 获取整理记忆阶段的随机话术
 */
export function getCompactingHint(): string {
  const pool = compactingHints()
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 获取重试阶段的随机话术
 */
export function getRetryingHint(): string {
  const pool = retryingHints()
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 根据活动类型获取提示文字
 */
export function getActivityHint(
  activityKind: string,
  toolName?: string,
  toolPreview?: string
): string {
  const kind = (activityKind || 'idle').trim().toLowerCase()
  switch (kind) {
    case 'thinking':
      return getThinkingHint()
    case 'clarification':
      return getClarificationHint()
    case 'tool_approval':
      return getApprovalHint()
    case 'compacting':
      return getCompactingHint()
    case 'retrying':
      return getRetryingHint()
    case 'tools':
      // 如果有工具预览，优先显示工具名
      if (toolPreview) {
        return t('chatUi.execToolPreview', { tool: toolPreview })
      }
      return getToolHint(toolName)
    case 'idle':
      return ''
    default:
      return getToolHint(kind)
  }
}

/**
 * 获取活动类型标签
 */
export function getActivityLabel(activityKind: string): string {
  const kind = (activityKind || 'idle').trim().toLowerCase()
  const labels: Record<string, string> = {
    'thinking': t('chatUi.activityThinking'),
    'tools': t('chatUi.activityTools'),
    'clarification': t('chatUi.activityClarification'),
    'tool_approval': t('chatUi.activityToolApproval'),
    'compacting': t('chatUi.activityCompacting'),
    'retrying': t('chatUi.activityRetrying'),
    'idle': t('chatUi.activityIdle'),
  }
  return labels[kind] || t('chatUi.processing')
}
