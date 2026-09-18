import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ApiError } from '../lib/api'
import { Spinner } from './AuthLayout'
import { useAuth } from '../hooks/useAuth'

export default function AppLayout() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const isOwner = user?.role === 'owner'

  const signOut = async () => {
    setLoggingOut(true); setError('')
    try { await logout(); navigate('/login', { replace: true }) }
    catch (value) { setError((value as ApiError).message || 'Could not log out. Please try again.'); setLoggingOut(false) }
  }

  return <div className="app-shell">
    <aside className="app-sidebar">
      <NavLink className="wordmark" to="/dashboard">warika<span>lk</span></NavLink>
      <div className="sidebar-context"><span className="eyebrow">Workspace</span><strong>{user?.businessName || 'Collection desk'}</strong><small>{user?.role === 'owner' ? 'Owner account' : 'Staff account'}</small></div>
      <nav className="app-nav" aria-label="Main navigation">
        <NavLink to="/dashboard" className="app-nav-link"><span>01</span>Dashboard</NavLink>
        <NavLink to="/customers" className="app-nav-link"><span>02</span>Customers</NavLink>
        <NavLink to="/loans" className="app-nav-link"><span>03</span>Loans</NavLink>
        <NavLink to="/interest-payments" className="app-nav-link"><span>04</span>Payments</NavLink>
        {isOwner && <><NavLink to="/staff" className="app-nav-link"><span>05</span>Staff</NavLink><NavLink to="/capital-loss" className="app-nav-link"><span>06</span>Capital loss</NavLink><NavLink to="/agent-performance" className="app-nav-link"><span>07</span>Agent performance</NavLink></>}
      </nav>
      <div className="sidebar-bottom">{error && <p className="api-notice">{error}</p>}<button className="logout-button" type="button" disabled={loggingOut} onClick={signOut}>{loggingOut ? <Spinner /> : <><span>↗</span> Log out</>}</button></div>
    </aside>
    <main className="app-main"><header className="mobile-app-header"><NavLink className="wordmark" to="/dashboard">warika<span>lk</span></NavLink><button className="mobile-logout" type="button" disabled={loggingOut} onClick={signOut}>{loggingOut ? <Spinner /> : 'Log out'}</button></header><Outlet /></main>
    <nav className="mobile-tabbar" aria-label="Mobile navigation"><NavLink to="/dashboard"><span>01</span>Home</NavLink><NavLink to="/customers"><span>02</span>Customers</NavLink><NavLink to="/loans"><span>03</span>Loans</NavLink><NavLink to="/interest-payments"><span>04</span>Payments</NavLink>{isOwner && <NavLink to="/staff"><span>05</span>Staff</NavLink>}</nav>
  </div>
}