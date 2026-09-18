import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from './AuthLayout'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute({ children, ownerOnly = false }: { children?: ReactNode; ownerOnly?: boolean }) {
  const location = useLocation()
  const { user, isLoading, isAuthenticated } = useAuth()

  if (isLoading) return <main className="route-loading"><Spinner /><span>Checking your session...</span></main>
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (ownerOnly && user?.role !== 'owner') return <Navigate to="/dashboard" replace />
  return <>{children ?? <Outlet />}</>
}