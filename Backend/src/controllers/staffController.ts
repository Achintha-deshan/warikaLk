import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../config/db';
import { PHONE_REGEX } from '../utils/validators';
import { isUniqueViolation } from '../utils/dbErrors';

interface StaffRow {
  id: string;
  name: string;
  phone: string;
  role: 'owner' | 'staff';
  is_active: boolean;
  created_at: Date;
}

const CreateStaffSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().regex(PHONE_REGEX),
  password: z.string().min(8).max(72)
});

const StaffIdSchema = z.string().uuid();

const STAFF_COLUMNS = 'id, name, phone, role, is_active, created_at';

export async function createStaff(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = CreateStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, phone, password } = parsed.data;

  // tenantId comes from the owner's own verified JWT — never from the
  // request body. role is a hardcoded literal in the SQL below, never a
  // bound parameter, so nothing in the request can turn this into an
  // 'owner' insert.
  const tenantId = req.user.tenantId;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query<StaffRow>(
      `INSERT INTO users (tenant_id, name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'staff')
       RETURNING ${STAFF_COLUMNS}`,
      [tenantId, name, phone, passwordHash]
    );
    res.status(201).json({ staff: result.rows[0] });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Phone number already registered' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
}

export async function listStaff(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const tenantId = req.user.tenantId;

  try {
    // Plain SELECT with ORDER BY only — adding LIMIT/OFFSET (and, if needed,
    // the count(*) OVER() total-count pattern used in customerController)
    // later is additive, not a rewrite.
    const result = await pool.query<StaffRow>(
      `SELECT ${STAFF_COLUMNS}
         FROM users
        WHERE tenant_id = $1 AND role = 'staff'
        ORDER BY created_at DESC`,
      [tenantId]
    );
    res.status(200).json({ staff: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
}

export async function deactivateStaff(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedId = StaffIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid staff id' });
    return;
  }

  const tenantId = req.user.tenantId;

  try {
    // role = 'staff' in the WHERE clause is what enforces "an owner cannot
    // deactivate themselves or another owner" — there is no separate
    // self-check because there's nothing to special-case: any row with
    // role = 'owner' simply never matches, including the acting owner's own.
    //
    // password_changed_at = now() is touched here (and only here, not in
    // reactivateStaff) so that any token issued before this moment is
    // permanently dead, even after a later reactivation — see
    // reactivateStaff's comment for why reactivation must not also touch it.
    const result = await pool.query(
      `UPDATE users
          SET is_active = false, password_changed_at = now()
        WHERE id = $1 AND tenant_id = $2 AND role = 'staff'
        RETURNING id`,
      [parsedId.data, tenantId]
    );

    if (result.rowCount !== 1) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    res.status(200).json({ message: 'Staff member deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to deactivate staff member' });
  }
}

export async function reactivateStaff(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedId = StaffIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid staff id' });
    return;
  }

  const tenantId = req.user.tenantId;

  try {
    // Deliberately does NOT touch password_changed_at. If it did, this
    // reactivation's DB-clock now() would be compared (in requireAuth)
    // against the staff member's very next login's app-clock iat, with only
    // whole-second precision — a small but real clock-skew race that could
    // reject a legitimate, brand-new session issued moments after
    // reactivation. Leaving password_changed_at untouched means it still
    // holds the deactivation timestamp: old, pre-deactivation tokens stay
    // permanently dead (their iat is always before that fixed point), while
    // a fresh post-reactivation login's iat is always safely after it —
    // the same risk profile the existing password-reset flow already has,
    // not a tighter new one.
    const result = await pool.query(
      `UPDATE users
          SET is_active = true
        WHERE id = $1 AND tenant_id = $2 AND role = 'staff'
        RETURNING id`,
      [parsedId.data, tenantId]
    );

    if (result.rowCount !== 1) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    res.status(200).json({ message: 'Staff member reactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reactivate staff member' });
  }
}
