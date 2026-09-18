import { useCallback, useEffect, useState } from 'react'
import api from '../lib/api'
import type { AuthResponse, User } from '../types/auth'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    api.get<AuthResponse>('/auth/me')
      .then(({ data }) => { if (active) setUser(data.user) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [])

  const login = useCallback(async (phone: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { phone, password })
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setUser(null)
  }, [])

  return { user, isLoading, isAuthenticated: Boolean(user), login, logout }
}