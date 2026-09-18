import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { ApiError } from '../lib/api'
import { ApiNotice, AuthLayout, Field, Spinner } from '../components/AuthLayout'
import { getFieldError } from '../components/formUtils'

const phonePattern = /^\+?[0-9\s-]{9,15}$/
const initialForm = { businessName: '', ownerName: '', password: '', confirmPassword: '', dailyCashEnabled: true, monthlyInterestEnabled: false, otp: '' }

export default function SignupPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [form, setForm] = useState(initialForm)
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState<Record<string, string[] | string>>({})

  const sendCode = async (event: FormEvent) => {
    event.preventDefault(); setNotice(''); setErrors({})
    if (!phonePattern.test(phone)) { setErrors({ phone: 'Enter a valid phone number.' }); return }
    setLoading(true)
    try { await api.post('/auth/send-otp', { phone, purpose: 'signup' }); setSent(true); setCooldown(30) }
    catch (error) { const apiError = error as ApiError; setNotice(apiError.status === 429 ? `Too many attempts. ${apiError.retryAfter ? `Wait ${apiError.retryAfter} seconds.` : 'Please try again later.'}` : apiError.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (!cooldown) return; const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer) }, [cooldown])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setNotice(''); setErrors({})
    if (form.password.length < 8 || form.password !== form.confirmPassword || !form.otp) {
      const validationErrors: Record<string, string> = {}
      if (form.password.length < 8) validationErrors.password = 'Use at least 8 characters.'
      if (form.password !== form.confirmPassword) validationErrors.confirmPassword = 'Passwords do not match.'
      if (!form.otp) validationErrors.otp = 'Enter the 6-digit code.'
      setErrors(validationErrors); return
    }
    setLoading(true)
    try { await api.post('/auth/signup', { ...form, phone }); navigate('/dashboard', { replace: true }) }
    catch (error) { const apiError = error as ApiError; setErrors(apiError.fieldErrors ?? {}); setNotice(apiError.status === 429 ? 'Too many attempts. Please wait and try again.' : apiError.message) }
    finally { setLoading(false) }
  }

  const changeNumber = () => { setSent(false); setForm(initialForm); setNotice(''); setErrors({}) }
  const update = (key: keyof typeof initialForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }))

  return <AuthLayout eyebrow="Start your workspace" title="Build a better collection day." intro="Set up your WarikaLk workspace in a few careful steps.">
    <form className="auth-form" onSubmit={sent ? submit : sendCode} noValidate>
      <Field label="Mobile number" error={getFieldError(errors, 'phone')} hint={sent ? 'Code sent. Change the number below if needed.' : 'Use the number you will use to sign in.'}>
        <div className="inline-field"><input value={phone} onChange={(event) => setPhone(event.target.value)} readOnly={sent} inputMode="tel" autoComplete="tel" placeholder="07X XXX XXXX" /><button type="button" className="text-button" onClick={changeNumber} hidden={!sent}>Change</button></div>
      </Field>
      {sent && <>
        <div className="form-grid"><Field label="Business name" error={getFieldError(errors, 'businessName')}><input value={form.businessName} onChange={(event) => update('businessName', event.target.value)} autoComplete="organization" /></Field><Field label="Owner name" error={getFieldError(errors, 'ownerName')}><input value={form.ownerName} onChange={(event) => update('ownerName', event.target.value)} autoComplete="name" /></Field></div>
        <div className="form-grid"><Field label="Password" error={getFieldError(errors, 'password')}><input type="password" value={form.password} onChange={(event) => update('password', event.target.value)} autoComplete="new-password" /></Field><Field label="Confirm password" error={getFieldError(errors, 'confirmPassword')}><input type="password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} autoComplete="new-password" /></Field></div>
        <div className="option-list"><label><input type="checkbox" checked={form.dailyCashEnabled} onChange={(event) => update('dailyCashEnabled', event.target.checked)} /> Daily cash collection</label><label><input type="checkbox" checked={form.monthlyInterestEnabled} onChange={(event) => update('monthlyInterestEnabled', event.target.checked)} /> Monthly interest tracking</label></div>
        <Field label="Verification code" error={getFieldError(errors, 'otp')} hint="Enter the code sent to your phone."><input value={form.otp} onChange={(event) => update('otp', event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /><button type="button" className="text-button" disabled={cooldown > 0 || loading} onClick={() => void sendCode({ preventDefault: () => undefined } as FormEvent)}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</button></Field>
      </>}
      <ApiNotice message={notice} />
      <button className="primary-button" disabled={loading} type="submit">{loading ? <Spinner /> : sent ? 'Create workspace' : 'Send code'}<span aria-hidden="true">↗</span></button>
    </form>
    <p className="auth-switch">Already have an account? <Link to="/login">Log in</Link></p>
  </AuthLayout>
}