export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: 'owner' | 'staff';
  iat?: number;
}

// Deliberately unrelated in shape to AuthenticatedUser — no shared fields
// that could be confused for one another. See requirePlatformAdmin.ts.
export interface PlatformAdminUser {
  adminId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      platformAdmin?: PlatformAdminUser;
    }
  }
}
