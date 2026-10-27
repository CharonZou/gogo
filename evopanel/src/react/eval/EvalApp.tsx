import { useCallback, useState, type ComponentType } from 'react'
import { useT } from '../lib/useI18n'
import { AlertPage } from './pages/AlertPage'
import { BusinessPage } from './pages/BusinessPage'
import { CasesPage } from './pages/CasesPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeesEvalPage } from './pages/EmployeesEvalPage'
import { HistoryPage } from './pages/HistoryPage'
import { PerformancePage } from './pages/PerformancePage'
import { SchedulePage } from './pages/SchedulePage'
import { SecurityPage } from './pages/SecurityPage'
import { WorkflowEvalPage } from './pages/WorkflowEvalPage'
import './styles/eval.css'

export type EvalNavKey =
  | 'dashboard'
  | 'cases'
  | 'employees'
  | 'workflow'
  | 'business'
  | 'security'
  | 'performance'
  | 'history'
  | 'schedule'
  | 'alert'

function buildSidebarNav(t: (key: string, p?: Record<string, unknown>) => string) {
  return [
    { key: 'dashboard' as EvalNavKey, label: t('eval.evalNavDashboard'), icon: '🏠', hint: t('eval.evalNavDashboardHint') },
    { key: 'cases' as EvalNavKey, label: t('eval.evalNavCases'), icon: '📚', hint: t('eval.evalNavCasesHint') },
    { key: 'employees' as EvalNavKey, label: t('eval.evalNavEmployees'), icon: '👤', hint: t('eval.evalNavEmployeesHint') },
    { key: 'workflow' as EvalNavKey, label: t('eval.evalNavWorkflow'), icon: '🔀', hint: t('eval.evalNavWorkflowHint') },
    { key: 'history' as EvalNavKey, label: t('eval.evalNavHistory'), icon: '📋', hint: t('eval.evalNavHistoryHint') },
    { key: 'business' as EvalNavKey, label: t('eval.evalNavBusiness'), icon: '💡' },
    { key: 'security' as EvalNavKey, label: t('eval.evalNavSecurity'), icon: '🛡️' },
    { key: 'performance' as EvalNavKey, label: t('eval.evalNavPerformance'), icon: '⚡' },
    { key: 'schedule' as EvalNavKey, label: t('eval.evalNavSchedule'), icon: '📅' },
    { key: 'alert' as EvalNavKey, label: t('eval.evalNavAlert'), icon: '🔔' },
  ]
}

const PAGES: Record<EvalNavKey, ComponentType<{ onNavigate?: (k: string) => void }>> = {
  dashboard: DashboardPage,
  cases: CasesPage,
  employees: EmployeesEvalPage,
  workflow: WorkflowEvalPage,
  business: BusinessPage,
  security: SecurityPage,
  performance: PerformancePage,
  history: HistoryPage,
  schedule: SchedulePage,
  alert: AlertPage,
}

const STORAGE_KEY = 'eval_active_page'

function initialNav(): EvalNavKey {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    // 注意：这里用稳定 key 比较，不做用户可见文案判断；nav label 是 t() 渲染期取值。
    if (saved && SIDE_KEYS.includes(saved as EvalNavKey)) return saved as EvalNavKey
  } catch {
    /* ignore */
  }
  return 'dashboard'
}

const SIDE_KEYS: EvalNavKey[] = [
  'dashboard', 'cases', 'employees', 'workflow', 'business',
  'security', 'performance', 'history', 'schedule', 'alert',
]

export default function EvalApp() {
  const t = useT()
  const [active, setActive] = useState<EvalNavKey>(initialNav)
  const nav = buildSidebarNav(t)

  const navigate = useCallback((key: string) => {
    if (!SIDE_KEYS.includes(key as EvalNavKey)) return
    const k = key as EvalNavKey
    setActive(k)
    try {
      sessionStorage.setItem(STORAGE_KEY, k)
    } catch {
      /* ignore */
    }
  }, [])

  const Page = PAGES[active]

  return (
    <div className="eval-root">
      <aside className="eval-sidebar">
        <div className="eval-brand">
          🧪 {t('eval.evalBrandTitle')}
          <span>{t('eval.evalBrandSub')}</span>
        </div>
        <nav className="eval-sidebar-nav">
          {nav.map((n) => (
            <button
              key={n.key}
              type="button"
              className={`eval-nav-btn ${active === n.key ? 'active' : ''}`}
              onClick={() => navigate(n.key)}
            >
              <span className="nav-ico" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="eval-back">
          <a href="#/chat">{t('eval.evalBackHome')}</a>
        </div>
      </aside>
      <main className="eval-main">
        <Page onNavigate={navigate} />
      </main>
    </div>
  )
}
