import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { computeTenantStatus } from '../utils/subscription';

const ListTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

// The one place in this codebase deliberately NOT tenant-scoped — this IS
// the platform-level, cross-tenant view, gated entirely by
// requirePlatformAdmin rather than requireAuth/tenantId.
export async function listAllTenants(req: Request, res: Response): Promise<void> {
  const parsed = ListTenantsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;

  try {
    // Correlated subqueries (not a JOIN) for the owner's name/phone —
    // nothing currently stops a tenant from having more than one 'owner'
    // row, and a plain JOIN would fan out into duplicate tenant rows (and a
    // wrong total_count) if that ever happens. This deterministically picks
    // the earliest-created owner regardless.
    const result = await pool.query<{
      id: string;
      business_name: string;
      created_at: Date;
      trial_ends_at: Date | null;
      paid_until: Date | null;
      owner_name: string | null;
      owner_phone: string | null;
      total_count: string;
    }>(
      `SELECT t.id, t.business_name, t.created_at, t.trial_ends_at, t.paid_until,
              (SELECT name FROM users WHERE tenant_id = t.id AND role = 'owner' ORDER BY created_at ASC LIMIT 1) AS owner_name,
              (SELECT phone FROM users WHERE tenant_id = t.id AND role = 'owner' ORDER BY created_at ASC LIMIT 1) AS owner_phone,
              count(*) OVER() AS total_count
         FROM tenants t
        ORDER BY t.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const now = new Date();
    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const tenants = result.rows.map(({ total_count, ...row }) => ({
      ...row,
      status: computeTenantStatus(now, row.trial_ends_at, row.paid_until)
    }));

    res.status(200).json({ tenants, pagination: { page, limit, total } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
}

const TenantIdSchema = z.string().uuid();

const MarkPaidSchema = z.object({
  paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export async function markTenantPaid(req: Request, res: Response): Promise<void> {
  if (!req.platformAdmin) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedId = TenantIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid tenant id' });
    return;
  }

  const parsed = MarkPaidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const paidDate = new Date(`${parsed.data.paid_date}T00:00:00.000Z`);
  const now = new Date();

  // A few days of tolerance for marking "today" — the platform admin and
  // the tenant may not be in the same timezone, so a strict > now() check
  // could reject a legitimately-intended "today" depending on which side
  // of midnight either party is on.
  const FUTURE_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000;
  if (paidDate.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    res.status(400).json({ error: 'paid_date cannot be more than 7 days in the future' });
    return;
  }

  try {
    const tenantResult = await pool.query<{ created_at: Date }>('SELECT created_at FROM tenants WHERE id = $1', [
      parsedId.data
    ]);
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    // Compare calendar dates, not exact instants — tenants.created_at has a
    // real time-of-day, so a naive instant comparison would reject "paid
    // the same calendar day the tenant was created" if that day's creation
    // time happened to be later than midnight (which it always is).
    const createdAtMidnight = new Date(
      Date.UTC(tenant.created_at.getUTCFullYear(), tenant.created_at.getUTCMonth(), tenant.created_at.getUTCDate())
    );
    if (paidDate.getTime() < createdAtMidnight.getTime()) {
      res.status(400).json({ error: 'paid_date cannot be before the tenant was created' });
      return;
    }

    // Must return the SAME shape as listAllTenants's per-tenant object
    // (status computed, owner_name/owner_phone included) — the frontend
    // replaces the row in its table with this response directly rather
    // than refetching the whole list, so anything missing here silently
    // disappears from that row until the next full reload. A plain
    // RETURNING with no status/owner fields was exactly that bug.
    const paidUntil = new Date(paidDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const result = await pool.query<{
      id: string;
      business_name: string;
      created_at: Date;
      trial_ends_at: Date | null;
      paid_until: Date | null;
      last_payment_marked_at: Date | null;
      last_payment_marked_by: string | null;
      owner_name: string | null;
      owner_phone: string | null;
    }>(
      `WITH updated AS (
         UPDATE tenants
            SET paid_until = $1, last_payment_marked_at = now(), last_payment_marked_by = $2
          WHERE id = $3
          RETURNING id, business_name, created_at, trial_ends_at, paid_until, last_payment_marked_at, last_payment_marked_by
       )
       SELECT u.*,
              (SELECT name FROM users WHERE tenant_id = u.id AND role = 'owner' ORDER BY created_at ASC LIMIT 1) AS owner_name,
              (SELECT phone FROM users WHERE tenant_id = u.id AND role = 'owner' ORDER BY created_at ASC LIMIT 1) AS owner_phone
         FROM updated u`,
      [paidUntil, req.platformAdmin.adminId, parsedId.data]
    );

    const updatedTenant = result.rows[0];

    res.status(200).json({
      tenant: {
        ...updatedTenant,
        status: computeTenantStatus(new Date(), updatedTenant.trial_ends_at, updatedTenant.paid_until)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark tenant as paid' });
  }
}
