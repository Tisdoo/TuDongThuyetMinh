import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config';

// Ma hoa du lieu nhay cam (so CCCD) truoc khi luu DB. AES-256-GCM: vua bao mat vua phat hien bi sua doi.
// Khoa 32 byte suy ra tu PII_KEY. Dinh dang luu: "v1:" + base64(iv 12 byte | tag 16 byte | ban ma).
const key = () => createHash('sha256').update(config.piiKey).digest();

export function encryptPii(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

// Loi (sai khoa, du lieu hong) thi tra null, khong bao gio de lo noi dung.
export function decryptPii(token: string | null): string | null {
  try {
    if (!token || !token.startsWith('v1:')) return null;
    const raw = Buffer.from(token.slice(3), 'base64');
    const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const maskId = (id: string) => '*'.repeat(Math.max(id.length - 3, 0)) + id.slice(-3);
