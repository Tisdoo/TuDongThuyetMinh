import bcrypt from 'bcryptjs';
import { config } from '../config';
import { AppError } from '../common';
import { audit, pool, tx } from '../db';
import { decryptPii, encryptPii, maskId } from './pii';

export interface RegisterInput {
  username: string; password: string; fullName: string; phone: string; email?: string;
  businessName: string; address?: string; note?: string; idNumber?: string;
}

/**
 * Chu quan tu dang ky. Tao tai khoan role OWNER o trang thai KHOA (is_active=false) va mot don PENDING.
 * Tai khoan chi dang nhap duoc sau khi Admin duyet. Hai viec nam trong 1 transaction.
 */
export async function registerOwner(i: RegisterInput, ip: string) {
  const hash = await bcrypt.hash(i.password, 10);
  try {
    const r = await tx(async (c) => {
      const acc = await c.query(
        `INSERT INTO staff_accounts (username, email, password_hash, full_name, role_id, is_active)
         SELECT $1, $2, $3, $4, r.id, false FROM roles r WHERE r.code = 'OWNER' RETURNING id`,
        [i.username, i.email ?? null, hash, i.fullName],
      );
      if (!acc.rows[0]) throw new AppError(500, 'OWNER_ROLE_MISSING');
      const reg = await c.query(
        `INSERT INTO owner_registrations
           (account_id, full_name, phone, email, business_name, address, note, id_number_enc, id_masked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [acc.rows[0].id, i.fullName, i.phone, i.email ?? null, i.businessName, i.address ?? null, i.note ?? null,
         i.idNumber ? encryptPii(i.idNumber) : null, i.idNumber ? maskId(i.idNumber) : null],
      );
      return { registrationId: reg.rows[0].id as string, status: 'PENDING' as const };
    });
    await audit('SYSTEM', null, 'OWNER_REGISTERED', 'registration', r.registrationId, ip);
    return r;
  } catch (e: any) {
    if (e.code === '23505') throw new AppError(409, 'USERNAME_OR_EMAIL_EXISTS');
    throw e;
  }
}

/** Chu quan xem don cua minh da duoc duyet chua (xac thuc bang chinh tai khoan da dang ky). */
export async function ownerRegistrationStatus(username: string, password: string) {
  const { rows } = await pool.query(
    `SELECT s.password_hash, g.status, g.admin_note, g.business_name, g.reviewed_at
       FROM staff_accounts s JOIN owner_registrations g ON g.account_id = s.id
      WHERE lower(s.username) = lower($1)`,
    [username],
  );
  const r = rows[0];
  if (!r || !(await bcrypt.compare(password, r.password_hash))) throw new AppError(401, 'INVALID_CREDENTIALS');
  return { status: r.status, adminNote: r.admin_note, businessName: r.business_name, reviewedAt: r.reviewed_at };
}

export async function listRegistrations(status?: string) {
  const { rows } = await pool.query(
    `SELECT g.id, s.username, g.full_name, g.phone, g.email, g.business_name, g.address, g.note,
            g.id_masked, g.pii_redacted_at, g.status, g.admin_note, g.reviewed_at, g.created_at
       FROM owner_registrations g JOIN staff_accounts s ON s.id = g.account_id
      WHERE ($1::text IS NULL OR g.status = $1)
      ORDER BY (g.status = 'PENDING') DESC, g.created_at DESC LIMIT 200`,
    [status ?? null],
  );
  return rows;
}

export async function reviewRegistration(id: string, decision: 'APPROVED' | 'REJECTED', note: string | undefined, staffId: string) {
  await tx(async (c) => {
    const { rows } = await c.query('SELECT id, account_id, status FROM owner_registrations WHERE id=$1 FOR UPDATE', [id]);
    const g = rows[0];
    if (!g) throw new AppError(404, 'REGISTRATION_NOT_FOUND');
    if (g.status !== 'PENDING') throw new AppError(409, 'ALREADY_REVIEWED', `Registration is ${g.status}`);
    await c.query(
      `UPDATE owner_registrations SET status=$2, admin_note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1`,
      [id, decision, note ?? null, staffId],
    );
    if (decision === 'APPROVED') {
      await c.query('UPDATE staff_accounts SET is_active=true, updated_at=now() WHERE id=$1', [g.account_id]);
    }
  });
  await audit('STAFF', staffId, decision === 'APPROVED' ? 'OWNER_APPROVED' : 'OWNER_REJECTED', 'registration', id, null, { note });
}

/** Admin xem so CCCD that: giai ma, va LUON ghi nhat ky de truy vet ai da xem. */
export async function revealIdNumber(id: string, staffId: string) {
  const { rows } = await pool.query('SELECT id_number_enc FROM owner_registrations WHERE id=$1', [id]);
  if (!rows[0]) throw new AppError(404, 'REGISTRATION_NOT_FOUND');
  await audit('STAFF', staffId, 'PII_VIEWED', 'registration', id);
  return { idNumber: decryptPii(rows[0].id_number_enc) };
}

/** Du lieu nhay cam chi giu toi da PII_RETENTION_DAYS (180) ngay sau khi duyet, roi tu xoa (toi thieu hoa du lieu). */
export async function redactOldPii() {
  const r = await pool.query(
    `UPDATE owner_registrations
        SET id_number_enc = NULL, id_masked = 'REDACTED', pii_redacted_at = now()
      WHERE id_number_enc IS NOT NULL AND status <> 'PENDING'
        AND reviewed_at < now() - make_interval(days => $1)`,
    [config.piiRetentionDays],
  );
  if (r.rowCount) console.log(`[pii] redacted ${r.rowCount} registration(s)`);
}
