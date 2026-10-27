import type { NavKey } from '../types';
import { useT } from '../../lib/useI18n'

export function Sidebar({ active, onChange }: { active: NavKey; onChange: (key: NavKey) => void }) {
  const t = useT() // 局部遮蔽：t 与 props 无冲突
  // 导航项渲染期组装，以便切换语言时更新
  const items: Array<{ key: NavKey; label: string; icon: string }> = [
    { key: 'dashboard', label: t('obs.obsNavDashboard'), icon: '⌂' },
    { key: 'requests', label: t('obs.obsNavRequests'), icon: '☷' },
    { key: 'agents', label: 'Agent', icon: '♙' }, // 英文品牌词保留
    { key: 'models', label: t('obs.obsNavModels'), icon: '◇' },
    { key: 'tools', label: t('obs.obsNavTools'), icon: '⚒' },
    { key: 'tool-calls', label: t('obs.obsNavToolCalls'), icon: '⚙' },
    { key: 'mcp', label: 'MCP', icon: '⬡' }, // 英文缩写保留
    { key: 'gateway', label: t('obs.obsNavGateway'), icon: '◎' },
    { key: 'trace', label: t('obs.obsNavTrace'), icon: '⌁' },
    { key: 'analytics', label: t('obs.obsNavAnalytics'), icon: '▥' },
    { key: 'code-index', label: t('obs.obsNavCodeIndex'), icon: '⌘' },
    { key: 'settings', label: t('obs.obsNavSettings'), icon: '⚙' },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">E</div>
        <div>
          <strong>GoGo</strong>
          <span>Observability</span>
        </div>
      </div>
      <nav className="nav-list">
        {items.map((item) => (
          <button key={item.key} className={active === item.key ? 'nav-item active' : 'nav-item'} onClick={() => onChange(item.key)}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="team-card">
        <div className="team-avatar">E</div>
        <div>
          <strong>GoGo Team</strong>
          <span>Enterprise Plan</span>
        </div>
        <span className="chevron">⌄</span>
      </div>
    </aside>
  );
}
