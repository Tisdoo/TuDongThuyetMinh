import { en } from './en';
import { fr } from './fr';
import { ja } from './ja';
import { ko } from './ko';
import { vi } from './vi';
import { zh } from './zh';

export type Dict = typeof vi;
export type I18nKey = keyof Dict;

const DICTS: Record<string, Dict> = { vi, en, 'zh-CN': zh, ja, ko, fr };

/** Ngôn ngữ backend hỗ trợ (bảng languages của poi-service). Tên gốc để khách nhận ra ngôn ngữ của mình. */
export const LANGS = [
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh-CN', name: 'Chinese', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
];

/** Mã cho SpeechSynthesisUtterance.lang và Intl */
export const LOCALE: Record<string, string> = { vi: 'vi-VN', en: 'en-US', 'zh-CN': 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR' };

export const isI18nKey = (k: string): k is I18nKey => k in vi;

export function normalizeLang(l: string | undefined): string {
  const s = (l ?? '').toLowerCase();
  if (s.startsWith('vi')) return 'vi';
  if (s.startsWith('zh')) return 'zh-CN';
  for (const c of ['ja', 'ko', 'fr', 'en']) if (s.startsWith(c)) return c;
  return 'en';
}

export function translate(lang: string, key: I18nKey, vars?: Record<string, string | number>): string {
  let s = (DICTS[lang] ?? en)[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export const fmtMoney = (amount: number, currency = 'VND', lang = 'vi') =>
  new Intl.NumberFormat(LOCALE[lang] ?? 'vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);

export const fmtTime = (d: Date, lang: string) =>
  new Intl.DateTimeFormat(LOCALE[lang] ?? 'vi-VN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }).format(d);
