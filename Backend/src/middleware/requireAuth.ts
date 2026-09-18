import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../config/db';
import { isSubscriptionActive } from '../utils/subscription';
import type { AuthenticatedUser } from '../types/express';

function isAuthenticatedUser(payload: string | jwt.JwtPayload): payload is AuthenticatedUser {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.tenantId === 'string' &&
    (candidate.role === 'owner' || candidate.role === 'staff')
  );
}

type SessionTokenResult =
  | { ok: true; user: AuthenticatedUser & { iat: number } }
  | { ok: false; reason: 'missing' | 'invalid' };

// JWT verification only — no DB access — shared by requireAuth and
// requireAuthAndSubscription below so the token-parsing logic exists once.
function verifySessionToken(req: Request): SessionTokenResult {
  const token = (req.cookies as Record<string, string | undefined> | undefined)?.session_token;
  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (!isAuthenticatedUser(decoded) || typeof decoded.iat !== 'number') {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, user: { ...decoded, iat: decoded.iat } };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionResult = verifySessionToken(req);
  if (!sessionResult.ok) {
    const message = sessionResult.reason === 'missing' ? 'Authentication required' : 'Session expired, please log in again';
    res.status(401).json({ error: message });
    return;
  }
  const decoded = sessionResult.user;

  // Two independent checks against current DB state, both using the same
  // single read:
  //   1. is_active — a direct, real-time gate. A deactivated user is
  //      rejected on their very next request regardless of their token's
  //      iat, with no timestamp/clock-skew reasoning involved at all.
  //   2. password_changed_at vs iat — rejects tokens issued before the
  //      user's last password reset OR staff deactivation (deactivateStaff
  //      touches this column too; reactivateStaff deliberately does not —
  //      see its comments for why that matters for correctness).
  try {
    const result = await pool.query<{ password_changed_at: Date | null; is_active: boolean }>(
      'SELECT password_changed_at, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    const userRow = result.rows[0];
    if (!userRow || !userRow.is_active) {
      res.status(401).json({ error: 'Session expired, please log in again' });
      return;
    }
    if (userRow.password_changed_at && Math.floor(userRow.password_changed_at.getTime() / 1000) > decoded.iat) {
      res.status(401).json({ error: 'Session expired, please log in again' });
      return;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Authentication check failed' });
    return;
  }

  req.user = decoded;
  next();
}

// Combines requireAuth's checks (is_active, password_changed_at vs iat) with
// requireActiveSubscription's (trial_ends_at/paid_until) into ONE query
// instead of two separate middleware each doing their own round trip to
// Neon. This was originally two clean, independent middlewares chained
// together on tenant-scoped routes — architecturally simpler, but measured
// wall-clock cost showed the network round-trip time to Neon (not query
// execution time — both individual queries run in well under 1ms server-
// side) dominates: two sequential round trips averaged ~189ms, one combined
// query averaged ~110ms, roughly halving the DB-latency tax paid on every
// tenant-scoped request. GET /api/auth/me and other auth routes intentionally
// keep using the plain requireAuth above (unaffected by this), since /me
// must always work regardless of subscription status — this combined
// version is only for routes that need BOTH checks together.
export async function requireAuthAndSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionResult = verifySessionToken(req);
  if (!sessionResult.ok) {
    const message = sessionResult.reason === 'missing' ? 'Authentication required' : 'Session expired, please log in again';
    res.status(401).json({ error: message });
    return;
  }
  const decoded = sessionResult.user;

  try {
    const result = await pool.query<{
      password_changed_at: Date | null;
      is_active: boolean;
      trial_ends_at: Date | null;
      paid_until: Date | null;
    }>(
      `SELECT u.password_changed_at, u.is_active, t.trial_ends_at, t.paid_until
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1`,
      [decoded.userId]
    );
    const row = result.rows[0];
    if (!row || !row.is_active) {
      res.status(401).json({ error: 'Session expired, please log in again' });
      return;
    }
    if (row.password_changed_at && Math.floor(row.password_changed_at.getTime() / 1000) > decoded.iat) {
      res.status(401).json({ error: 'Session expired, please log in again' });
      return;
    }

    if (!isSubscriptionActive(new Date(), row.trial_ends_at, row.paid_until)) {
      res.status(402).json({
        error: 'Subscription expired',
        trial_ends_at: row.trial_ends_at,
        paid_until: row.paid_until
      });
      return;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Authentication check failed' });
    return;
  }

  req.user = decoded;
  next();
}

export function requireRole(...roles: Array<AuthenticatedUser['role']>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
