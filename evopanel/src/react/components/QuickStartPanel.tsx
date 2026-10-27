import { useCallback } from 'react'
import { gogo_INTRO_SELF_PROMPT } from '../../lib/gogo-intro-prompt.js'
import { useT } from '../lib/useI18n'

const CARD_ASSET_BASE = '/assets/gogo_card_png_assets'

type ActionCard = {
  id: string
  title: string
  desc: string
  iconSrc: string
  illustrationSrc: string
  prompt: string
}

function actionCards(t: (key: string) => string): ActionCard[] {
  return [
    {
      id: 'intro',
      title: t('chatUi.introSelfLabel'),
      desc: t('chatShell.qsIntroDesc'),
      iconSrc: `${CARD_ASSET_BASE}/intro_icon.png`,
      illustrationSrc: `${CARD_ASSET_BASE}/intro_3d.png`,
      prompt: gogo_INTRO_SELF_PROMPT,
    },
    {
      id: 'agent',
      title: t('chatShell.qsAgentTitle'),
      desc: t('chatShell.qsAgentDesc'),
      iconSrc: `${CARD_ASSET_BASE}/role_icon.png`,
      illustrationSrc: `${CARD_ASSET_BASE}/role_3d.png`,
      prompt: t('chatShell.qsAgentPrompt'),
    },
    {
      id: 'skill',
      title: t('chatShell.qsSkillTitle'),
      desc: t('chatShell.qsSkillDesc'),
      iconSrc: `${CARD_ASSET_BASE}/skill_icon.png`,
      illustrationSrc: `${CARD_ASSET_BASE}/skill_3d.png`,
      prompt: t('chatShell.qsSkillPrompt'),
    },
    {
      id: 'cron',
      title: t('chatShell.qsCronTitle'),
      desc: t('chatShell.qsCronDesc'),
      iconSrc: `${CARD_ASSET_BASE}/schedule_icon.png`,
      illustrationSrc: `${CARD_ASSET_BASE}/schedule_3d.png`,
      prompt: t('chatShell.qsCronPrompt'),
    },
    {
      id: 'hosted',
      title: t('chatShell.qsHostedTitle'),
      desc: t('chatShell.qsHostedDesc'),
      iconSrc: `${CARD_ASSET_BASE}/agent_icon.png`,
      illustrationSrc: `${CARD_ASSET_BASE}/agent_3d.png`,
      prompt: t('chatShell.qsHostedPrompt'),
    },
    {
      id: 'model',
      title: t('chatShell.qsModelTitle'),
      desc: t('chatShell.qsModelDesc'),
      iconSrc: `${CARD_ASSET_BASE}/model_icon.png`,
      illustrationSrc: `${CARD_ASSET_BASE}/model_3d.png`,
      prompt: '__nav__',
    },
  ]
}

const MODEL_ROUTE = '#/settings?tab=models'

export function QuickStartPanel({ onPrompt }: { onPrompt?: (text: string) => void }) {
  const t = useT()
  const handleCard = useCallback(
    (card: ActionCard) => {
      if (card.id === 'model') {
        window.location.hash = MODEL_ROUTE
        return
      }
      if (onPrompt) onPrompt(card.prompt)
    },
    [onPrompt],
  )

  return (
    <div className="quick-start-panel">
      <div className="quick-start-header">
        <h2 className="quick-start-title">
          {t('chatShell.qsWelcome')}{' '}
          <span className="quick-start-title-brand">GoGo</span>
          {' '}&#x1F44B;
        </h2>
        <p className="quick-start-desc">{t('chatShell.qsPanelDesc')}</p>
      </div>

      <div className="quick-start-grid">
        {actionCards(t).map((card) => (
          <button
            key={card.id}
            type="button"
            className="quick-start-card"
            onClick={() => handleCard(card)}
            title={card.prompt === '__nav__' ? t('chatShell.qsNavTitle') : card.prompt}
          >
            <div className="quick-start-card-body">
              <div className="quick-start-card-text">
                <span className="quick-start-card-head">
                  <img className="quick-start-card-icon" src={card.iconSrc} alt="" aria-hidden="true" />
                  <span className="quick-start-card-title">{card.title}</span>
                </span>
                <span className="quick-start-card-desc">{card.desc}</span>
              </div>
              <span className="quick-start-card-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </div>
            <div className="quick-start-card-illustration-area">
              <img
                className="quick-start-card-illustration"
                src={card.illustrationSrc}
                alt=""
                aria-hidden="true"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
