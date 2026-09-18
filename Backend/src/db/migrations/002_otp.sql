-- OTP verification codes for phone-based signup/login
CREATE TABLE otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'signup' CHECK (purpose IN ('signup', 'login')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Composite, phone-leading index. Serves three query patterns:
--   1. Rate-limit counts: WHERE phone = $1 (purpose/created_at read from the index)
--   2. Invalidate-old-rows: WHERE phone = $1 AND purpose = $2 AND verified = false
--   3. Latest-pending-OTP lookup: WHERE phone = $1 AND purpose = $2 AND verified = false
--      ORDER BY created_at DESC LIMIT 1 FOR UPDATE
CREATE INDEX idx_otp_phone_purpose_created ON otp_verifications(phone, purpose, created_at DESC);
