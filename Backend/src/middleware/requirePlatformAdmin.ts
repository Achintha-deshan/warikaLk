import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { PlatformAdminUser } from '../types/express';

interface PlatformAdminPayload {
  adminId: string;
  isPlatformAdmin: true;
}

function isPlatformAdminPayload(payload: string | jwt.JwtPayload): payload is PlatformAdminPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return typeof candidate.adminId === 'string' && candidate.isPlatformAdmin === true;
}

// Completely separate from requireAuth: different cookie name
// (platform_session_token, never session_token), different signing secret
// (env.PLATFORM_JWT_SECRET, never env.JWT_SECRET), and a payload shape that
// shares no fields with AuthenticatedUser. A tenant session_token can never
// pass this check, even hypothetically — the cookie it's carried in isn't
// read here at all, and even if it were, verification would fail against
// the wrong secret before the payload shape is ever inspected.
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string | undefined> | undefined)?.platform_session_token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.PLATFORM_JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  if (!isPlatformAdminPayload(decoded)) {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }

  const platformAdmin: PlatformAdminUser = { adminId: decoded.adminId };
  req.platformAdmin = platformAdmin;
  next();
}
