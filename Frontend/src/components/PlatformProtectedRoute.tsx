import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import platformApi from '../lib/platformApi'
import { ApiError } from '../lib/api'
import { Spinner } from './AuthLayout'

export default function PlatformProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [checking, setChecking] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    platformApi.tenants({ page: 1, limit: 1 })
      .catch((value: ApiError) => {
        if (value.status === 401) setUnauthorized(true)
        else setError(value.message)
      })
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <main className="route-loading platform-loading"><Spinner /><span>Checking platform session...</span></main>
  if (unauthorized) return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />
  if (error) return <main className="route-loading"><p>{error}</p><a href="/platform/login">Return to platform login</a></main>
  return <>{children}</>
}