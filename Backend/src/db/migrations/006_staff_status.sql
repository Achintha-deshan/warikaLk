BEGIN;

ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- The existing UNIQUE constraint on phone is table-wide and permanent: once a
-- phone is used, it's held forever even after the account is deactivated,
-- which would block rehiring the same person or fixing a typo'd phone by
-- re-adding them. Postgres can't express a partial UNIQUE constraint
-- directly, so this drops the constraint (and its backing index) and
-- replaces it with a partial UNIQUE INDEX that only enforces uniqueness
-- among active users. A deactivated row keeps its historical phone value
-- forever; a new active row is free to claim that same phone once the old
-- row is inactive. At most one ACTIVE row can ever hold a given phone, but
-- any number of INACTIVE rows can share one historically.
--
-- If `users_phone_key` isn't the actual constraint name in Neon, check first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass;
ALTER TABLE users DROP CONSTRAINT users_phone_key;
CREATE UNIQUE INDEX users_phone_active_unique ON users(phone) WHERE is_active = true;

COMMIT;
