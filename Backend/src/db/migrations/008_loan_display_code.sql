-- Same atomic-counter pattern as customer_code_counters (customers module):
-- INSERT ... ON CONFLICT (tenant_id) DO UPDATE ... RETURNING last_value.
-- Postgres serializes concurrent upserts targeting the same tenant_id row
-- via ordinary row-level locking, so two staff creating a loan for the same
-- tenant at the same instant can never read/increment the same starting
-- value. Different tenants use different rows and never block each other.
CREATE TABLE loan_code_counters (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_value INT NOT NULL DEFAULT 0
);

-- NOTE: same caveat as migration 004 (customers.display_code) — this assumes
-- the loans table is currently empty. If real loan rows already exist in
-- Neon, this ALTER will fail on the NOT NULL constraint — tell me and we'll
-- write a backfill (generating display codes for existing rows through the
-- same counter mechanism, ordered by created_at) before re-running this.
ALTER TABLE loans ADD COLUMN display_code TEXT NOT NULL;
ALTER TABLE loans ADD CONSTRAINT loans_tenant_display_code_unique UNIQUE (tenant_id, display_code);
