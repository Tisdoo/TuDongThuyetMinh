import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { Router } from 'express';
import { z } from 'zod';
import { ah, AppError, randomCode, requireRole } from '../common';
import { pool, tx } from '../db';

/**
 * Chu dia diem (OWNER) tu quan ly POI cua minh.
 * - Chi thay/sua/xoa POI do chinh minh tao (loc theo owner_id = x-user-id do Gateway gan).
 * - Moi lan tao hoac sua: POI ve DRAFT + review_status PENDING, cho Admin/Bien tap duyet.
 * - Chu quan chi nhap noi dung tieng Viet; ban dich va audio duoc tao tu dong SAU KHI duyet.
 */
export const ownerRouter = Router();
ownerRouter.use('/poi/owner', requireRole('OWNER'));

// Anh: URL http(s) hoac duong dan noi bo do nginx phuc vu (VD /img/chanh-dien.jpg trong tools/tourist/img/)
const imageUrl = z.string().max(500).refine((v) => /^https?:\/\/\S+$/.test(v) || /^\/[A-Za-z0-9._~%\/-]+$/.test(v), 'Invalid image URL');
const MAX_POIS_PER_OWNER = 10;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const uuid = (v: unknown) => z.string().uuid().parse(v);

function ownerOf(req: any) {
  const id = req.header('x-user-id');
  if (!id) throw new AppError(401, 'MISSING_IDENTITY');
  return { id: uuid(id), name: String(req.header('x-user-name') ?? '').slice(0, 50) || null };
}

// Chu quan chon loai mon chinh cua quan (ma loai, khong dung id de khong phu thuoc thu tu INSERT trong CSDL)
const OWNER_CATEGORIES = ['SHOP', 'NOODLE', 'RICE', 'DIMSUM', 'DESSERT', 'DRINK', 'SNACK'] as const;

const OwnerPoi = z.object({
  categoryCode: z.enum(OWNER_CATEGORIES).default('SHOP'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  triggerRadiusM: z.number().int().min(10).max(60).default(25),
  thumbnailUrl: imageUrl.optional(),
  name: z.string().trim().min(2).max(200),
  shortDescription: z.string().trim().max(500).default(''),
  description: z.string().trim().min(20).max(3000),
});
type OwnerPoiInput = z.infer<typeof OwnerPoi>;

async function upsertVi(c: PoolClient, poiId: string, b: OwnerPoiInput) {
  await c.query(
    `INSERT INTO poi_translations (poi_id, lang_code, name, short_description, description, is_source,
                                   translation_origin, status, content_hash)
     VALUES ($1,'vi',$2,$3,$4,true,'SOURCE','TRANSLATED',$5)
     ON CONFLICT (poi_id, lang_code) DO UPDATE SET
       name=EXCLUDED.name, short_description=EXCLUDED.short_description, description=EXCLUDED.description,
       status='TRANSLATED', content_hash=EXCLUDED.content_hash, audio_url=NULL, audio_duration_sec=NULL,
       version=poi_translations.version+1, updated_at=now()`,
    [poiId, b.name, b.shortDescription, b.description, sha256(`${b.name}\n${b.shortDescription}\n${b.description}`)]);
}

const SELECT_OWN = `
  SELECT p.id, p.code, COALESCE(c.code, 'SHOP') AS category_code, p.latitude, p.longitude, p.trigger_radius_m, p.thumbnail_url, p.status,
         p.review_status, p.review_note, p.submitted_at, p.reviewed_at, p.created_at,
         COALESCE(t.name,'') AS name, COALESCE(t.short_description,'') AS short_description,
         COALESCE(t.description,'') AS description
    FROM pois p LEFT JOIN poi_translations t ON t.poi_id = p.id AND t.lang_code = 'vi'
                LEFT JOIN poi_categories c ON c.id = p.category_id
   WHERE p.owner_id = $1 AND p.status <> 'ARCHIVED'`;

ownerRouter.get('/poi/owner/pois', ah(async (req, res) => {
  const { rows } = await pool.query(SELECT_OWN + ' ORDER BY p.created_at DESC', [ownerOf(req).id]);
  res.json({ items: rows, limit: MAX_POIS_PER_OWNER });
}));

ownerRouter.get('/poi/owner/pois/:id', ah(async (req, res) => {
  const { rows } = await pool.query(SELECT_OWN + ' AND p.id = $2', [ownerOf(req).id, uuid(req.params.id)]);
  if (!rows[0]) throw new AppError(404, 'POI_NOT_FOUND');
  res.json(rows[0]);
}));

// Tao POI moi -> cho duyet
ownerRouter.post('/poi/owner/pois', ah(async (req, res) => {
  const me = ownerOf(req);
  const b = OwnerPoi.parse(req.body);
  const out = await tx(async (c) => {
    // khoa theo chu quan de 2 request song song khong vuot gioi han
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [me.id]);
    const n = (await c.query(`SELECT count(*)::int AS n FROM pois WHERE owner_id=$1 AND status <> 'ARCHIVED'`, [me.id])).rows[0].n;
    if (n >= MAX_POIS_PER_OWNER) throw new AppError(409, 'OWNER_POI_LIMIT', `Toi da ${MAX_POIS_PER_OWNER} dia diem`);
    let row: { id: string; code: string } | undefined;
    for (let i = 0; i < 5 && !row; i++) {
      row = (await c.query(
        `INSERT INTO pois (code, category_id, latitude, longitude, location, trigger_radius_m, thumbnail_url,
                           status, owner_id, owner_name, review_status, submitted_at, created_by, updated_by)
         VALUES ($1, (SELECT id FROM poi_categories WHERE code=$8), $2, $3,
                 ST_SetSRID(ST_MakePoint($3,$2),4326)::geography, $4, $5,
                 'DRAFT', $6, $7, 'PENDING', now(), $6, $6)
         ON CONFLICT (code) DO NOTHING RETURNING id, code`,
        [`OWN-${randomCode(6)}`, b.latitude, b.longitude, b.triggerRadiusM, b.thumbnailUrl ?? null, me.id, me.name, b.categoryCode])).rows[0];
    }
    if (!row) throw new AppError(500, 'CODE_GENERATION_FAILED');
    await upsertVi(c, row.id, b);
    return { ...row, reviewStatus: 'PENDING' };
  });
  res.status(201).json(out);
}));

// Sua POI cua minh -> quay ve cho duyet (POI dang hien tren app se an di toi khi duoc duyet lai)
ownerRouter.put('/poi/owner/pois/:id', ah(async (req, res) => {
  const me = ownerOf(req);
  const id = uuid(req.params.id);
  const b = OwnerPoi.parse(req.body);
  await tx(async (c) => {
    const cur = (await c.query(`SELECT status FROM pois WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, me.id])).rows[0];
    if (!cur || cur.status === 'ARCHIVED') throw new AppError(404, 'POI_NOT_FOUND');
    await c.query(
      `UPDATE pois SET latitude=$2, longitude=$3, location=ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,
              trigger_radius_m=$4, thumbnail_url=$5, category_id=(SELECT id FROM poi_categories WHERE code=$7), status='DRAFT', review_status='PENDING', review_note=NULL,
              reviewed_by=NULL, reviewed_at=NULL, submitted_at=now(), updated_by=$6, updated_at=now()
        WHERE id=$1`,
      [id, b.latitude, b.longitude, b.triggerRadiusM, b.thumbnailUrl ?? null, me.id, b.categoryCode]);
    await upsertVi(c, id, b);
    // noi dung goc doi -> ban dich may cu khong con dung, cho dich lai khi duyet
    await c.query(
      `UPDATE poi_translations SET status='PENDING', audio_url=NULL, audio_duration_sec=NULL, updated_at=now()
        WHERE poi_id=$1 AND lang_code <> 'vi' AND translation_origin <> 'HUMAN'`, [id]);
  });
  res.json({ id, reviewStatus: 'PENDING' });
}));

// Xoa (luu tru) POI cua minh
ownerRouter.delete('/poi/owner/pois/:id', ah(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE pois SET status='ARCHIVED', updated_at=now() WHERE id=$1 AND owner_id=$2 AND status <> 'ARCHIVED'`,
    [uuid(req.params.id), ownerOf(req).id]);
  if (!rowCount) throw new AppError(404, 'POI_NOT_FOUND');
  res.status(204).end();
}));
