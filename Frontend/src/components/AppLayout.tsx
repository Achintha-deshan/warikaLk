import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ApiError } from '../lib/api'
import { Spinner } from './AuthLayout'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../hooks/useLanguageHook'

export default function AppLayout() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const isOwner = user?.role === 'owner'

  const signOut = async () => {
    setLoggingOut(true); setError('')
    try { await logout(); navigate('/login', { replace: true }) }
    catch (value) { setError((value as ApiError).message || 'Could not log out. Please try again.'); setLoggingOut(false) }
  }

  const languageToggle = <div className="language-toggle" aria-label="Language"><button type="button" className={language === 'en' ? 'selected' : ''} onClick={() => setLanguage('en')}>EN</button><button type="button" className={language === 'si' ? 'selected' : ''} onClick={() => setLanguage('si')}>සිං</button></div>

  return <div className="app-shell">
    <aside className="app-sidebar">
      <NavLink className="wordmark" to="/dashboard">warika<span>lk</span></NavLink>
      <div className="sidebar-context"><span className="eyebrow">{t('nav.workspace')}</span><strong>{user?.businessName || 'Collection desk'}</strong><small>{user?.role === 'owner' ? t('nav.ownerAccount') : t('nav.staffAccount')}</small></div>
      <nav className="app-nav" aria-label="Main navigation">
        <NavLink to="/dashboard" className="app-nav-link"><span>01</span>{t('nav.dashboard')}</NavLink><NavLink to="/customers" className="app-nav-link"><span>02</span>{t('nav.customers')}</NavLink><NavLink to="/loans" className="app-nav-link"><span>03</span>{t('nav.loans')}</NavLink><NavLink to="/daily-report" className="app-nav-link"><span>04</span>{t('nav.dailyReport')}</NavLink><NavLink to="/monthly-report" className="app-nav-link"><span>05</span>{t('nav.monthlyReport')}</NavLink><NavLink to="/interest-payments" className="app-nav-link"><span>06</span>{t('nav.payments')}</NavLink>
        {isOwner && <><NavLink to="/staff" className="app-nav-link"><span>07</span>{t('nav.staff')}</NavLink><NavLink to="/capital-loss" className="app-nav-link"><span>08</span>{t('nav.capitalLoss')}</NavLink><NavLink to="/agent-performance" className="app-nav-link"><span>09</span>{t('nav.agentPerformance')}</NavLink></>}
      </nav>
      <div className="sidebar-bottom">{languageToggle}{error && <p className="api-notice">{error}</p>}<button className="logout-button" type="button" disabled={loggingOut} onClick={signOut}>{loggingOut ? <Spinner /> : <><span>↗</span> {t('nav.logout')}</>}</button></div>
    </aside>
    <main className="app-main"><header className="mobile-app-header"><NavLink className="wordmark" to="/dashboard">warika<span>lk</span></NavLink>{languageToggle}<button className="mobile-logout" type="button" disabled={loggingOut} onClick={signOut}>{loggingOut ? <Spinner /> : t('nav.logout')}</button></header><Outlet /></main>
    <nav className="mobile-tabbar" aria-label="Mobile navigation"><NavLink to="/dashboard"><span>01</span>{t('nav.dashboard')}</NavLink><NavLink to="/customers"><span>02</span>{t('nav.customers')}</NavLink><NavLink to="/loans"><span>03</span>{t('nav.loans')}</NavLink><NavLink to="/daily-report"><span>04</span>{t('nav.dailyReport')}</NavLink><NavLink to="/monthly-report"><span>05</span>{t('nav.monthlyReport')}</NavLink></nav>
  </div>
}