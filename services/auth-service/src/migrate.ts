import fs from 'fs';
import path from 'path';
import { pool } from './db';

export async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  // Docker: SQL duoc copy vao /app/migrations. Chay local: doc thang tu database/migrations/auth_db
  const dir = [
    process.env.MIGRATIONS_DIR,
    path.join(__dirname, '..', 'migrations'),
    path.join(__dirname, '..', '..', '..', 'database', 'migrations', 'auth_db'),
  ].find((d): d is string => !!d && fs.existsSync(d));
  if (!dir) throw new Error('[migrate] khong tim thay thu muc migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
