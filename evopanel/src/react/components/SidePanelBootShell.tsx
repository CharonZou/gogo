import { useT } from '../lib/useI18n'

export function SidePanelBootShell({
  title,
  className = 'react-chat-collab-exec-panel',
  bodyClassName = 'react-chat-collab-exec-panel-body',
}: {
  title: string
  className?: string
  bodyClassName?: string
}) {
  const t = useT()
  return (
    <aside className={className} role="region" aria-busy="true" aria-label={title}>
      <header className="react-chat-collab-exec-panel-header">
        <div className="react-chat-collab-exec-panel-title-wrap">
          <span className="react-chat-collab-exec-panel-title">{title}</span>
        </div>
      </header>
      <div className={`${bodyClassName} react-chat-side-panel-boot`}>
        <div className="page-loader-spinner" aria-hidden="true" />
        <span className="page-loader-text">{t('chatShell.loading')}</span>
      </div>
    </aside>
  )
}
