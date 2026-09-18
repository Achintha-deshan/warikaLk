import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { ApiError } from '../lib/api'
import { ApiNotice, Spinner } from '../components/AuthLayout'
import { formatMoney } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import type { ReportSummary } from '../types/reports'

function monthRange() {
  const now = new Date()
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA'), to: new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-CA') }
}

function estimated(summary: ReportSummary) { return Boolean(summary.by_loan_type?.daily?.estimated_daily) || /estimated/i.test(summary.methodology_note) }

export default function DashboardPage() {
  const { user } = useAuth(); const [range, setRange] = useState(monthRange); const [summary, setSummary] = useState<ReportSummary | null>(null); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState('')
  const params = useMemo(() => new URLSearchParams({ from: range.from, to: range.to }).toString(), [range])
  useEffect(() => { api.get<ReportSummary>(`/reports/summary?${params}`).then(({ data }) => setSummary(data)).catch((error: ApiError) => setNotice(error.message)).finally(() => setLoading(false)) }, [params])
  const paymentLink = (period: 'daily' | 'monthly') => `/interest-payments?${params}&loan_type=${period}`
  const cards = summary ? [{ label: 'Daily profit', value: summary.daily_profit, to: paymentLink('daily'), estimated: estimated(summary) }, { label: 'Monthly profit', value: summary.monthly_profit, to: paymentLink('monthly'), estimated: false }, { label: 'Total collected', value: summary.total_collected, to: `/interest-payments?${params}`, estimated: false }, { label: 'Outstanding principal', value: summary.total_outstanding_principal, to: '/loans', estimated: false }] : []
  return <section className="page-frame dashboard-page"><div className="page-kicker"><span className="eyebrow">Overview / Reports</span><span className="status-dot">Live workspace</span></div><div className="page-heading"><div><h1>Good to see you,<br /><em>{user?.ownerName || user?.businessName || 'there'}.</em></h1><p className="page-intro">A clear read on collections, profit, and the loans that need attention.</p></div><div className="range-picker"><label>From<input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label><label>To<input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label></div></div><ApiNotice message={notice} />{loading ? <div className="state-block"><Spinner /><p>Loading report...</p></div> : summary && <><div className="report-cards">{cards.map((card) => <Link className="report-card" to={card.to} key={card.label}><span className="eyebrow">{card.label}</span><strong>{formatMoney(card.value)}</strong>{card.estimated && <small title={summary.methodology_note}>Estimated daily-loan interest</small>}<span className="card-arrow">↗</span></Link>)}</div><div className="methodology-note"><span className="eyebrow">How to read this</span><p>{summary.methodology_note}</p></div><div className="status-grid"><div><span className="eyebrow">Active loans</span><strong>{summary.active_loans_count}</strong></div><div><span className="eyebrow">Closed loans</span><strong>{summary.closed_loans_count}</strong></div><div><span className="eyebrow">Defaulted loans</span><strong>{summary.defaulted_loans_count}</strong></div><Link to="/loans" className="status-grid-link"><span className="eyebrow">Overdue</span><strong>{summary.overdue_count}</strong><small>View loans ↗</small></Link></div><div className="owner-report-links">{user?.role === 'owner' && <><Link to={`/capital-loss?${params}`}><span className="eyebrow">Owner report</span><strong>Capital Loss ↗</strong></Link><Link to={`/agent-performance?${params}`}><span className="eyebrow">Owner report</span><strong>Agent Performance ↗</strong></Link></>}</div></>}</section>
}
