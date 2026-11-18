import 'dotenv/config';
import path from 'path';

// Ten hien thi cua cac ngon ngu hay dung. Ma khong co trong bang nay van dung duoc (hien bang chinh ma).
const LANGUAGE_NAMES: Record<string, { name: string; nativeName: string }> = {
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  en: { name: 'English', nativeName: 'English' },
  'zh-CN': { name: 'Chinese (Simplified)', nativeName: '中文' },
  'zh-TW': { name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  ja: { name: 'Japanese', nativeName: '日本語' },
  ko: { name: 'Korean', nativeName: '한국어' },
  fr: { name: 'French', nativeName: 'Français' },
  de: { name: 'German', nativeName: 'Deutsch' },
  es: { name: 'Spanish', nativeName: 'Español' },
  ru: { name: 'Russian', nativeName: 'Русский' },
  th: { name: 'Thai', nativeName: 'ไทย' },
};

// LANGUAGES=vi,en,ja ... (tieng Viet luon co va dung dau vi la ngon ngu goc)
const codes = (process.env.LANGUAGES ?? 'vi,en,zh-CN,ja,ko,fr')
  .split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/.test(s));
const ordered = ['vi', ...codes.filter((c) => c !== 'vi')];

export const config = {
  port: Number(process.env.PORT ?? 4003),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/poi_db',
  // Dev: luu bundle tren dia. Production: thay bang Azure Blob + CDN (xem builder.ts)
  storageDir: process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage', 'datasets'),
  // Service dich + doc audio (mang noi bo)
  contentUrl: process.env.CONTENT_URL ?? 'http://localhost:4005',
  sourceLang: 'vi',
  languages: [...new Set(ordered)].map((code) => ({ code, ...(LANGUAGE_NAMES[code] ?? { name: code, nativeName: code }) })),
};
