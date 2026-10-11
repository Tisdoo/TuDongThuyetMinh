import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl });
export const redis = new Redis(config.redisUrl);

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(
  actorType: 'STAFF' | 'TOURIST' | 'SYSTEM',
  actorId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  ip?: string | null,
  metadata?: unknown,
) {
  await pool
    .query(
      `INSERT INTO auth_audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip_address, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actorType, actorId, action, entityType ?? null, entityId ?? null, ip ?? null, metadata ? JSON.stringify(metadata) : null],
    )
    .catch((e) => console.error('audit failed', e));
}
