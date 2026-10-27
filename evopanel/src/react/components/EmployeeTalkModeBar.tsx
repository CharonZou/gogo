/**
 * 智能体员工会话：只聊天 / 派任务 / 继续任务 三模式切换条。
 */
import type { RefObject } from 'react'
import { useT } from '../lib/useI18n'

export type EmployeeTalkMode = 'chat' | 'dispatch' | 'resume'

export type EmployeeOpenTask = {
  taskId: string
  name: string
  status: string
  progress?: number
  roundId?: string
}

export type EmployeeTalkModeBarProps = {
  mode: EmployeeTalkMode
  onModeChange: (mode: EmployeeTalkMode) => void
  openTasks: EmployeeOpenTask[]
  resumeTaskId: string
  onResumeTaskChange: (taskId: string) => void
  onFreshChat: () => void
  hintTask?: EmployeeOpenTask | null
  onHintResume?: () => void
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
  menuRef?: RefObject<HTMLDivElement | null>
}

/** 导入期不取文案：模式条的标签与说明只带键名，渲染时 t(meta.labelKey) 解析 */
const MODE_META: Record<EmployeeTalkMode, { labelKey: string; titleKey: string }> = {
  chat: {
    labelKey: 'chatShell.modeChatLabel',
    titleKey: 'chatShell.modeChatTitle',
  },
  dispatch: {
    labelKey: 'chatShell.modeDispatchLabel',
    titleKey: 'chatShell.modeDispatchTitle',
  },
  resume: {
    labelKey: 'chatShell.modeResumeLabel',
    titleKey: 'chatShell.modeResumeTitle',
  },
}

export function EmployeeTalkModeBar({
  mode,
  onModeChange,
  openTasks,
  resumeTaskId,
  onResumeTaskChange,
  onFreshChat,
  hintTask,
  onHintResume,
  menuOpen = false,
  onMenuOpenChange,
  menuRef,
}: EmployeeTalkModeBarProps) {
  const t = useT()
  const meta = MODE_META[mode]
  const resumeLabel =
    openTasks.find((item) => item.taskId === resumeTaskId)?.name ||
    (resumeTaskId ? resumeTaskId : t('chatShell.selectTask'))

  return (
    <div className="employee-talk-mode-wrap">
      {hintTask && mode === 'chat' ? (
        <div className="employee-talk-hint" role="status">
          <span className="employee-talk-hint-text">
            {t('chatShell.hintInProgress', { name: hintTask.name })}
            {typeof hintTask.progress === 'number'
              ? t('chatShell.hintProgress', { progress: hintTask.progress })
              : ''}
          </span>
          <button type="button" className="employee-talk-hint-btn" onClick={() => onHintResume?.()}>
            {t('chatShell.switchToResume')}
          </button>
          <span className="employee-talk-hint-muted">{t('chatShell.hintChatOnly')}</span>
        </div>
      ) : null}

      <div className="employee-talk-mode-row">
        <div className="react-chat-mode-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="react-chat-bottom-pill react-chat-bottom-mode-pill employee-talk-mode-pill"
            title={t(meta.titleKey)}
            onClick={() => onMenuOpenChange?.(!menuOpen)}
          >
            <span className="react-chat-bottom-pill-text">{t(meta.labelKey)}</span>
            <span className="react-chat-bottom-pill-caret">▾</span>
          </button>
          {menuOpen ? (
            <div className="react-chat-mode-menu" role="menu">
              {(Object.keys(MODE_META) as EmployeeTalkMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`react-chat-mode-item${m === mode ? ' active' : ''}`}
                  title={t(MODE_META[m].titleKey)}
                  onClick={() => {
                    onMenuOpenChange?.(false)
                    onModeChange(m)
                  }}
                >
                  {t(MODE_META[m].labelKey)}
                  <span className="employee-talk-mode-item-desc">{t(MODE_META[m].titleKey)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {mode === 'chat' ? (
          <button
            type="button"
            className="react-chat-bottom-pill employee-talk-fresh-pill"
            title={t('chatShell.freshChatTitle')}
            onClick={onFreshChat}
          >
            {t('chatShell.freshChat')}
          </button>
        ) : null}

        {mode === 'resume' ? (
          <label className="employee-talk-resume-select-wrap" title={t('chatShell.resumeSelectTitle')}>
            <span className="sr-only">{t('chatShell.resumeTaskAria')}</span>
            <select
              className="employee-talk-resume-select"
              value={resumeTaskId}
              onChange={(e) => onResumeTaskChange(e.target.value)}
            >
              <option value="">{t('chatShell.selectOpenTask')}</option>
              {openTasks.map((item) => (
                <option key={item.taskId} value={item.taskId}>
                  {item.name || item.taskId}
                  {item.status ? ` · ${item.status}` : ''}
                </option>
              ))}
            </select>
            {!openTasks.length ? (
              <span className="employee-talk-hint-muted">{t('chatShell.noOpenTasks')}</span>
            ) : (
              <span className="employee-talk-resume-current" title={resumeLabel}>
                {resumeTaskId ? t('chatShell.selectedShort') : t('chatShell.notSelectedShort')}
              </span>
            )}
          </label>
        ) : null}
      </div>
    </div>
  )
}

export function mintEmployeeChatEpisodeId(): string {
  return `chat:${new Date().toISOString()}`
}

/** 输入框占位文案：调用方传入 t（组件里用 useT()），导入期不取文案 */
export function employeeTalkPlaceholder(
  mode: EmployeeTalkMode,
  translate: (key: string) => string,
): string {
  if (mode === 'dispatch') return translate('chatShell.placeholderDispatch')
  if (mode === 'resume') return translate('chatShell.placeholderResume')
  return translate('chatShell.placeholderChat')
}
