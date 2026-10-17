// localStorage/sessionStorage có thể ném lỗi (chế độ riêng tư, đầy bộ nhớ) -> luôn bọc try/catch.
export const KEYS = {
  token: 'll_token',
  lang: 'll_lang',
  dataset: 'll_dataset',
  pendingAuth: 'll_pending_auth', // authCode của đơn online (sessionStorage)
  pendingMomo: 'll_pending_momo', // đơn MoMo QR đang chờ (sessionStorage)
  pendingCash: 'll_pending_cash', // đơn tiền mặt đang chờ (sessionStorage)
} as const;

type Store = 'local' | 'session';
const pick = (s: Store) => (s === 'local' ? localStorage : sessionStorage);

export function getItem(key: string, s: Store = 'local'): string | null {
  try { return pick(s).getItem(key); } catch { return null; }
}
export function setItem(key: string, value: string, s: Store = 'local'): void {
  try { pick(s).setItem(key, value); } catch { /* bỏ qua */ }
}
export function removeItem(key: string, s: Store = 'local'): void {
  try { pick(s).removeItem(key); } catch { /* bỏ qua */ }
}
export function getJson<T>(key: string, s: Store = 'local'): T | null {
  const raw = getItem(key, s);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
