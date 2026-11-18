import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { ah, AppError } from '../common';
import { getBase, getLocalized, poiAudio, supportedLang } from '../services/localize';

export const datasetRouter = Router();

// Thay doi danh sach LANGUAGES (cau hinh) cung lam ETag doi -> app tai lai danh sach ngon ngu moi
const LANG_TAG = config.languages.map((l) => l.code).join('.');

// UC-T09: frontend tai dataset sau khi xac thuc, kem ?lang=<ma ngon ngu>.
// ETag = version + ngon ngu -> 304 neu app da co ban moi nhat cua dung ngon ngu do.
datasetRouter.get('/poi/dataset/latest', ah(async (req, res) => {
  const lang = supportedLang(req.query.lang ?? config.sourceLang);
  const b = await getBase();
  if (!b) throw new AppError(404, 'NO_PUBLISHED_DATASET', 'Admin has not published a dataset yet');

  let data;
  let translationFailed = false;
  try {
    data = await getLocalized(lang);
  } catch (e) {
    // Mat mang / Google chan: van tra ban tieng Viet de app khong trang man hinh. App tu hien ghi chu "chua co ban dich".
    console.warn(`[poi-service] dich ${lang} that bai, tra tieng Viet: ${(e as Error).message}`);
    data = await getLocalized(config.sourceLang);
    translationFailed = true;
  }

  const etag = `"v${b.version}-${lang}-${LANG_TAG}"`;
  res.setHeader('X-Dataset-Version', String(b.version));
  res.setHeader('Cache-Control', 'private, no-cache');
  if (!translationFailed) {
    res.setHeader('ETag', etag);
    if (req.header('if-none-match') === etag) return res.status(304).end();
  }
  res.json({ ...data, lang, languages: config.languages, translationFailed, etag: translationFailed ? null : etag });
}));

// Audio thuyet minh tao theo yeu cau (Edge-TTS qua content-service, co cache file ben do).
// App goi bang fetch kem token (the <audio src> khong gui duoc header Authorization).
datasetRouter.get('/poi/tts/:id', ah(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const lang = supportedLang(req.query.lang ?? config.sourceLang);
  const mp3 = await poiAudio(id, lang);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(mp3);
}));
