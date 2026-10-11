import bcrypt from 'bcryptjs';
import { config } from './config';
import { pool } from './db';

export async function seedAdmin() {
  const { rowCount } = await pool.query('SELECT 1 FROM staff_accounts LIMIT 1');
  if (rowCount) return;
  const mk = async (username: string, password: string, name: string, roleId: number) =>
    pool.query(
      `INSERT INTO staff_accounts (username, password_hash, full_name, role_id) VALUES ($1,$2,$3,$4)`,
      [username, await bcrypt.hash(password, 10), name, roleId],
    );
  await mk(config.seedAdminUsername, config.seedAdminPassword, 'Administrator', 1);
  console.warn(`[seed] created admin "${config.seedAdminUsername}" - CHANGE THE PASSWORD`);
  if (!config.isProd) {
    await mk('staff1', 'Staff@12345', 'Nhan vien quay 1', 2);
    console.warn('[seed] created dev account staff1 / Staff@12345');
  }
}
