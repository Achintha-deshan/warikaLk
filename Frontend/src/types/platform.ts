export type PlatformTenant = {
  id: string
  business_name: string
  owner_name: string
  owner_phone: string
  status: 'trial' | 'active' | 'expired'
  trial_ends_at: string | null
  paid_until: string | null
  created_at: string
}

export type PlatformPagination = { page: number; limit: number; total: number; total_pages?: number; pages?: number }
export type PlatformTenantsResponse = { tenants: PlatformTenant[]; pagination: PlatformPagination }