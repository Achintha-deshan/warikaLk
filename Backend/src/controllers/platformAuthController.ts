import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../config/db';
import { env } from '../config/env';

const PlatformLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200)
});

interface PlatformAdminRow {
  id: string;
  password_hash: string;
}

// Same timing-safe-against-nonexistent-username pattern as authController's
// login(): always run bcrypt.compare against something, even when no row
// matched, so response timing doesn't reveal whether the username exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('warikalk-platform-timing-safe-dummy', 12);

function issuePlatformSession(res: Response, adminId: string): void {
  const token = jwt.sign({ adminId, isPlatformAdmin: true }, env.PLATFORM_JWT_SECRET, { expiresIn: '8h' });
  res.cookie('platform_session_token', token, {
    httpOnly: true,
    // Same reasoning as authController.issueSession: frontend proxies API
    // requests through Vercel rewrites, so the cookie is first-party and
    // sameSite: 'strict' works — stronger than 'none'.
    secure: env.IS_PRODUCTION,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });
}

export async function platformLogin(req: Request, res: Response): Promise<void> {
  const parsed = PlatformLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { username, password } = parsed.data;

  try {
    const result = await pool.query<PlatformAdminRow>(
      'SELECT id, password_hash FROM platform_admins WHERE username = $1',
      [username]
    );
    const admin = result.rows[0];

    const passwordMatches = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!admin || !passwordMatches) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    issuePlatformSession(res, admin.id);
    res.status(200).json({ message: 'Logged in' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
}

export function platformLogout(_req: Request, res: Response): void {
  // Must match issuePlatformSession's cookie options exactly, or the browser
  // treats this as a different cookie and never actually clears the real one.
  res.clearCookie('platform_session_token', {
    httpOnly: true,
    secure: env.IS_PRODUCTION,
    sameSite: 'strict',
    path: '/'
  });
  res.status(200).json({ message: 'Logged out successfully' });
}
