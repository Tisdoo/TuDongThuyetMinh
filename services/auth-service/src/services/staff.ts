import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { AppError } from '../common';
import { audit, pool, redis, tx } from '../db';
import { sha256 } from './grants';
import { signStaffToken } from './tokens';

async function issuePair(staff: { id: string; role: string; username: string }) {
  const accessToken = await signStaffToken({ staffId: staff.id, role: staff.role, username: staff.username });
  const refreshToken = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO staff_refresh_tokens (staff_id, token_hash, expires_at)
     VALUES ($1,$2, now() + make_interval(days => $3))`,
    [staff.id, sha256(refreshToken), config.refreshTtlDays],
  );
  return { accessToken, refreshToken, expiresInSec: config.staffTokenTtlSec, role: staff.role };
}

export async function login(username: string, password: string, ip: string) {
  const failKey = `login_fail:${username.toLowerCase()}`;
  if (Number((await redis.get(failKey)) ?? 0) >= 5) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Account temporarily locked');

  const { rows } = await pool.query(
    `SELECT s.id, s.username, s.password_hash, s.is_active, r.code AS role
       FROM staff_accounts s JOIN roles r ON r.id = s.role_id
      WHERE lower(s.username) = lower($1)`,
    [username],
  );
  const s = rows[0];
  const ok = s && s.is_active && (await bcrypt.compare(password, s.password_hash));
  if (!ok) {
    await redis.multi().incr(failKey).expire(failKey, 900).exec();
    await audit('STAFF', s?.id ?? null, 'LOGIN_FAIL', 'staff', username, ip);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  }
  await redis.del(failKey);
  await pool.query('UPDATE staff_accounts SET last_login_at=now() WHERE id=$1', [s.id]);
  await audit('STAFF', s.id, 'LOGIN', 'staff', s.id, ip);
  return issuePair(s);
}

/** Refresh token xoay vong: moi lan dung se thu hoi token cu. */
export async function refresh(refreshToken: string) {
  const staff = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT t.id AS tid, s.id, s.username, s.is_active, r.code AS role
         FROM staff_refresh_tokens t
         JOIN staff_accounts s ON s.id = t.staff_id
         JOIN roles r ON r.id = s.role_id
        WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at > now()
        FOR UPDATE OF t`,
      [sha256(refreshToken)],
    );
    const row = rows[0];
    if (!row || !row.is_active) throw new AppError(401, 'INVALID_REFRESH_TOKEN');
    await c.query('UPDATE staff_refresh_tokens SET revoked_at=now() WHERE id=$1', [row.tid]);
    return row;
  });
  return issuePair(staff);
}

export async function logout(refreshToken: string) {
  await pool.query('UPDATE staff_refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [
    sha256(refreshToken),
  ]);
}

export async function createStaff(input: {
  username: string; password: string; fullName?: string; email?: string; roleCode: string;
}, actorId: string) {
  const role = await pool.query('SELECT id FROM roles WHERE code=$1', [input.roleCode]);
  if (!role.rows[0]) throw new AppError(400, 'UNKNOWN_ROLE');
  const hash = await bcrypt.hash(input.password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_accounts (username, email, password_hash, full_name, role_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, full_name, is_active`,
      [input.username, input.email ?? null, hash, input.fullName ?? null, role.rows[0].id],
    );
    await audit('STAFF', actorId, 'STAFF_CREATED', 'staff', rows[0].id);
    return { ...rows[0], role: input.roleCode };
  } catch (e: any) {
    if (e.code === '23505') throw new AppError(409, 'USERNAME_OR_EMAIL_EXISTS');
    throw e;
  }
}

export async function listStaff() {
  const { rows } = await pool.query(
    `SELECT s.id, s.username, s.email, s.full_name, s.is_active, s.last_login_at, r.code AS role
       FROM staff_accounts s JOIN roles r ON r.id = s.role_id ORDER BY s.created_at`,
  );
  return rows;
}

export async function updateStaff(id: string, patch: {
  isActive?: boolean; roleCode?: string; password?: string; fullName?: string;
}, actorId: string) {
  if (id === actorId && patch.isActive === false) throw new AppError(400, 'CANNOT_DEACTIVATE_SELF');
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.isActive !== undefined) add('is_active', patch.isActive);
  if (patch.fullName !== undefined) add('full_name', patch.fullName);
  if (patch.password) add('password_hash', await bcrypt.hash(patch.password, 10));
  if (patch.roleCode) {
    const r = await pool.query('SELECT id FROM roles WHERE code=$1', [patch.roleCode]);
    if (!r.rows[0]) throw new AppError(400, 'UNKNOWN_ROLE');
    add('role_id', r.rows[0].id);
  }
  if (!sets.length) throw new AppError(400, 'NOTHING_TO_UPDATE');
  vals.push(id);
  const { rowCount } = await pool.query(
    `UPDATE staff_accounts SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
  if (!rowCount) throw new AppError(404, 'STAFF_NOT_FOUND');
  if (patch.isActive === false || patch.password) {
    await pool.query('UPDATE staff_refresh_tokens SET revoked_at=now() WHERE staff_id=$1 AND revoked_at IS NULL', [id]);
  }
  await audit('STAFF', actorId, 'STAFF_UPDATED', 'staff', id, null, { fields: Object.keys(patch) });
}

export async function listSessions(limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, preferred_language, ip_address, issued_at, expires_at, revoked_at, revoked_reason
       FROM access_sessions ORDER BY issued_at DESC LIMIT $1`, [limit]);
  return rows;
}

/** Thu hoi phien du khach: ghi DB + denylist Redis (gateway kiem tra) den luc token het han. */
export async function revokeSession(id: string, reason: string, actorId: string) {
  const { rows } = await pool.query(
    `UPDATE access_sessions SET revoked_at=now(), revoked_reason=$2
      WHERE id=$1 AND revoked_at IS NULL RETURNING expires_at`, [id, reason]);
  if (!rows[0]) throw new AppError(404, 'SESSION_NOT_FOUND_OR_REVOKED');
  const ttl = Math.max(Math.ceil((new Date(rows[0].expires_at).getTime() - Date.now()) / 1000), 1);
  await redis.set(`token_denylist:${id}`, '1', 'EX', ttl);
  await audit('STAFF', actorId, 'SESSION_REVOKED', 'session', id, null, { reason });
}
