import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { ApiError } from '../lib/api'
import { ApiNotice, AuthLayout, Field, Spinner } from '../components/AuthLayout'
import { getFieldError } from '../components/formUtils'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../hooks/useLanguageHook'

export default function LoginPage() {
  const navigate = useNavigate(); const { login } = useAuth(); const { t } = useLanguage()
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState(''); const [otpMode, setOtpMode] = useState(false); const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(false); const [notice, setNotice] = useState(''); const [errors, setErrors] = useState<Record<string, string[] | string>>({})
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setNotice(''); setErrors({}); try { if (otpMode) { if (!otp) { setErrors({ otp: 'Enter the 6-digit code.' }); return } const { data } = await api.post<{ user: unknown }>('/auth/login-otp', { phone, otp }); void data; navigate('/daily-report', { replace: true }) } else { await login(phone, password); navigate('/daily-report', { replace: true }) } } catch (error) { const apiError = error as ApiError; setErrors(apiError.fieldErrors ?? {}); setNotice(apiError.status === 429 ? 'Too many attempts. Please wait and try again.' : apiError.message) } finally { setLoading(false) } }
  const sendOtp = async () => { setLoading(true); setNotice(''); try { await api.post('/auth/send-otp', { phone, purpose: 'login' }); setOtpSent(true) } catch (error) { const apiError = error as ApiError; setNotice(apiError.status === 429 ? 'Too many attempts. Please wait before requesting another code.' : apiError.message) } finally { setLoading(false) } }
  return <AuthLayout eyebrow={t('auth.welcome')} title={t('auth.loginTitle')} intro={t('auth.loginIntro')}>
    <form className="auth-form" onSubmit={submit} noValidate><Field label={t('auth.mobile')} error={getFieldError(errors, 'phone')}><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></Field>{otpMode ? <><Field label={t('auth.code')} error={getFieldError(errors, 'otp')}><input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Field>{!otpSent && <button type="button" className="secondary-button" disabled={loading} onClick={sendOtp}>{loading ? <Spinner /> : t('auth.sendCode')}</button>}</> : <Field label={t('auth.password')} error={getFieldError(errors, 'password')}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>}<ApiNotice message={notice} /><button className="primary-button" disabled={loading || (otpMode && !otpSent)} type="submit">{loading ? <Spinner /> : otpMode ? t('auth.loginWithCode') : t('auth.login')}<span aria-hidden="true">↗</span></button></form>
    <div className="auth-links"><Link to="/forgot-password">{t('auth.forgot')}</Link><button type="button" className="text-button" onClick={() => { setOtpMode((value) => !value); setOtpSent(false); setNotice('') }}>{otpMode ? t('auth.usePassword') : t('auth.codeLogin')}</button></div><p className="auth-switch">{t('auth.newTo')} <Link to="/signup">{t('auth.createAccount')}</Link></p>
  </AuthLayout>
}