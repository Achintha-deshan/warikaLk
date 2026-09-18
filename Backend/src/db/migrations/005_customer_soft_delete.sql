-- Soft delete for customers — see review notes for why a hard DELETE is
-- wrong here: loans.customer_id is ON DELETE CASCADE, so deleting a customer
-- row would silently cascade-delete their loans, and each loan's payments
-- would cascade-delete again through payments.loan_id. A single "delete
-- customer" click would then be capable of erasing real financial history.
ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMPTZ;

-- Almost every customer query now filters deleted_at IS NULL; this partial
-- index keeps those lookups scoped to only the (much smaller, over time)
-- set of live rows rather than scanning soft-deleted ones too.
CREATE INDEX idx_customers_tenant_active ON customers(tenant_id) WHERE deleted_at IS NULL;
