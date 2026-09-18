import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { PHONE_REGEX } from '../utils/validators';

interface CustomerRow {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  display_code: string;
  created_at: Date;
}

const CoordinatePairRefinement = <T extends { latitude?: number; longitude?: number }>(data: T): boolean =>
  (data.latitude === undefined) === (data.longitude === undefined);

const COORDINATE_PAIR_ISSUE = {
  message: 'Both latitude and longitude must be provided together',
  path: ['longitude']
};

const CreateCustomerSchema = z
  .object({
    name: z.string().min(2).max(100),
    phone: z.string().regex(PHONE_REGEX).optional(),
    address: z.string().max(300).optional(),
    latitude: z.number().min(5.5).max(10).optional(),
    longitude: z.number().min(79.5).max(82).optional()
  })
  .refine(CoordinatePairRefinement, COORDINATE_PAIR_ISSUE);

const UpdateCustomerSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().regex(PHONE_REGEX).optional(),
    address: z.string().max(300).optional(),
    latitude: z.number().min(5.5).max(10).optional(),
    longitude: z.number().min(79.5).max(82).optional()
  })
  .refine(CoordinatePairRefinement, COORDINATE_PAIR_ISSUE);

const ListCustomersQuerySchema = z.object({
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const CustomerIdSchema = z.string().uuid();

// Escapes LIKE/ILIKE wildcard characters in user-supplied search text so a
// literal "%" or "_" in a search term doesn't change the match semantics.
// Not a security fix (queries are parameterized regardless) — just correctness.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const CUSTOMER_COLUMNS = 'id, tenant_id, name, phone, address, latitude, longitude, display_code, created_at';

export async function createCustomer(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = CreateCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, phone, address, latitude, longitude } = parsed.data;

  // tenantId comes from the verified JWT, never from the request body — a
  // client claiming a different tenantId in its payload is simply ignored,
  // since the column list below never reads req.body.tenantId at all.
  const tenantId = req.user.tenantId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const counterResult = await client.query<{ last_value: number }>(
      `INSERT INTO customer_code_counters (tenant_id, last_value)
       VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET last_value = customer_code_counters.last_value + 1
       RETURNING last_value`,
      [tenantId]
    );
    const displayCode = `CUST-${String(counterResult.rows[0].last_value).padStart(4, '0')}`;

    const result = await client.query<CustomerRow>(
      `INSERT INTO customers (tenant_id, name, phone, address, latitude, longitude, display_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CUSTOMER_COLUMNS}`,
      [tenantId, name, phone ?? null, address ?? null, latitude ?? null, longitude ?? null, displayCode]
    );

    await client.query('COMMIT');

    res.status(201).json({ customer: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create customer' });
  } finally {
    client.release();
  }
}

export async function listCustomers(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = ListCustomersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tenantId = req.user.tenantId;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;
  const search = parsed.data.search?.trim();
  const searchPattern = search ? `%${escapeLikePattern(search)}%` : null;

  try {
    const result = await pool.query<CustomerRow & { total_count: string }>(
      `SELECT ${CUSTOMER_COLUMNS}, count(*) OVER() AS total_count
         FROM customers
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND ($2::text IS NULL OR name ILIKE $2 OR phone ILIKE $2 OR display_code ILIKE $2)
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4`,
      [tenantId, searchPattern, limit, offset]
    );

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const customers = result.rows.map(({ total_count, ...rest }) => rest);

    res.status(200).json({
      customers,
      pagination: { page, limit, total }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
}

export async function getCustomer(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedId = CustomerIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid customer id' });
    return;
  }

  const tenantId = req.user.tenantId;

  try {
    const result = await pool.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS}
         FROM customers
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [parsedId.data, tenantId]
    );

    const customer = result.rows[0];
    if (!customer) {
      // Same 404 whether the id doesn't exist at all or belongs to another
      // tenant — never confirms that a given id exists somewhere else.
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // TODO(loans module): once loans exist, join in this customer's loans
    // here, e.g. a second query on loans WHERE customer_id = $1 AND
    // tenant_id = $2 — not built yet, no loans table to join against.
    res.status(200).json({ customer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
}

export async function updateCustomer(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedId = CustomerIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid customer id' });
    return;
  }

  const parsed = UpdateCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, phone, address, latitude, longitude } = parsed.data;
  const tenantId = req.user.tenantId;

  try {
    // tenant_id and display_code are never referenced in this SET clause, so
    // they're structurally immutable here regardless of what the client
    // sends — this isn't relying on Zod to strip display_code/tenantId from
    // the body (it does, by default, since z.object() strips unrecognized
    // keys — but the real guarantee is that the SQL never has a column for
    // them to land in even if that stripping behavior ever changed).
    const result = await pool.query<CustomerRow>(
      `UPDATE customers
          SET name = COALESCE($1, name),
              phone = COALESCE($2, phone),
              address = COALESCE($3, address),
              latitude = COALESCE($4, latitude),
              longitude = COALESCE($5, longitude)
        WHERE id = $6 AND tenant_id = $7 AND deleted_at IS NULL
        RETURNING ${CUSTOMER_COLUMNS}`,
      [name ?? null, phone ?? null, address ?? null, latitude ?? null, longitude ?? null, parsedId.data, tenantId]
    );

    const customer = result.rows[0];
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.status(200).json({ customer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
}

export async function deleteCustomer(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedId = CustomerIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid customer id' });
    return;
  }

  const tenantId = req.user.tenantId;

  try {
    // Soft delete only — see migration 005 notes. Hard-deleting would cascade
    // through loans.customer_id and then payments.loan_id, destroying real
    // financial history for the sake of one "delete customer" click.
    const result = await pool.query(
      `UPDATE customers
          SET deleted_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [parsedId.data, tenantId]
    );

    if (result.rowCount !== 1) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.status(200).json({ message: 'Customer deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
}
