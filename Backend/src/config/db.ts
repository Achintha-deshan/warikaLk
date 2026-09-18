import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// DATABASE_URL already points at Neon's pooled (-pooler) endpoint, which
// multiplexes up to 10,000 client connections onto Neon's actual Postgres
// backend limit via PgBouncer — that's the real ceiling, not this Pool's
// own `max`. Kept `max`/`idleTimeoutMillis` at pg's own defaults (10 / 10s)
// rather than raising them speculatively — no measured evidence 10 is
// insufficient at current load, and PgBouncer absorbs the actual limit
// regardless. connectionTimeoutMillis was NOT previously set at all, which
// defaults to an unbounded wait: if the pool is ever exhausted (or Neon is
// slow/unresponsive), pool.connect()/pool.query() would hang indefinitely
// with no error, rather than failing fast — the opposite of "handle
// gracefully". 5s is enough slack for normal network/Neon latency while
// still failing in bounded time; a genuine cold start from Neon's
// scale-to-zero can occasionally take a bit longer, in which case this
// surfaces as a clear, catchable error instead of a silent hang.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});