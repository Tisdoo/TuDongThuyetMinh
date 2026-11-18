import fs from 'fs';
import { config } from '../config';
import { AppError } from '../common';
import { Dataset, latestPublished } from './builder';

/**
 * Dich dataset theo yeu cau (thay cho bang poi_translations + content_jobs cu).
 *
 * Luong: khach chon ngon ngu -> GET /poi/dataset/latest?lang=ja
 *   1) doc file dataset moi nhat (chi co tieng Viet)
 *   2) gui toan bo ten/mo ta sang content-service /translate (1 request, content-service tu chia lo)
 *   3) giu ket qua trong RAM theo khoa "version:lang" -> khach sau va lan sau tra ngay
 * Publish ban moi -> version doi -> cache cu tu bo, dich lai tu ban moi.
 */
const TRANSLATE_TIMEOUT_MS = 90_000;
const TTS_TIMEOUT_MS = 60_000;
// Dich loi (vd Google tra 429) thi KHONG goi lai ngay: moi lan app tai/doi ngon ngu deu goi lai se lam Google chan lau hon
const FAIL_COOLDOWN_MS = 60_000;
const WARMUP_GAP_MS = 2_000;

let base: { version: number; checksum: string; data: Dataset } | null = null;
const localized = new Map<string, Promise<Dataset>>();
const failedUntil = new Map<string, number>();

export const audioUrl = (poiId: string, lang: string) => `/api/poi/tts/${poiId}?lang=${encodeURIComponent(lang)}`;

export function supportedLang(code: unknown): string {
  const c = String(code ?? config.sourceLang);
  const hit = config.languages.find((l) => l.code.toLowerCase() === c.toLowerCase());
  if (!hit) throw new AppError(400, 'UNSUPPORTED_LANGUAGE', `Supported: ${config.languages.map((l) => l.code).join(', ')}`);
  return hit.code;
}

/** Dataset tieng Viet moi nhat (doc file 1 lan cho moi version). */
export async function getBase() {
  const v = await latestPublished();
  if (!v) return null;
  if (!base || base.version !== v.version_no) {
    base = { version: v.version_no, checksum: v.checksum, data: JSON.parse(fs.readFileSync(v.bundle_url, 'utf8')) };
    for (const k of localized.keys()) if (!k.startsWith(`${v.version_no}:`)) localized.delete(k); // bo cache ban cu
  }
  return base;
}

function withAudio(ds: Dataset, langs: string[]): Dataset {
  return {
    ...ds,
    pois: ds.pois.map((p) => ({
      ...p,
      translations: Object.fromEntries(Object.entries(p.translations)
        .filter(([l]) => langs.includes(l))
        .map(([l, t]) => [l, { ...t, audioUrl: audioUrl(p.id, l) }])),
    })),
  };
}

async function contentPost(pathname: string, body: unknown, timeoutMs: number) {
  let r: Response;
  try {
    r = await fetch(`${config.contentUrl}${pathname}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError(502, 'CONTENT_SERVICE_UNAVAILABLE');
  }
  if (!r.ok) throw new AppError(502, 'CONTENT_SERVICE_ERROR', `content-service ${pathname} -> ${r.status}`);
  return r;
}

/** Dich 1 mang van ban qua content-service, giu nguyen thu tu. Dung chung cho noi dung POI va chu giao dien. */
export async function translateTexts(texts: string[], source: string, target: string): Promise<string[]> {
  if (!texts.length) return [];
  const r = await contentPost('/translate', { texts, source, target }, TRANSLATE_TIMEOUT_MS);
  const out = ((await r.json()) as { texts: string[] }).texts;
  if (!Array.isArray(out) || out.length !== texts.length) throw new AppError(502, 'TRANSLATE_BAD_RESPONSE');
  return out;
}

async function translateDataset(ds: Dataset, lang: string): Promise<Dataset> {
  const src = config.sourceLang;
  const texts = ds.pois.flatMap((p) => {
    const t = p.translations[src];
    return [t.name, t.shortDescription, t.description];
  });
  const out = await translateTexts(texts, src, lang);
  return {
    ...ds,
    pois: ds.pois.map((p, i) => ({
      ...p,
      translations: {
        ...p.translations,
        [lang]: { name: out[i * 3], shortDescription: out[i * 3 + 1], description: out[i * 3 + 2] },
      },
    })),
  };
}

/** Dataset co tieng Viet + ngon ngu `lang` (kem audioUrl). Nem loi neu dich that bai (khong cache loi). */
export async function getLocalized(lang: string): Promise<Dataset> {
  const b = await getBase();
  if (!b) throw new AppError(404, 'NO_PUBLISHED_DATASET', 'Admin has not published a dataset yet');
  if (lang === config.sourceLang) return withAudio(b.data, [lang]);
  const key = `${b.version}:${lang}`;
  let p = localized.get(key);
  if (!p) {
    const until = failedUntil.get(key) ?? 0;
    if (Date.now() < until) {
      throw new AppError(503, 'TRANSLATE_COOLDOWN', `Dich ${lang} vua loi, thu lai sau ${Math.ceil((until - Date.now()) / 1000)}s`);
    }
    // Luu Promise (khong luu ket qua) de 5 may cung chon tieng Nhat mot luc thi chi dich 1 lan
    p = translateDataset(b.data, lang).then((ds) => withAudio(ds, [config.sourceLang, lang]));
    localized.set(key, p);
    p.then(() => failedUntil.delete(key), () => {
      localized.delete(key);                                  // lan sau (het thoi gian cho) thu dich lai
      failedUntil.set(key, Date.now() + FAIL_COOLDOWN_MS);
    });
  }
  return p;
}

/** Dich san moi ngon ngu ngay sau khi Publish, de khach chon ngon ngu la co ngay. Chay nen, loi thi bo qua. */
export function warmUp(): void {
  (async () => {
    for (const l of config.languages) {
      if (l.code === config.sourceLang) continue;
      await new Promise((r) => setTimeout(r, WARMUP_GAP_MS)); // gian cach giua cac ngon ngu, tranh bi 429
      try {
        await getLocalized(l.code);
        console.log(`[poi-service] da dich san dataset sang ${l.code}`);
      } catch (e) {
        console.warn(`[poi-service] dich san ${l.code} that bai: ${(e as Error).message}`);
      }
    }
  })();
}

/** Audio thuyet minh cua 1 POI bang ngon ngu `lang` (mp3). */
export async function poiAudio(poiId: string, lang: string): Promise<Buffer> {
  const ds = await getLocalized(lang);
  const poi = ds.pois.find((p) => p.id === poiId);
  const t = poi?.translations[lang];
  if (!poi || !t) throw new AppError(404, 'POI_NOT_FOUND');
  const text = [t.name, t.description].filter(Boolean).join('. ');
  const r = await contentPost('/tts', { text, lang }, TTS_TIMEOUT_MS);
  return Buffer.from(await r.arrayBuffer());
}
