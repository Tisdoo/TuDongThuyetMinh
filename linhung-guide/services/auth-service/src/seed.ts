import bcrypt from 'bcryptjs';
import { config } from './config';
import { pool } from './db';

// Tạo tài khoản nếu chưa có (kiểm tra từng tài khoản, nên chạy lại an toàn)
async function ensureAccount(username: string, password: string, name: string, roleId: number): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM staff_accounts WHERE lower(username) = lower($1)', [username]);
  if (rowCount) return false;
  await pool.query(
    `INSERT INTO staff_accounts (username, password_hash, full_name, role_id) VALUES ($1,$2,$3,$4)`,
    [username, await bcrypt.hash(password, 10), name, roleId],
  );
  return true;
}

export async function seedAdmin() {
  if (await ensureAccount(config.seedAdminUsername, config.seedAdminPassword, 'Administrator', 1)) {
    console.warn(`[seed] created admin "${config.seedAdminUsername}" - CHANGE THE PASSWORD`);
  }
  if (config.seedDevAccounts && (await ensureAccount('staff1', 'Staff@12345', 'Nhan vien quay 1', 2))) {
    console.warn('[seed] created dev account staff1 / Staff@12345');
  }
}
