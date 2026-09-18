import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import platformApi from '../lib/platformApi'
import { ApiError } from '../lib/api'
import { ApiNotice, Field, Spinner } from '../components/AuthLayout'

export default function PlatformLoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setNotice('')
    try { await platformApi.login(username, password); navigate('/platform/dashboard', { replace: true }) }
    catch (error) { setNotice((error as ApiError).status === 401 ? 'Invalid platform credentials.' : (error as ApiError).message) }
    finally { setLoading(false) }
  }

  return <main className="platform-login"><div className="platform-login-panel"><div className="platform-mark"><span className="eyebrow">Platform Admin</span><strong>warika<span>lk</span></strong></div><p className="eyebrow">Separate workspace</p><h1>Run the whole network.</h1><p className="intro">Sign in to review every tenant and keep subscription records current.</p><form className="auth-form" onSubmit={submit} noValidate><Field label="Username"><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></Field><Field label="Password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field><ApiNotice message={notice} /><button className="primary-button" disabled={loading || !username || !password} type="submit">{loading ? <Spinner /> : 'Enter platform'}<span aria-hidden="true">↗</span></button></form></div></main>
}