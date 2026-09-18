import bcrypt from 'bcrypt';
import { pool } from './db';
import { env } from './env';

// Called once at startup, after assertEnv() and before app.listen(). Must
// never crash the process: a seeding failure (DB not reachable yet,
// migration 010 not applied yet) only affects platform-admin login — it has
// no bearing on tenant traffic. Taking the whole app down over it would be
// strictly worse than just not seeding this one time and retrying on the
// next restart, so failures are logged, never thrown.
export async function seedPlatformAdmin(): Promise<void> {
  try {
    const existing = await pool.query('SELECT id FROM platform_admins WHERE username = $1', [
      env.DEVELOPER_USERNAME
    ]);

    if (existing.rows.length > 0) {
      console.log('Platform admin ready (existing account left untouched).');
      return;
    }

    const passwordHash = await bcrypt.hash(env.DEVELOPER_PASSWORD, 12);
    await pool.query('INSERT INTO platform_admins (username, password_hash) VALUES ($1, $2)', [
      env.DEVELOPER_USERNAME,
      passwordHash
    ]);
    console.log('Platform admin ready (account created).');
  } catch (err) {
    console.error('Platform admin seeding failed — continuing startup anyway:', err);
  }
}
