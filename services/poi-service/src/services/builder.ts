import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { pool } from '../db';

export interface PoiText { name: string; shortDescription: string; description: string; audioUrl?: string }
export interface DatasetPoi {
  id: string; code: string; categoryId: number | null; lat: number; lng: number;
  triggerRadiusM: number; priority: number; thumbnailUrl: string | null;
  media: { url: string; caption: string | null }[];
  translations: Record<string, PoiText>;
}
export interface Dataset {
  version: number; generatedAt: string;
  categories: { id: number; code: string; iconUrl: string | null; color: string | null }[];
  pois: DatasetPoi[];
  tours: unknown[];
}

/**
 * UC-S06: gom moi POI da PUBLISHED thanh 1 file dataset-vN.json.
 * File chi chua TIENG VIET (ngon ngu goc). Ngon ngu khac duoc dich luc khach yeu cau (xem localize.ts).
 * Giu nguyen cau truc JSON cu (translations, media, tours) de web app du khach khong phai doi cach doc.
 */
export async function buildDataset(version: number): Promise<Dataset> {
  const categories = (await pool.query(
    'SELECT id, code, icon_url AS "iconUrl", color FROM poi_categories ORDER BY id')).rows;
  const rows = (await pool.query(
    `SELECT id, code, category_id AS "categoryId", latitude AS lat, longitude AS lng,
            trigger_radius_m AS "triggerRadiusM", priority, thumbnail_url AS "thumbnailUrl",
            name, short_description, description
       FROM pois
      WHERE status = 'PUBLISHED' AND name <> ''
      ORDER BY display_order, code`)).rows;
  const pois: DatasetPoi[] = rows.map(({ name, short_description, description, ...p }: any) => ({
    ...p,
    media: [],
    translations: { [config.sourceLang]: { name, shortDescription: short_description, description } },
  }));
  return { version, generatedAt: new Date().toISOString(), categories, pois, tours: [] };
}

export async function publishDataset(publishedBy: string | null) {
  const next = ((await pool.query('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM dataset_versions')).rows[0].n) as number;
  await pool.query(`INSERT INTO dataset_versions (version_no, status) VALUES ($1,'BUILDING')`, [next]);
  try {
    const data = await buildDataset(next);
    const json = JSON.stringify(data);
    const checksum = createHash('sha256').update(json).digest('hex');

    // Dev: ghi file local. Production: upload len Azure Blob/CDN va luu URL vao bundle_url.
    fs.mkdirSync(config.storageDir, { recursive: true });
    const file = path.join(config.storageDir, `dataset-v${next}.json`);
    fs.writeFileSync(file, json);

    await pool.query(
      `UPDATE dataset_versions SET status='PUBLISHED', bundle_url=$2, checksum=$3, poi_count=$4,
              language_count=$5, published_by=$6, published_at=now() WHERE version_no=$1`,
      [next, file, checksum, data.pois.length, config.languages.length, publishedBy]);
    return { version: next, checksum, poiCount: data.pois.length };
  } catch (e) {
    await pool.query(`UPDATE dataset_versions SET status='FAILED' WHERE version_no=$1`, [next]);
    throw e;
  }
}

export async function latestPublished() {
  const { rows } = await pool.query(
    `SELECT version_no, bundle_url, checksum FROM dataset_versions
      WHERE status='PUBLISHED' ORDER BY version_no DESC LIMIT 1`);
  return rows[0] as { version_no: number; bundle_url: string; checksum: string } | undefined;
}
