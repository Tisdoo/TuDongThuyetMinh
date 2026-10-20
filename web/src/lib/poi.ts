import type { Dataset, Language, Poi, PoiTranslation } from '../api/types';
import { LANGS } from '../i18n';

/** Lấy nội dung POI theo ngôn ngữ; thiếu bản dịch thì rơi về en, rồi vi, rồi bất kỳ. */
export function poiContent(poi: Poi, lang: string): { c: PoiTranslation | null; code: string | null; fallback: boolean } {
  const tr = poi.translations ?? {};
  if (tr[lang]?.name) return { c: tr[lang], code: lang, fallback: false };
  const code = tr.en?.name ? 'en' : tr.vi?.name ? 'vi' : Object.keys(tr)[0] ?? null;
  return { c: code ? tr[code] : null, code, fallback: true };
}

export const poiName = (poi: Poi, lang: string) => poiContent(poi, lang).c?.name ?? poi.code;

/** Văn bản đưa vào giọng đọc: tên + mô tả (mô tả ngắn nếu chưa có mô tả dài). */
export function narrationText(c: PoiTranslation): string {
  return [c.name, c.description || c.shortDescription].filter(Boolean).join('. ');
}

export function languageName(code: string, languages: Language[] | undefined): string {
  const l = LANGS.find((x) => x.code === code) ?? languages?.find((x) => x.code === code);
  return l ? l.nativeName || l.name : code;
}

/** Mã loại điểm (STATUE, HALL, FACILITY, SHOP...) để chọn hình minh họa và bộ lọc. */
export function categoryOf(poi: Poi, ds: Dataset | null): string {
  return ds?.categories.find((c) => c.id === poi.categoryId)?.code ?? 'OTHER';
}
