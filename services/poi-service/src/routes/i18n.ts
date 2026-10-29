import { createHash } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { ah, AppError } from '../common';
import { supportedLang, translateTexts } from '../services/localize';

/**
 * Dich CHU GIAO DIEN cua web app du khach (nut bam, tieu de, huong dan...) sang ngon ngu khach chon.
 * App gui bang chu tieng Anh cua no len, server dich qua content-service va giu ket qua trong RAM.
 *
 * Route nay CONG KHAI (khach chua mua ve cung can giao dien dung ngon ngu), nen:
 * - chi nhan ngon ngu co trong LANGUAGES, gioi han so cau va do dai
 * - cache theo (ngon ngu, hash bang chu): moi ngon ngu chi goi Google 1 lan, khach sau lay tu RAM
 * - gateway gioi han tan suat rieng cho route nay
 */
export const i18nRouter = Router();

const MAX_KEYS = 400;
const MAX_TOTAL_CHARS = 40_000;
const MAX_CACHE = 50;
const FAIL_COOLDOWN_MS = 60_000;

const cache = new Map<string, Promise<Record<string, string>>>();
const failedUntil = new Map<string, number>();

// Giu nguyen cho trong nhu {time}, {n}: doi thanh {0}, {1}... (Google thuong giu nguyen) roi doi lai sau khi dich
const PH = /\{(\w+)\}/g;
export function protect(s: string): { text: string; names: string[] } {
  const names: string[] = [];
  const text = s.replace(PH, (_m, name: string) => `{${names.push(name) - 1}}`);
  return { text, names };
}
export function restore(translated: string, names: string[], fallback: string): string {
  const found = translated.match(/\{\s*\d+\s*\}/g) ?? [];
  if (found.length !== names.length) return fallback;      // Google lam hong cho trong -> dung ban tieng Anh cho cau nay
  return translated.replace(/\{\s*(\d+)\s*\}/g, (m, i: string) => (names[Number(i)] !== undefined ? `{${names[Number(i)]}}` : m));
}

const Body = z.object({
  lang: z.string(),
  source: z.enum(['en', 'vi']).default('en'),
  strings: z.record(z.string().max(1000)).refine((o) => Object.keys(o).length <= MAX_KEYS, `Toi da ${MAX_KEYS} cau`)
    .refine((o) => Object.values(o).reduce((n, s) => n + s.length, 0) <= MAX_TOTAL_CHARS, 'Qua dai'),
});

async function translateUi(strings: Record<string, string>, source: string, lang: string) {
  const keys = Object.keys(strings);
  const prot = keys.map((k) => protect(strings[k]));
  const out = await translateTexts(prot.map((p) => p.text), source, lang);
  return Object.fromEntries(keys.map((k, i) => [k, restore(out[i] ?? '', prot[i].names, strings[k]) || strings[k]]));
}

// Danh sach ngon ngu (tu bien LANGUAGES) cho man hinh chao mung, truoc khi khach mua ve
i18nRouter.get('/poi/languages', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(config.languages);
});

i18nRouter.post('/poi/i18n', ah(async (req, res) => {
  const b = Body.parse(req.body);
  const lang = supportedLang(b.lang);
  if (lang === b.source) return res.json({ lang, strings: b.strings });

  const key = `${lang}:${b.source}:${createHash('sha256').update(JSON.stringify(b.strings)).digest('hex')}`;
  let p = cache.get(key);
  if (!p) {
    if (Date.now() < (failedUntil.get(key) ?? 0)) throw new AppError(503, 'TRANSLATE_COOLDOWN');
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string); // bo muc cu nhat
    p = translateUi(b.strings, b.source, lang);
    cache.set(key, p);
    p.catch(() => { cache.delete(key); failedUntil.set(key, Date.now() + FAIL_COOLDOWN_MS); });
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({ lang, strings: await p });
}));
