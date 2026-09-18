CREATE TABLE platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN trial_ends_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN paid_until TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN last_payment_marked_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN last_payment_marked_by UUID REFERENCES platform_admins(id);

-- Backfill so existing tenants get a real value instead of NULL (NULL would
-- otherwise mean "never in trial and never paid" = permanently expired).
UPDATE tenants SET trial_ends_at = created_at + interval '15 days' WHERE trial_ends_at IS NULL;
