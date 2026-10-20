import { getJson, KEYS, removeItem, setItem } from './storage';

export type PayMethod = 'ONLINE' | 'MOMO' | 'CASH';
export interface TicketInfo { orderCode: string; method: PayMethod; expiresAt: string; lang: string }

/** Đơn đang chờ (trước khi có token): nhớ mã đơn và hình thức để hiện ở tab Vé sau khi mở khóa. */
export const savePendingOrder = (orderCode: string, method: PayMethod) =>
  setItem(KEYS.pendingOrder, JSON.stringify({ orderCode, method }), 'session');

export function saveTicket(expiresAt: string, lang: string) {
  const p = getJson<{ orderCode: string; method: PayMethod }>(KEYS.pendingOrder, 'session');
  setItem(KEYS.ticket, JSON.stringify({ orderCode: p?.orderCode ?? '', method: p?.method ?? 'ONLINE', expiresAt, lang }));
  removeItem(KEYS.pendingOrder, 'session');
}

export const getTicket = () => getJson<TicketInfo>(KEYS.ticket);
export const clearTicket = () => removeItem(KEYS.ticket);
