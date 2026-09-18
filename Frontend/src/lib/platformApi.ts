import api from './api'

// Platform endpoints use the platform_session_token cookie while sharing the API client configuration.
const platformApi = {
  login: (username: string, password: string) => api.post('/platform/auth/login', { username, password }),
  logout: () => api.post('/platform/auth/logout'),
  tenants: <T>(params: Record<string, string | number>) => api.get<T>('/platform/tenants', { params }),
  markPaid: (id: string, paid_date: string) => api.patch(`/platform/tenants/${id}/mark-paid`, { paid_date }),
}

export default platformApi