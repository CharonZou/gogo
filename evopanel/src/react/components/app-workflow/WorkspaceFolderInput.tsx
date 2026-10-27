import { useT } from '../../lib/useI18n'

type Props = {
  id?: string
  className?: string
  value: string
  placeholder?: string
  pickTitle?: string
  onChange: (next: string) => void
}

export function WorkspaceFolderInput({
  id,
  className,
  value,
  placeholder,
  pickTitle,
  onChange,
}: Props) {
  const t = useT()
  const resolvedPickTitle = pickTitle ?? t('workflow.pickWorkspaceDir')
  const pickFolder = () => {
    void (async () => {
      const mod = await import('../../../lib/workspace-field-ui.js')
      const resolved = await mod.pickResolvedWorkspaceFolder({
        defaultPath: value,
        title: resolvedPickTitle,
      })
      if (resolved) onChange(resolved)
    })()
  }

  return (
    <div className="wf-folder-input-row">
      <input
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="wf-folder-input-pick"
        title={t('workflow.pickFolderTitle')}
        onClick={pickFolder}
      >
        {t('workflow.browse')}
      </button>
    </div>
  )
}
