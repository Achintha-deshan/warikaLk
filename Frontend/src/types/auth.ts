export type User = {
  id?: string
  userId: string
  tenantId: string
  role: 'owner' | 'staff'
  businessName?: string
  ownerName?: string
  phone: string
}

export type AuthResponse = { user: User }