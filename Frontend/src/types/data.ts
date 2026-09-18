export type Customer = {
  id: string
  tenant_id: string
  name: string
  phone?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  display_code: string
  created_at: string
}

export type StaffMember = {
  id: string
  name: string
  phone: string
  role: 'owner' | 'staff'
  is_active: boolean
  created_at: string
}

export type Pagination = { page: number; limit: number; total: number }