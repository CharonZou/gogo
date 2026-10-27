import { Braces } from 'lucide-react'
import { useT } from '../../lib/useI18n'

export type RunVar = {
  name: string
  label: string
  type?: string
  required?: boolean
}

type Props = {
  vars: RunVar[]
  onManage?: () => void
  /** compact for start node canvas */
  compact?: boolean
}

/** FastGPT-like global variable list (app run parameters). */
export function RunVarsPanel({ vars, onManage, compact }: Props) {
  const t = useT()
  // 变量类型标签在渲染时取词，避免模块级常量固化导入期语言
  const typeLabel: Record<string, string> = {
    text: t('workflow.varTypeText'),
    textarea: t('workflow.varTypeTextarea'),
    number: t('workflow.varTypeNumber'),
    select: t('workflow.varTypeSelect'),
  }
  if (compact) {
    if (!vars.length) {
      return <span className="wf-run-vars-compact-empty">{t('workflow.noVarsCompact')}</span>
    }
    return (
      <div className="wf-run-vars-compact" title={t('workflow.runVarsTitle')}>
        {vars.slice(0, 4).map((v) => (
          <span key={v.name} className="wf-run-vars-chip">
            <Braces size={10} />
            {v.label || v.name}
          </span>
        ))}
        {vars.length > 4 ? <span className="wf-run-vars-chip is-more">+{vars.length - 4}</span> : null}
      </div>
    )
  }

  return (
    <div className="wf-run-vars-panel">
      <div className="wf-run-vars-panel-head">
        <span>{t('workflow.runVarsHead')}</span>
        {onManage ? (
          <button type="button" className="wf-drawer-text-btn" onClick={onManage}>
            {vars.length ? t('workflow.manage') : t('workflow.addVar')}
          </button>
        ) : null}
      </div>
      <p className="wf-drawer-tip" style={{ margin: '0 0 10px' }}>
        {/* i18n: 保留 {{变量名}} 中文示例——变量插入语法演示文本（用户自定义变量名示例），非界面标签 */}
        {t('workflow.runVarsTipPre')}<kbd>/</kbd>{t('workflow.runVarsTipMid')}{'{{变量名}}'}。
      </p>
      {vars.length ? (
        <ul className="wf-run-vars-list">
          {vars.map((v) => (
            <li key={v.name} className="wf-run-vars-row">
              <div className="wf-run-vars-row-main">
                <span className="wf-run-vars-row-label">{v.label || v.name}</span>
                {v.required !== false ? <span className="wf-run-vars-req">{t('workflow.required')}</span> : null}
              </div>
              <code className="wf-run-vars-key">{`{{${v.name}}}`}</code>
              <span className="wf-run-vars-type">
                {typeLabel[String(v.type || 'text')] || String(v.type || 'text')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="wf-run-vars-empty">{t('workflow.runVarsEmpty')}</div>
      )}
    </div>
  )
}
