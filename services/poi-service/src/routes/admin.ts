import { createHash } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ah, AppError, requireRole } from '../common';
import { pool, tx } from '../db';
import { publishDataset } from '../services/builder';
import { queueContentJobs } from '../services/content';

export const adminRouter = Router();
adminRouter.use('/poi/admin', requireRole('ADMIN', 'CONTENT_EDITOR'));

const uuid = (v: unknown) => z.string().uuid().parse(v);
const actor = (req: any): string | null => req.header('x-user-id') ?? null;
// Anh: URL http(s) hoac duong dan noi bo do nginx phuc vu (VD /img/chanh-dien.jpg trong tools/tourist/img/)
const imageUrl = z.string().max(500).refine((v) => /^https?:\/\/\S+$/.test(v) || /^\/[A-Za-z0-9._~%\/-]+$/.test(v), 'Invalid image URL');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const PoiBody = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{2,30}$/),
  categoryId: z.number().int().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  triggerRadiusM: z.number().int().min(5).max(200).default(20),
  priority: z.number().int().min(0).max(100).default(0),
  displayOrder: z.number().int().default(0),
  thumbnailUrl: imageUrl.optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
});

// UC-A08: tao POI
adminRouter.post('/poi/admin/pois', ah(async (req, res) => {
  const b = PoiBody.parse(req.body);
  try {
    const { rows } = await pool.query(
      `INSERT INTO pois (code, category_id, latitude, longitude, location, trigger_radius_m, priority,
                         display_order, thumbnail_url, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, $5,$6,$7,$8,$9,$10,$10)
       RETURNING id, code`,
      [b.code, b.categoryId ?? null, b.latitude, b.longitude, b.triggerRadiusM, b.priority,
       b.displayOrder, b.thumbnailUrl ?? null, b.status, actor(req)]);
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw new AppError(409, 'POI_CODE_EXISTS');
    throw e;
  }
}));

adminRouter.get('/poi/admin/pois', ah(async (req, res) => {
  const status = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional().parse(req.query.status);
  const { rows } = await pool.query(
    `SELECT p.id, p.code, p.latitude, p.longitude, p.trigger_radius_m, p.priority, p.status,
            p.owner_name, p.review_status, COALESCE(t.name,'') AS name,
            (SELECT count(*)::int FROM poi_translations x WHERE x.poi_id=p.id AND x.status IN ('TRANSLATED','AUDIO_READY','REVIEWED')) AS translated_langs
       FROM pois p LEFT JOIN poi_translations t ON t.poi_id=p.id AND t.lang_code='vi'
      WHERE ($1::text IS NULL OR p.status=$1) ORDER BY p.display_order, p.code`, [status ?? null]);
  res.json(rows);
}));

adminRouter.get('/poi/admin/pois/:id', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const poi = (await pool.query('SELECT * FROM pois WHERE id=$1', [id])).rows[0];
  if (!poi) throw new AppError(404, 'POI_NOT_FOUND');
  const translations = (await pool.query('SELECT * FROM poi_translations WHERE poi_id=$1 ORDER BY lang_code', [id])).rows;
  const media = (await pool.query('SELECT * FROM poi_media WHERE poi_id=$1 ORDER BY display_order', [id])).rows;
  res.json({ ...poi, translations, media });
}));

adminRouter.put('/poi/admin/pois/:id', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const b = PoiBody.omit({ code: true }).parse(req.body);
  const { rowCount } = await pool.query(
    `UPDATE pois SET category_id=$2, latitude=$3, longitude=$4,
            location=ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,
            trigger_radius_m=$5, priority=$6, display_order=$7, thumbnail_url=$8, status=$9,
            updated_by=$10, updated_at=now()
      WHERE id=$1`,
    [id, b.categoryId ?? null, b.latitude, b.longitude, b.triggerRadiusM, b.priority, b.displayOrder,
     b.thumbnailUrl ?? null, b.status, actor(req)]);
  if (!rowCount) throw new AppError(404, 'POI_NOT_FOUND');
  res.status(204).end();
}));

// Luu tru thay vi xoa cung (dataset cu van tham chieu duoc)
adminRouter.delete('/poi/admin/pois/:id', ah(async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE pois SET status='ARCHIVED', updated_at=now() WHERE id=$1`, [uuid(req.params.id)]);
  if (!rowCount) throw new AppError(404, 'POI_NOT_FOUND');
  res.status(204).end();
}));

// UC-A09/A11: luu noi dung theo ngon ngu.
// - lang = vi: noi dung GOC -> tao/dat lai ban dich PENDING cho moi ngon ngu khac + xep hang doi job dich/TTS
// - lang khac: sua tay (HUMAN), khong bi pipeline ghi de
adminRouter.put('/poi/admin/pois/:id/translations/:lang', ah(async (req, res) => {
  const poiId = uuid(req.params.id);
  const lang = z.string().min(2).max(10).parse(req.params.lang);
  const b = z.object({
    name: z.string().min(1).max(200),
    shortDescription: z.string().max(500).default(''),
    description: z.string().min(1),
  }).parse(req.body);
  const hash = sha256(`${b.name}\n${b.shortDescription}\n${b.description}`);

  const out = await tx(async (c) => {
    const poi = await c.query('SELECT 1 FROM pois WHERE id=$1', [poiId]);
    if (!poi.rowCount) throw new AppError(404, 'POI_NOT_FOUND');
    const l = await c.query('SELECT 1 FROM languages WHERE code=$1 AND is_active', [lang]);
    if (!l.rowCount) throw new AppError(400, 'UNKNOWN_LANGUAGE');

    const isSource = lang === 'vi';
    await c.query(
      `INSERT INTO poi_translations (poi_id, lang_code, name, short_description, description, is_source,
                                     translation_origin, status, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'TRANSLATED',$8)
       ON CONFLICT (poi_id, lang_code) DO UPDATE SET
         name=EXCLUDED.name, short_description=EXCLUDED.short_description, description=EXCLUDED.description,
         translation_origin=EXCLUDED.translation_origin, status='TRANSLATED', content_hash=EXCLUDED.content_hash,
         audio_url=NULL, audio_duration_sec=NULL,
         version=poi_translations.version+1, updated_at=now()`,
      [poiId, lang, b.name, b.shortDescription, b.description, isSource, isSource ? 'SOURCE' : 'HUMAN', hash]);

    let queued = 0;
    if (isSource) {
      // Dat lai ban dich may (khong dong vao ban HUMAN) va xep job
      await c.query(
        `INSERT INTO poi_translations (poi_id, lang_code, status, translation_origin)
         SELECT $1, code, 'PENDING', 'MACHINE' FROM languages WHERE is_active AND code <> 'vi'
         ON CONFLICT (poi_id, lang_code) DO UPDATE SET status='PENDING'
           WHERE poi_translations.translation_origin <> 'HUMAN'`, [poiId]);
      const jobs = await c.query(
        `INSERT INTO content_jobs (translation_id, job_type)
         SELECT id, 'TRANSLATE' FROM poi_translations
          WHERE poi_id=$1 AND lang_code <> 'vi' AND status='PENDING' RETURNING id`, [poiId]);
      queued = jobs.rowCount ?? 0;
      // TTS cho chinh ban tieng Viet
      await c.query(
        `INSERT INTO content_jobs (translation_id, job_type)
         SELECT id, 'TTS' FROM poi_translations WHERE poi_id=$1 AND lang_code='vi'`, [poiId]);
    } else {
      await c.query(
        `INSERT INTO content_jobs (translation_id, job_type)
         SELECT id, 'TTS' FROM poi_translations WHERE poi_id=$1 AND lang_code=$2`, [poiId, lang]);
    }
    return { saved: true, translateJobsQueued: queued };
  });
  res.json(out);
}));

// Dich va tao audio cho POI DA CO san (khi vua bat worker, hoac muon tao lai). Khong ghi de ban dich tay.
adminRouter.post('/poi/admin/regenerate', ah(async (req, res) => {
  const b = z.object({ poiId: z.string().uuid().optional() }).parse(req.body ?? {});
  res.json(await tx((c) => queueContentJobs(c, b.poiId ?? null)));
}));

// ---------- Duyet POI do chu dia diem gui ----------
adminRouter.get('/poi/admin/owner-pois', ah(async (req, res) => {
  const review = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.review || undefined);
  const { rows } = await pool.query(
    `SELECT p.id, p.code, p.owner_id, p.owner_name, p.latitude, p.longitude, p.trigger_radius_m, p.thumbnail_url,
            p.status, p.review_status, p.review_note, p.submitted_at, p.reviewed_at,
            COALESCE(t.name,'') AS name, COALESCE(t.short_description,'') AS short_description,
            COALESCE(t.description,'') AS description
       FROM pois p LEFT JOIN poi_translations t ON t.poi_id = p.id AND t.lang_code = 'vi'
      WHERE p.owner_id IS NOT NULL AND p.status <> 'ARCHIVED' AND ($1::text IS NULL OR p.review_status = $1)
      ORDER BY (p.review_status = 'PENDING') DESC, p.submitted_at DESC LIMIT 200`, [review ?? null]);
  res.json(rows);
}));

// Duyet: POI -> PUBLISHED + xep dich/TTS. Van can bam Publish dataset de du khach thay.
adminRouter.post('/poi/admin/owner-pois/:id/approve', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const b = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
  const out = await tx(async (c) => {
    const p = (await c.query('SELECT review_status FROM pois WHERE id=$1 AND owner_id IS NOT NULL FOR UPDATE', [id])).rows[0];
    if (!p) throw new AppError(404, 'POI_NOT_FOUND');
    if (p.review_status !== 'PENDING') throw new AppError(409, 'ALREADY_REVIEWED', `POI is ${p.review_status}`);
    await c.query(
      `UPDATE pois SET review_status='APPROVED', status='PUBLISHED', review_note=$2, reviewed_by=$3, reviewed_at=now(),
              updated_by=$3, updated_at=now() WHERE id=$1`, [id, b.note ?? null, actor(req)]);
    return queueContentJobs(c, id);
  });
  res.json(out);
}));

adminRouter.post('/poi/admin/owner-pois/:id/reject', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const b = z.object({ note: z.string().trim().min(3).max(500) }).parse(req.body ?? {}); // bat buoc co ly do
  await tx(async (c) => {
    const p = (await c.query('SELECT review_status FROM pois WHERE id=$1 AND owner_id IS NOT NULL FOR UPDATE', [id])).rows[0];
    if (!p) throw new AppError(404, 'POI_NOT_FOUND');
    if (p.review_status !== 'PENDING') throw new AppError(409, 'ALREADY_REVIEWED', `POI is ${p.review_status}`);
    await c.query(
      `UPDATE pois SET review_status='REJECTED', status='DRAFT', review_note=$2, reviewed_by=$3, reviewed_at=now(),
              updated_at=now() WHERE id=$1`, [id, b.note, actor(req)]);
  });
  res.status(204).end();
}));

// Xem tien do pipeline dich/TTS
adminRouter.get('/poi/admin/jobs', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT status, job_type, count(*)::int AS n FROM content_jobs GROUP BY status, job_type ORDER BY status`);
  res.json(rows);
}));

// UC-A10 (ban toi gian): tao tour voi danh sach POI theo thu tu
adminRouter.post('/poi/admin/tours', ah(async (req, res) => {
  const b = z.object({
    code: z.string().regex(/^[A-Za-z0-9_-]{2,30}$/),
    names: z.record(z.string().min(1).max(150)),            // { vi: '...', en: '...' }
    poiIds: z.array(z.string().uuid()).min(1).max(30),
    estimatedDurationMin: z.number().int().positive().optional(),
    isDefault: z.boolean().default(false),
  }).parse(req.body);
  const out = await tx(async (c) => {
    const t = (await c.query(
      `INSERT INTO tours (code, estimated_duration_min, is_default, status) VALUES ($1,$2,$3,'PUBLISHED') RETURNING id`,
      [b.code, b.estimatedDurationMin ?? null, b.isDefault])).rows[0];
    for (const [l, name] of Object.entries(b.names))
      await c.query('INSERT INTO tour_translations (tour_id, lang_code, name) VALUES ($1,$2,$3)', [t.id, l, name]);
    for (let i = 0; i < b.poiIds.length; i++)
      await c.query('INSERT INTO tour_pois (tour_id, seq_no, poi_id) VALUES ($1,$2,$3)', [t.id, i + 1, b.poiIds[i]]);
    return { id: t.id };
  }).catch((e) => { if (e.code === '23505') throw new AppError(409, 'TOUR_CODE_OR_POI_DUPLICATE'); throw e; });
  res.status(201).json(out);
}));

// UC-A13: publish dataset (build bundle + version + checksum)
adminRouter.post('/poi/admin/publish', ah(async (req, res) => {
  res.status(201).json(await publishDataset(actor(req)));
}));

adminRouter.get('/poi/admin/dataset-versions', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT version_no, status, checksum, poi_count, language_count, published_at
       FROM dataset_versions ORDER BY version_no DESC LIMIT 20`);
  res.json(rows);
}));
