import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { config } from '../config';
import { AppError, inetOrNull } from '../common';
import { pool, redis, tx, audit } from '../db';
import { signTouristToken } from './tokens';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Bo ky tu de nham (0/O, 1/I/L) de nhan vien doc cho khach
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(len: number) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export interface ExchangeCtx {
  ip: string;
  userAgent: string;
  lang?: string;
}
export type ExchangeResult = { pending: true } | { pending: false; token: string; expiresAt: string };

/** Payment Service goi noi bo khi tao don. Online: tra auth_code (chi hien 1 lan, DB chi luu hash). */
export async function createGrant(input: { orderId: string; channel: 'ONLINE' | 'CASH'; validityHours: number }) {
  const authCode = input.channel === 'ONLINE' ? randomBytes(24).toString('base64url') : null;
  const minutes = input.channel === 'ONLINE' ? config.authCodeTtlMin : 60;
  try {
    const { rows } = await pool.query(
      `INSERT INTO access_grants (order_id, auth_code_hash, channel, status, validity_hours, grant_expires_at)
       VALUES ($1,$2,$3,'PENDING',$4, now() + make_interval(mins => $5))
       RETURNING id`,
      [input.orderId, authCode ? sha256(authCode) : null, input.channel, input.validityHours, minutes],
    );
    return { grantId: rows[0].id as string, authCode };
  } catch (e: any) {
    if (e.code === '23505') throw new AppError(409, 'GRANT_EXISTS', 'Grant already exists for this order');
    throw e;
  }
}

/** Event PaymentSucceeded: PENDING -> PAID. Nhanh CASH sinh ma ngan. Idempotent. */
export async function markGrantPaid(orderId: string) {
  const { rows } = await pool.query(
    `UPDATE access_grants
        SET status='PAID', paid_at=now(),
            grant_expires_at = GREATEST(grant_expires_at, now() + make_interval(mins => 15))
      WHERE order_id=$1 AND status='PENDING'
      RETURNING id, channel`,
    [orderId],
  );
  const g = rows[0];
  if (!g) return null;
  if (g.channel === 'CASH') await issueShortCode(g.id);
  await audit('SYSTEM', null, 'GRANT_PAID', 'grant', g.id, null, { orderId });
  return g;
}

export async function cancelGrant(orderId: string, reason: string) {
  await pool.query(`UPDATE access_grants SET status='CANCELLED' WHERE order_id=$1 AND status='PENDING'`, [orderId]);
  await audit('SYSTEM', null, 'GRANT_CANCELLED', 'order', orderId, null, { reason });
}

export async function expireGrants() {
  await pool.query(
    `UPDATE access_grants SET status='EXPIRED'
      WHERE status IN ('PENDING','PAID') AND grant_expires_at < now()`,
  );
}

// ---------- Ma ngan (nhanh tien mat) ----------
export async function issueShortCode(grantId: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(6);
    const ok = await redis.set(`shortcode:${code}`, grantId, 'EX', config.shortCodeTtlSec, 'NX');
    if (ok === 'OK') {
      await redis.set(`grantcode:${grantId}`, code, 'EX', config.shortCodeTtlSec);
      return code;
    }
  }
  throw new AppError(500, 'SHORTCODE_GENERATION_FAILED');
}

export type ShortCodeLookup =
  | { state: 'PENDING' }
  | { state: 'READY'; code: string; expiresInSec: number }
  | { state: 'EXPIRED' };

/** Dashboard nhan vien lay ma ngan cua mot don tien mat. */
export async function getShortCodeForOrder(orderId: string): Promise<ShortCodeLookup> {
  const { rows } = await pool.query('SELECT id, status, channel FROM access_grants WHERE order_id=$1', [orderId]);
  const g = rows[0];
  if (!g) throw new AppError(404, 'GRANT_NOT_FOUND');
  if (g.channel !== 'CASH') throw new AppError(400, 'NOT_A_CASH_ORDER');
  if (g.status === 'CONSUMED') throw new AppError(409, 'CODE_ALREADY_USED');
  if (g.status === 'CANCELLED') throw new AppError(410, 'GRANT_CANCELLED');
  if (g.status === 'PENDING') return { state: 'PENDING' }; // event PaymentSucceeded chua toi
  const code = await redis.get(`grantcode:${g.id}`);
  if (!code) return { state: 'EXPIRED' };
  const ttl = await redis.ttl(`grantcode:${g.id}`);
  return { state: 'READY', code, expiresInSec: Math.max(ttl, 0) };
}

/** Cap lai ma ngan (khach lam mat / het han 10 phut). Chi cho don da thu tien. */
export async function reissueShortCode(orderId: string, staffId: string) {
  const { rows } = await pool.query(
    `UPDATE access_grants
        SET status='PAID', grant_expires_at = now() + make_interval(mins => 30)
      WHERE order_id=$1 AND channel='CASH' AND paid_at IS NOT NULL AND status IN ('PAID','EXPIRED')
      RETURNING id`,
    [orderId],
  );
  const g = rows[0];
  if (!g) throw new AppError(409, 'CANNOT_REISSUE', 'Order not paid, already used or cancelled');
  const old = await redis.get(`grantcode:${g.id}`);
  if (old) await redis.del(`shortcode:${old}`);
  const code = await issueShortCode(g.id);
  await audit('STAFF', staffId, 'SHORTCODE_REISSUED', 'order', orderId);
  return { shortCode: code, expiresInSec: config.shortCodeTtlSec };
}

// ---------- Doi ma lay token ----------
async function consumeLocked(c: PoolClient, g: any, ctx: ExchangeCtx): Promise<ExchangeResult> {
  if (!g) throw new AppError(404, 'INVALID_CODE');
  if (g.status === 'CONSUMED') throw new AppError(409, 'CODE_ALREADY_USED');
  if (g.status === 'CANCELLED' || g.status === 'EXPIRED') throw new AppError(410, 'CODE_EXPIRED');
  if (new Date(g.grant_expires_at) < new Date()) throw new AppError(410, 'CODE_EXPIRED');
  if (g.status === 'PENDING') return { pending: true };

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + g.validity_hours * 3600_000);
  await c.query(
    `INSERT INTO access_sessions (id, grant_id, preferred_language, user_agent, ip_address, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [sessionId, g.id, ctx.lang ?? null, ctx.userAgent, inetOrNull(ctx.ip), expiresAt],
  );
  await c.query(`UPDATE access_grants SET status='CONSUMED', consumed_at=now() WHERE id=$1`, [g.id]);
  const token = await signTouristToken({ sessionId, lang: ctx.lang, expiresAt });
  return { pending: false, token, expiresAt: expiresAt.toISOString() };
}

export async function exchangeAuthCode(authCode: string, ctx: ExchangeCtx): Promise<ExchangeResult> {
  const result = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM access_grants WHERE auth_code_hash=$1 FOR UPDATE', [sha256(authCode)]);
    return consumeLocked(c, rows[0], ctx);
  });
  if (!result.pending) await audit('TOURIST', null, 'ISSUE_TOKEN', 'grant', undefined, ctx.ip, { channel: 'ONLINE' });
  return result;
}

export async function exchangeShortCode(shortCode: string, ctx: ExchangeCtx): Promise<ExchangeResult> {
  const lockKey = `shortcode_lock:${ctx.ip}`;
  if (await redis.exists(lockKey)) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Try again later');

  const code = shortCode.trim().toUpperCase();
  const grantId = await redis.getdel(`shortcode:${code}`); // dung 1 lan
  if (!grantId) {
    const attemptsKey = `shortcode_attempts:${ctx.ip}`;
    const n = await redis.incr(attemptsKey);
    if (n === 1) await redis.expire(attemptsKey, config.shortCodeLockSec);
    if (n >= config.shortCodeMaxAttempts) await redis.set(lockKey, '1', 'EX', config.shortCodeLockSec);
    throw new AppError(401, 'INVALID_CODE', 'Invalid or expired code');
  }
  await redis.del(`grantcode:${grantId}`);
  await redis.del(`shortcode_attempts:${ctx.ip}`);

  const result = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM access_grants WHERE id=$1 FOR UPDATE', [grantId]);
    return consumeLocked(c, rows[0], ctx);
  });
  if (!result.pending) await audit('TOURIST', null, 'ISSUE_TOKEN', 'grant', grantId, ctx.ip, { channel: 'CASH' });
  return result;
}
