-- If this constraint name doesn't match what's actually in Neon, run first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'otp_verifications'::regclass;
-- and substitute the real name below. Postgres can't ALTER a CHECK in place,
-- so it has to be dropped and recreated.
ALTER TABLE otp_verifications DROP CONSTRAINT otp_verifications_purpose_check;
ALTER TABLE otp_verifications ADD CONSTRAINT otp_verifications_purpose_check
  CHECK (purpose IN ('signup', 'login', 'password_reset'));

-- Tracks "OTP verified for password reset, reset not yet completed" as its
-- own state. The OTP itself (otp_verifications) is a low-entropy 6-digit code
-- that's meant to be spent the moment it's checked — replaying it as proof
-- across the later /reset request would mean carrying a guessable secret
-- across an extra HTTP round trip for no benefit, and would require special-
-- casing verifyAndConsumeOtp to allow re-checking an already-verified row.
-- Instead, verify-otp mints a separate high-entropy opaque token scoped only
-- to "this phone may reset its password once, soon" and hands back nothing
-- more guessable than the OTP was.
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  otp_verification_id UUID NOT NULL REFERENCES otp_verifications(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_phone ON password_reset_tokens(phone);

-- Lets requireAuth invalidate JWTs issued before a password reset.
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
