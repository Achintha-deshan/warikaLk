-- ============================================================
-- STEP 0 — PRE-FLIGHT CHECKS. Run these FIRST, individually. Every one of
-- them should return 0 rows. If any come back non-empty, STOP and tell me
-- what you found before running Step 1 — the ALTER statements below will
-- simply fail loudly on a violating table (Postgres won't let you add a
-- CHECK that existing rows already violate), so this is just about knowing
-- in advance rather than being surprised, and deciding how to fix the data
-- (correct it, or delete it if it's throwaway test data) before proceeding.
-- ============================================================

-- Loans whose total_days/cycle_mode pairing doesn't match loan_type:
SELECT id, loan_type, total_days, cycle_mode FROM loans
WHERE NOT (
  (loan_type = 'daily' AND total_days IS NOT NULL AND cycle_mode IS NULL)
  OR (loan_type = 'monthly' AND cycle_mode IS NOT NULL AND total_days IS NULL)
);

-- Loans with non-positive principal or negative interest_rate:
SELECT id, principal, interest_rate FROM loans WHERE principal <= 0 OR interest_rate < 0;

-- Payments with non-positive amount:
SELECT id, amount FROM payments WHERE amount <= 0;

-- Payments whose loan_id doesn't resolve to a loan (shouldn't be possible
-- given the existing FK, but confirms the backfill join in Step 1 will find
-- a match for every row rather than leaving some tenant_id NULL):
SELECT p.id FROM payments p LEFT JOIN loans l ON l.id = p.loan_id WHERE l.id IS NULL;

-- ============================================================
-- STEP 1 — MIGRATION. Only run this after every Step 0 query comes back empty.
-- ============================================================
BEGIN;

ALTER TABLE payments ADD COLUMN tenant_id UUID;

UPDATE payments p
   SET tenant_id = l.tenant_id
  FROM loans l
 WHERE p.loan_id = l.id;

ALTER TABLE payments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_payments_tenant ON payments(tenant_id);

ALTER TABLE loans ADD CONSTRAINT loans_type_fields_check
  CHECK (
    (loan_type = 'daily' AND total_days IS NOT NULL AND cycle_mode IS NULL)
    OR (loan_type = 'monthly' AND cycle_mode IS NOT NULL AND total_days IS NULL)
  );

ALTER TABLE loans ADD CONSTRAINT loans_principal_positive CHECK (principal > 0);
ALTER TABLE loans ADD CONSTRAINT loans_interest_rate_nonnegative CHECK (interest_rate >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

COMMIT;
