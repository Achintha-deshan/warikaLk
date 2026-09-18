import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { ApiError } from '../lib/api'
import { ApiNotice, AuthLayout, Field, Spinner } from '../components/AuthLayout'
import { getFieldError } from '../components/formUtils'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const navigate = useNavigate(); const { login } = useAuth()
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState(''); const [otpMode, setOtpMode] = useState(false); const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(false); const [notice, setNotice] = useState(''); const [errors, setErrors] = useState<Record<string, string[] | string>>({})
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setNotice(''); setErrors({}); try { if (otpMode) { if (!otp) { setErrors({ otp: 'Enter the 6-digit code.' }); return } const { data } = await api.post<{ user: unknown }>('/auth/login-otp', { phone, otp }); void data; navigate('/dashboard', { replace: true }) } else { await login(phone, password); navigate('/dashboard', { replace: true }) } } catch (error) { const apiError = error as ApiError; setErrors(apiError.fieldErrors ?? {}); setNotice(apiError.status === 429 ? 'Too many attempts. Please wait and try again.' : apiError.message) } finally { setLoading(false) } }
  const sendOtp = async () => { setLoading(true); setNotice(''); try { await api.post('/auth/send-otp', { phone, purpose: 'login' }); setOtpSent(true) } catch (error) { const apiError = error as ApiError; setNotice(apiError.status === 429 ? 'Too many attempts. Please wait before requesting another code.' : apiError.message) } finally { setLoading(false) } }
  return <AuthLayout eyebrow="Welcome back" title="Keep the day moving." intro="Sign in to see what needs collecting, when it matters.">
    <form className="auth-form" onSubmit={submit} noValidate><Field label="Mobile number" error={getFieldError(errors, 'phone')}><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></Field>{otpMode ? <><Field label="One-time code" error={getFieldError(errors, 'otp')} hint="A fresh code is required for each sign-in."><input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Field>{!otpSent && <button type="button" className="secondary-button" disabled={loading} onClick={sendOtp}>{loading ? <Spinner /> : 'Send code'}</button>}</> : <Field label="Password" error={getFieldError(errors, 'password')}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>}<ApiNotice message={notice} /><button className="primary-button" disabled={loading || (otpMode && !otpSent)} type="submit">{loading ? <Spinner /> : otpMode ? 'Sign in with code' : 'Log in'}<span aria-hidden="true">↗</span></button></form>
    <div className="auth-links"><Link to="/forgot-password">Forgot password?</Link><button type="button" className="text-button" onClick={() => { setOtpMode((value) => !value); setOtpSent(false); setNotice('') }}>{otpMode ? 'Use password instead' : 'Log in with a code'}</button></div><p className="auth-switch">New to WarikaLk? <Link to="/signup">Create an account</Link></p>
  </AuthLayout>
}