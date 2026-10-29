import { Router } from 'express';
import { z } from 'zod';
import { ah, AppError, requireRole } from '../common';
import { pool, tx } from '../db';
import { publishDataset } from '../services/builder';
import { warmUp } from '../services/localize';

export const adminRouter = Router();
adminRouter.use('/poi/admin', requireRole('ADMIN', 'CONTENT_EDITOR'));

const uuid = (v: unknown) => z.string().uuid().parse(v);
const actor = (req: any): string | null => req.header('x-user-id') ?? null;
// Anh: URL http(s) hoac duong dan noi bo do nginx phuc vu (VD /img/chanh-dien.jpg trong tools/tourist/img/)
const imageUrl = z.string().max(500).refine((v) => /^https?:\/\/\S+$/.test(v) || /^\/[A-Za-z0-9._~%\/-]+$/.test(v), 'Invalid image URL');

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
            p.owner_name, p.review_status, p.name
       FROM pois p
      WHERE ($1::text IS NULL OR p.status=$1) ORDER BY p.display_order, p.code`, [status ?? null]);
  res.json(rows);
}));

adminRouter.get('/poi/admin/pois/:id', ah(async (req, res) => {
  const id = uuid(req.params.id);
  // location (kieu GEOGRAPHY) khong can cho form, bo ra cho gon
  const poi = (await pool.query('SELECT * FROM pois WHERE id=$1', [id])).rows[0];
  if (!poi) throw new AppError(404, 'POI_NOT_FOUND');
  delete poi.location;
  res.json(poi);
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

// UC-A09: luu noi dung TIENG VIET cua POI. Cac ngon ngu khac duoc dich tu dong khi du khach chon (khong luu).
adminRouter.put('/poi/admin/pois/:id/content', ah(async (req, res) => {
  const poiId = uuid(req.params.id);
  const b = z.object({
    name: z.string().trim().min(1).max(200),
    shortDescription: z.string().trim().max(500).default(''),
    description: z.string().trim().min(1),
  }).parse(req.body);
  const { rowCount } = await pool.query(
    `UPDATE pois SET name=$2, short_description=$3, description=$4, updated_by=$5, updated_at=now() WHERE id=$1`,
    [poiId, b.name, b.shortDescription, b.description, actor(req)]);
  if (!rowCount) throw new AppError(404, 'POI_NOT_FOUND');
  res.json({ saved: true });
}));

// ---------- Duyet POI do chu dia diem gui ----------
adminRouter.get('/poi/admin/owner-pois', ah(async (req, res) => {
  const review = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.review || undefined);
  const { rows } = await pool.query(
    `SELECT p.id, p.code, p.owner_id, p.owner_name, p.latitude, p.longitude, p.trigger_radius_m, p.thumbnail_url,
            p.status, p.review_status, p.review_note, p.submitted_at, p.reviewed_at,
            p.name, p.short_description, p.description
       FROM pois p
      WHERE p.owner_id IS NOT NULL AND p.status <> 'ARCHIVED' AND ($1::text IS NULL OR p.review_status = $1)
      ORDER BY (p.review_status = 'PENDING') DESC, p.submitted_at DESC LIMIT 200`, [review ?? null]);
  res.json(rows);
}));

// Duyet: POI -> PUBLISHED. Van can bam Publish dataset de du khach thay (ban dich tao tu dong luc do).
adminRouter.post('/poi/admin/owner-pois/:id/approve', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const b = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
  await tx(async (c) => {
    const p = (await c.query('SELECT review_status FROM pois WHERE id=$1 AND owner_id IS NOT NULL FOR UPDATE', [id])).rows[0];
    if (!p) throw new AppError(404, 'POI_NOT_FOUND');
    if (p.review_status !== 'PENDING') throw new AppError(409, 'ALREADY_REVIEWED', `POI is ${p.review_status}`);
    await c.query(
      `UPDATE pois SET review_status='APPROVED', status='PUBLISHED', review_note=$2, reviewed_by=$3, reviewed_at=now(),
              updated_by=$3, updated_at=now() WHERE id=$1`, [id, b.note ?? null, actor(req)]);
  });
  res.json({ approved: true });
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

// Dashboard: so POI hien co (khong tinh POI da luu tru) va so POI an (DRAFT, du khach khong thay)
adminRouter.get('/poi/admin/stats', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE status <> 'ARCHIVED')::int AS total,
            count(*) FILTER (WHERE status = 'DRAFT')::int     AS hidden
       FROM pois`);
  res.json(rows[0]);
}));

// UC-A13: publish dataset (build bundle + version + checksum).
// Sau do dich san sang moi ngon ngu (chay nen) de du khach doi ngon ngu la co ngay.
adminRouter.post('/poi/admin/publish', ah(async (req, res) => {
  const out = await publishDataset(actor(req));
  warmUp();
  res.status(201).json(out);
}));

adminRouter.get('/poi/admin/dataset-versions', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT version_no, status, checksum, poi_count, language_count, published_at
       FROM dataset_versions ORDER BY version_no DESC LIMIT 20`);
  res.json(rows);
}));
