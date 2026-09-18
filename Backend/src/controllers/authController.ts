import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { env } from '../config/env';
import { sendSmsViaFitSms } from '../services/smsService';
import { PHONE_REGEX } from '../utils/validators';
import { isUniqueViolation } from '../utils/dbErrors';
import { computeTenantStatus, isSubscriptionActive } from '../utils/subscription';

const OTP_MAX_ATTEMPTS = 5;

type OtpPurpose = 'signup' | 'login' | 'password_reset';

const SignupSchema = z.object({
  businessName: z.string().min(2).max(100),
  ownerName: z.string().min(2).max(100),
  phone: z.string().min(9).max(15),
  password: z.string().min(8).max(72),
  dailyCashEnabled: z.boolean(),
  monthlyInterestEnabled: z.boolean(),
  otp: z.string().regex(/^[0-9]{6}$/)
});

const LoginSchema = z.object({
  phone: z.string().min(9).max(15),
  password: z.string().min(1).max(72)
});

const SendOtpSchema = z.object({
  phone: z.string().regex(PHONE_REGEX),
  purpose: z.enum(['signup', 'login'])
});

const LoginOtpSchema = z.object({
  phone: z.string().regex(PHONE_REGEX),
  otp: z.string().regex(/^[0-9]{6}$/)
});

const ForgotPasswordCheckSchema = z.object({
  phone: z.string().regex(PHONE_REGEX)
});

const ForgotPasswordSendOtpSchema = z.object({
  phone: z.string().regex(PHONE_REGEX)
});

const ForgotPasswordVerifyOtpSchema = z.object({
  phone: z.string().regex(PHONE_REGEX),
  otp: z.string().regex(/^[0-9]{6}$/)
});

const ForgotPasswordResetSchema = z
  .object({
    phone: z.string().regex(PHONE_REGEX),
    resetToken: z.string().min(32),
    newPassword: z.string().min(8).max(72),
    confirmPassword: z.string().min(8).max(72)
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  });

interface UserRow {
  id: string;
  tenant_id: string;
  name: string;
  password_hash: string;
  role: 'owner' | 'staff';
}

interface OtpRow {
  id: string;
  otp_hash: string;
  attempts: number;
  expires_at: Date;
}

interface PasswordResetTokenRow {
  id: string;
  token_hash: string;
}

// Computed once at module load so bcrypt.compare always has real work to do,
// even when the phone doesn't exist — keeps failure-mode timing constant.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('warikalk-timing-safe-dummy', 12);

// One SMS body per purpose. password_reset gets an explicit "if you didn't
// request this" line since, unlike signup/login codes, it gates changing an
// existing credential rather than creating a fresh session.
const OTP_MESSAGES: Record<OtpPurpose, (otp: string) => string> = {
  signup: (otp) => `WarikaLk verification code: ${otp}. Valid for 5 minutes.`,
  login: (otp) => `WarikaLk verification code: ${otp}. Valid for 5 minutes.`,
  password_reset: (otp) =>
    `WarikaLk password reset code: ${otp}. Valid for 5 minutes. If you didn't request this, ignore this message.`
};

function hashOtp(phone: string, purpose: string, otp: string): string {
  return crypto.createHash('sha256').update(`${phone}:${purpose}:${otp}`).digest('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// FitSMS expects "94771234567" — country code, no leading + or 0.
function toFitSmsRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('94')) return digits;
  if (digits.startsWith('0')) return `94${digits.slice(1)}`;
  return `94${digits}`;
}

// Reveals first+last character of a name segment, masking the middle.
// Segments of length <= 2 are masked entirely — revealing "both ends" of a
// 2-letter word shows 100% of it, which defeats the point of masking.
function maskNameSegment(segment: string): string {
  if (segment.length <= 2) {
    return '*'.repeat(segment.length);
  }
  return segment[0] + '*'.repeat(segment.length - 2) + segment[segment.length - 1];
}

function maskFullName(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((segment) => segment.length > 0)
    .map(maskNameSegment)
    .join(' ');
}

function issueSession(res: Response, payload: { userId: string; tenantId: string; role: 'owner' | 'staff' }): void {
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('session_token', token, {
    httpOnly: true,
    // sameSite: 'none' is required for a cross-origin frontend/backend
    // deployment (e.g. frontend on Vercel, API on Railway) — browsers only
    // send a SameSite=None cookie at all if it's ALSO Secure, unconditionally,
    // regardless of environment. secure: env.IS_PRODUCTION would have made
    // this false outside production, which combined with sameSite: 'none'
    // means modern browsers reject the cookie outright rather than just
    // being lenient about it — not a degraded-but-working state, a
    // completely broken one.
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });
}

type OtpCheckResult = { ok: true; otpId: string } | { ok: false };

// Locks the latest unverified OTP row for (phone, purpose) for the lifetime of
// the caller's transaction, validates it, and either marks it verified or bumps
// its attempt counter. The FOR UPDATE lock is what makes "verified" exactly-once:
// a second concurrent request for the same phone+purpose blocks here until the
// first request's transaction commits or rolls back.
async function verifyAndConsumeOtp(
  client: PoolClient,
  phone: string,
  purpose: OtpPurpose,
  otp: string
): Promise<OtpCheckResult> {
  const result = await client.query<OtpRow>(
    `SELECT id, otp_hash, attempts, expires_at
       FROM otp_verifications
      WHERE phone = $1 AND purpose = $2 AND verified = false
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [phone, purpose]
  );
  const row = result.rows[0];
  if (!row) {
    return { ok: false };
  }
  if (row.expires_at.getTime() < Date.now()) {
    return { ok: false };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false };
  }

  const candidateHash = hashOtp(phone, purpose, otp);
  if (candidateHash !== row.otp_hash) {
    await client.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return { ok: false };
  }

  await client.query('UPDATE otp_verifications SET verified = true WHERE id = $1', [row.id]);
  return { ok: true, otpId: row.id };
}

// Shared core of sendOtp / sendPasswordResetOtp: per-phone rate check (via
// advisory lock, same race-safety story as before), account-existence lookup,
// invalidate-old-rows, generate+store a fresh OTP, and fire-and-forget the SMS
// only when the purpose/account-state combination is legitimate. Callers only
// differ in which purposes they allow and what request shape they accept.
async function issueOtpIfEligible(phone: string, purpose: OtpPurpose): Promise<{ rateLimited: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serializes concurrent send-otp calls for the SAME phone so the rate-limit
    // count-then-insert below can't race. Different phones use different lock
    // keys and never block each other (hashtext() collisions are theoretically
    // possible but only cost an unrelated phone a brief serialization delay,
    // never incorrect behavior).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [phone]);

    const rateResult = await client.query<{ last_minute: string; last_hour: string }>(
      `SELECT
         count(*) FILTER (WHERE created_at > now() - interval '60 seconds') AS last_minute,
         count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS last_hour
       FROM otp_verifications
       WHERE phone = $1`,
      [phone]
    );
    const { last_minute, last_hour } = rateResult.rows[0];
    if (Number(last_minute) >= 1 || Number(last_hour) >= 5) {
      await client.query('COMMIT');
      return { rateLimited: true };
    }

    // is_active = true matters here now that a phone can belong to multiple
    // historical rows (see migration 006) — "has an account" must mean "has
    // a currently active account", not "this phone has ever been used".
    const userResult = await client.query('SELECT id FROM users WHERE phone = $1 AND is_active = true', [phone]);
    const hasAccount = userResult.rows.length > 0;
    const shouldSend = purpose === 'signup' ? !hasAccount : hasAccount;

    await client.query(
      'DELETE FROM otp_verifications WHERE phone = $1 AND purpose = $2 AND verified = false',
      [phone, purpose]
    );

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashOtp(phone, purpose, otp);
    await client.query(
      `INSERT INTO otp_verifications (phone, otp_hash, purpose, expires_at)
       VALUES ($1, $2, $3, now() + interval '5 minutes')`,
      [phone, otpHash, purpose]
    );

    await client.query('COMMIT');

    // Not awaited: the SMS network call must never affect response timing (see
    // review notes) or block the request. Failures are logged, not surfaced —
    // the client already got a generic "sent" response either way.
    if (shouldSend) {
      sendSmsViaFitSms(toFitSmsRecipient(phone), OTP_MESSAGES[purpose](otp)).catch((err) => {
        console.error('Failed to send OTP SMS:', err);
      });
    }

    return { rateLimited: false };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
}

export async function sendOtp(req: Request, res: Response): Promise<void> {
  const parsed = SendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { phone, purpose } = parsed.data;

  try {
    const { rateLimited } = await issueOtpIfEligible(phone, purpose);
    if (rateLimited) {
      res.status(429).json({ error: 'Too many code requests. Please try again later.' });
      return;
    }
    res.status(200).json({ message: 'If this number is eligible, a verification code has been sent.' });
  } catch {
    res.status(500).json({ error: 'Failed to process request' });
  }
}

export async function signup(req: Request, res: Response): Promise<void> {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { businessName, ownerName, phone, password, dailyCashEnabled, monthlyInterestEnabled, otp } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const otpResult = await verifyAndConsumeOtp(client, phone, 'signup', otp);
    if (!otpResult.ok) {
      await client.query('COMMIT');
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

    // Phone eka already register wela nathida check karanna. is_active filter
    // means a phone freed up by staff deactivation (migration 006) is
    // signup-able again — the DB's partial unique index already allows this,
    // so this pre-check must agree with it or it'd reject phones the DB
    // would actually accept.
    const existing = await client.query('SELECT id FROM users WHERE phone = $1 AND is_active = true', [phone]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Phone number already registered' });
      return;
    }

    // Tenant (business) eka create karanna — 15-day trial starts now.
    const tenantResult = await client.query(
      `INSERT INTO tenants (business_name, daily_cash_enabled, monthly_interest_enabled, trial_ends_at)
       VALUES ($1, $2, $3, now() + interval '15 days') RETURNING id`,
      [businessName, dailyCashEnabled, monthlyInterestEnabled]
    );
    const tenantId = tenantResult.rows[0].id;

    // Password hash karanna
    const passwordHash = await bcrypt.hash(password, 12);

    // Owner user eka create karanna
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING id, name, role`,
      [tenantId, ownerName, phone, passwordHash]
    );
    const user = userResult.rows[0];

    await client.query('COMMIT');

    issueSession(res, { userId: user.id, tenantId, role: user.role });

    res.status(201).json({
      message: 'Account created successfully',
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Phone number already registered' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  } finally {
    client.release();
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { phone, password } = parsed.data;

  try {
    // is_active = true: a deactivated staff account must fail login exactly
    // like a nonexistent phone would (same 401, same message) — see
    // requireAuth for the matching check against already-issued tokens. Also
    // avoids matching a stale deactivated row that happens to share a phone
    // with the current active user (migration 006).
    const result = await pool.query<UserRow>(
      'SELECT id, tenant_id, name, password_hash, role FROM users WHERE phone = $1 AND is_active = true',
      [phone]
    );
    const user = result.rows[0];

    // Always run bcrypt.compare, even when no row was found, against a fixed
    // dummy hash so response timing doesn't reveal whether the phone exists.
    const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

    if (!user || !passwordMatches) {
      res.status(401).json({ error: 'Invalid phone or password' });
      return;
    }

    issueSession(res, { userId: user.id, tenantId: user.tenant_id, role: user.role });

    res.status(200).json({
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
}

export async function loginOtp(req: Request, res: Response): Promise<void> {
  const parsed = LoginOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { phone, otp } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const otpResult = await verifyAndConsumeOtp(client, phone, 'login', otp);
    if (!otpResult.ok) {
      await client.query('COMMIT');
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

    // is_active = true — same reasoning as login(): a deactivated account
    // must not be reachable via login-otp either.
    const userResult = await client.query<UserRow>(
      'SELECT id, tenant_id, name, role FROM users WHERE phone = $1 AND is_active = true',
      [phone]
    );
    const user = userResult.rows[0];
    if (!user) {
      await client.query('COMMIT');
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

    await client.query('COMMIT');

    issueSession(res, { userId: user.id, tenantId: user.tenant_id, role: user.role });

    res.status(200).json({
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  } finally {
    client.release();
  }
}

export function logout(_req: Request, res: Response): void {
  // Must match issueSession's cookie options exactly (secure, sameSite,
  // path) — clearCookie works by setting an already-expired cookie with the
  // same attributes; a mismatch means the browser treats it as a different
  // cookie and the original one never actually gets cleared.
  res.clearCookie('session_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/'
  });
  res.status(200).json({ message: 'Logged out successfully' });
}

// Reports subscription status alongside the user so the frontend can show
// an expired-subscription banner immediately after login, without needing
// a failed request against some other tenant-scoped endpoint first. /me
// itself is never gated by requireActiveSubscription (per design, a locked-
// out owner still needs to see why) — this only reports the status, it
// never blocks the response.
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const result = await pool.query<{ trial_ends_at: Date | null; paid_until: Date | null }>(
      'SELECT trial_ends_at, paid_until FROM tenants WHERE id = $1',
      [req.user.tenantId]
    );
    const tenant = result.rows[0];
    const trialEndsAt = tenant?.trial_ends_at ?? null;
    const paidUntil = tenant?.paid_until ?? null;
    const now = new Date();

    res.status(200).json({
      user: req.user,
      subscription: {
        status: computeTenantStatus(now, trialEndsAt, paidUntil),
        is_active: isSubscriptionActive(now, trialEndsAt, paidUntil),
        trial_ends_at: trialEndsAt,
        paid_until: paidUntil
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch account info' });
  }
}

// --- Forgot password ---------------------------------------------------

export async function forgotPasswordCheck(req: Request, res: Response): Promise<void> {
  const parsed = ForgotPasswordCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { phone } = parsed.data;

  // Deliberately not timing/response-shape-uniform: this step's whole design
  // (per the confirmed UX decision) already reveals account existence via the
  // masked name, so there's nothing further to protect here — the rate
  // limiters carry the load of compensating for that.
  try {
    // is_active = true — a deactivated account's phone is treated as
    // "no account", consistent with every other lookup in this file now that
    // a phone can be reused after deactivation (migration 006).
    const result = await pool.query<{ name: string }>(
      'SELECT name FROM users WHERE phone = $1 AND is_active = true',
      [phone]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(200).json({ exists: false });
      return;
    }
    res.status(200).json({ exists: true, maskedName: maskFullName(user.name) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process request' });
  }
}

export async function sendPasswordResetOtp(req: Request, res: Response): Promise<void> {
  const parsed = ForgotPasswordSendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { phone } = parsed.data;

  try {
    const { rateLimited } = await issueOtpIfEligible(phone, 'password_reset');
    if (rateLimited) {
      res.status(429).json({ error: 'Too many code requests. Please try again later.' });
      return;
    }
    res.status(200).json({ message: 'If this number is eligible, a verification code has been sent.' });
  } catch {
    res.status(500).json({ error: 'Failed to process request' });
  }
}

export async function forgotPasswordVerifyOtp(req: Request, res: Response): Promise<void> {
  const parsed = ForgotPasswordVerifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { phone, otp } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const otpResult = await verifyAndConsumeOtp(client, phone, 'password_reset', otp);
    if (!otpResult.ok) {
      await client.query('COMMIT');
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

    // High-entropy opaque token, not the OTP itself — see migration 003 notes.
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);

    await client.query(
      `INSERT INTO password_reset_tokens (phone, token_hash, otp_verification_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '10 minutes')`,
      [phone, tokenHash, otpResult.otpId]
    );

    await client.query('COMMIT');

    res.status(200).json({ resetToken: rawToken });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to process request' });
  } finally {
    client.release();
  }
}

export async function forgotPasswordReset(req: Request, res: Response): Promise<void> {
  const parsed = ForgotPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { phone, resetToken, newPassword } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenResult = await client.query<PasswordResetTokenRow>(
      `SELECT id, token_hash
         FROM password_reset_tokens
        WHERE phone = $1 AND used = false AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [phone]
    );
    const tokenRow = tokenResult.rows[0];
    const candidateHash = hashToken(resetToken);

    if (!tokenRow || candidateHash !== tokenRow.token_hash) {
      await client.query('COMMIT');
      res.status(400).json({ error: 'Invalid or expired reset request' });
      return;
    }

    await client.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [tokenRow.id]);

    // is_active = true matters here for more than consistency: since a phone
    // can now belong to multiple historical (deactivated) rows plus at most
    // one active row (migration 006), an unfiltered WHERE phone = $2 could
    // match several rows at once and this whole flow's rowCount === 1 safety
    // check would then reject a legitimate reset outright.
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updateResult = await client.query(
      'UPDATE users SET password_hash = $1, password_changed_at = now() WHERE phone = $2 AND is_active = true',
      [passwordHash, phone]
    );

    if (updateResult.rowCount !== 1) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid or expired reset request' });
      return;
    }

    await client.query('COMMIT');

    res.status(200).json({ message: 'Password reset successful. Please log in again.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Password reset failed' });
  } finally {
    client.release();
  }
}
