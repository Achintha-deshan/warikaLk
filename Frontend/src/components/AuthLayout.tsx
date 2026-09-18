import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function AuthLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <aside className="brand-panel">
        <Link className="wordmark" to="/">warika<span>lk</span></Link>
        <div className="brand-message">
          <p className="eyebrow">Fieldwork, made clear</p>
          <h2>Collect with confidence.</h2>
          <p>One calm workspace for every rupee, route, and relationship.</p>
        </div>
        <p className="brand-footer">© 2026 WarikaLk</p>
      </aside>
      <section className="auth-content">
        <div className="auth-form-wrap">
          <div className="mobile-wordmark"><Link className="wordmark" to="/">warika<span>lk</span></Link></div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="intro">{intro}</p>
          {children}
        </div>
      </section>
    </main>
  )
}

export function Spinner() { return <span className="spinner" aria-label="Loading" /> }

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && !error ? <small>{hint}</small> : null}{error ? <small className="field-error">{error}</small> : null}</label>
}

export function ApiNotice({ message }: { message?: string }) {
  return message ? <p className="api-notice" role="alert">{message}</p> : null
}

