import { getItem, KEYS, removeItem, setItem } from '../lib/storage';
import type {
  CashOrder, ChatReply, Dataset, MomoOrder, OnlineOrder, OrderStatusRes, Product, TokenRes,
} from './types';

// Mọi yêu cầu đi qua Gateway. Dev: Vite proxy /api -> :8080. Docker: nginx chuyển /api -> Gateway.
const BASE = '/api';

export interface ApiResult<T> { status: number; data: T | null; code: string | null }

/** Gọi lại khi token hết hạn / bị thu hồi (App chuyển về màn hình thanh toán). */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

function tokenExpMs(tok: string): number {
  try {
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp ?? 0) * 1000;
  } catch { return 0; }
}
export function getToken(): string | null {
  const tk = getItem(KEYS.token);
  return tk && tokenExpMs(tk) > Date.now() + 5000 ? tk : null;
}
export const saveToken = (tk: string) => setItem(KEYS.token, tk);
export const clearToken = () => removeItem(KEYS.token);

async function request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth) {
    const tk = getToken();
    if (!tk) { onUnauthorized(); return { status: 401, data: null, code: 'MISSING_TOKEN' }; }
    headers.authorization = `Bearer ${tk}`;
  }
  const res = await fetch(BASE + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* 204/304 không có body */ }
  const code = (json as { error?: { code?: string } } | null)?.error?.code ?? (res.ok ? null : `HTTP_${res.status}`);
  if (res.status === 401 && opts.auth) { clearToken(); onUnauthorized(); }
  return { status: res.status, data: res.ok ? (json as T) : null, code };
}

export const api = {
  products: () => request<Product[]>('GET', '/payments/products'),
  createOnline: (productCode: string, lang: string) => request<OnlineOrder>('POST', '/payments/online', { body: { productCode, lang } }),
  createCash: (productCode: string, lang: string) => request<CashOrder>('POST', '/payments/cash', { body: { productCode, lang } }),
  createMomo: (productCode: string, lang: string) => request<MomoOrder>('POST', '/payments/momo-qr', { body: { productCode, lang } }),
  orderStatus: (orderCode: string) => request<OrderStatusRes>('GET', `/payments/orders/${encodeURIComponent(orderCode)}`),
  /** 202 = chưa thanh toán xong, 200 = có accessToken */
  exchange: (authCode: string, lang: string) => request<TokenRes>('POST', '/auth/exchange', { body: { authCode, lang } }),
  exchangeShort: (shortCode: string, lang: string) => request<TokenRes>('POST', '/auth/exchange-short', { body: { shortCode, lang } }),
  dataset: (version?: number) => request<Dataset>('GET', '/poi/dataset/latest', {
    auth: true, headers: version ? { 'if-none-match': `"v${version}"` } : {},
  }),
  chat: (question: string, lang: string, poiId?: string) => request<ChatReply>('POST', '/chat', { auth: true, body: { question, lang, poiId } }),
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
