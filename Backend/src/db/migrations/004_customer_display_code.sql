-- Per-tenant sequential counter for customer display codes (e.g. "CUST-0001").
-- Numbering resets per tenant because each tenant gets its own row here.
--
-- Concurrency: the counter is incremented via a single atomic statement in
-- application code —
--   INSERT INTO customer_code_counters (tenant_id, last_value) VALUES ($1, 1)
--   ON CONFLICT (tenant_id) DO UPDATE SET last_value = customer_code_counters.last_value + 1
--   RETURNING last_value
-- Postgres serializes concurrent INSERT ... ON CONFLICT DO UPDATE statements
-- that target the same row via ordinary row-level locking: if two staff for
-- the same tenant create a customer at the same instant, the second
-- statement blocks until the first one's transaction commits or rolls back,
-- then reads the post-commit value. Two different tenants use two different
-- rows and never block each other. This is why a plain
-- "SELECT COUNT(*) FROM customers WHERE tenant_id = $1" was NOT used to
-- derive the next number — that has a read-then-write race window, and would
-- also silently misbehave once soft-deleted customers exist (see migration
-- 005), since COUNT would no longer track "highest number issued so far".
CREATE TABLE customer_code_counters (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_value INT NOT NULL DEFAULT 0
);

-- NOTE: this assumes the customers table is currently empty (no customer
-- CRUD API has existed until now). If rows already exist in Neon, this ALTER
-- will fail on the NOT NULL — backfill display_code for existing rows first.
ALTER TABLE customers ADD COLUMN display_code TEXT NOT NULL;
ALTER TABLE customers ADD CONSTRAINT customers_tenant_display_code_unique UNIQUE (tenant_id, display_code);
