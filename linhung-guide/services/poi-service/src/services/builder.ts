import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { pool, tx } from '../db';

/** UC-S06: gom toan bo du lieu da PUBLISHED thanh 1 file dataset.json (frontend tai 1 lan duy nhat). */
export async function buildDataset() {
  const languages = (await pool.query(
    `SELECT code, name, native_name AS "nativeName" FROM languages WHERE is_active ORDER BY sort_order`)).rows;
  const categories = (await pool.query('SELECT id, code, icon_url AS "iconUrl", color FROM poi_categories')).rows;

  const pois = (await pool.query(
    `SELECT id, code, category_id AS "categoryId", latitude AS lat, longitude AS lng,
            trigger_radius_m AS "triggerRadiusM", priority, thumbnail_url AS "thumbnailUrl"
       FROM pois WHERE status='PUBLISHED' ORDER BY display_order, code`)).rows;
  const ids = pois.map((p) => p.id);

  const tr = ids.length ? (await pool.query(
    `SELECT poi_id, lang_code, name, short_description, description, audio_url, audio_duration_sec
       FROM poi_translations
      WHERE poi_id = ANY($1) AND (is_source OR status IN ('TRANSLATED','AUDIO_READY','REVIEWED'))`, [ids])).rows : [];
  const media = ids.length ? (await pool.query(
    `SELECT poi_id, url, caption FROM poi_media WHERE poi_id = ANY($1) ORDER BY display_order`, [ids])).rows : [];

  const poiOut = pois.map((p) => ({
    ...p,
    media: media.filter((m) => m.poi_id === p.id).map((m) => ({ url: m.url, caption: m.caption })),
    translations: Object.fromEntries(
      tr.filter((t) => t.poi_id === p.id).map((t) => [t.lang_code, {
        name: t.name, shortDescription: t.short_description, description: t.description,
        audioUrl: t.audio_url, audioDurationSec: t.audio_duration_sec,
      }])),
  }));

  const tours = (await pool.query(
    `SELECT id, code, estimated_duration_min AS "estimatedDurationMin", total_distance_m AS "totalDistanceM",
            is_default AS "isDefault", is_customizable AS "isCustomizable"
       FROM tours WHERE status='PUBLISHED'`)).rows;
  for (const t of tours) {
    const names = (await pool.query('SELECT lang_code, name, description FROM tour_translations WHERE tour_id=$1', [t.id])).rows;
    t.names = Object.fromEntries(names.map((n) => [n.lang_code, n.name]));
    t.descriptions = Object.fromEntries(names.map((n) => [n.lang_code, n.description]));
    t.pois = (await pool.query(
      `SELECT seq_no AS "seqNo", poi_id AS "poiId", suggested_stay_min AS "stayMin"
         FROM tour_pois WHERE tour_id=$1 ORDER BY seq_no`, [t.id])).rows;
    const segs = (await pool.query(
      `SELECT id, from_poi_id AS "fromPoiId", to_poi_id AS "toPoiId",
              ST_AsGeoJSON(path::geometry)::json AS geo, distance_m AS "distanceM", walking_time_sec AS "walkingTimeSec"
         FROM route_segments WHERE tour_id=$1`, [t.id])).rows;
    for (const s of segs) {
      const ins = (await pool.query('SELECT lang_code, instruction FROM route_segment_translations WHERE segment_id=$1', [s.id])).rows;
      s.instructions = Object.fromEntries(ins.map((i) => [i.lang_code, i.instruction]));
      // GeoJSON la [lng, lat]; frontend (Leaflet/MapLibre helper) can [lat, lng]
      s.path = s.geo ? s.geo.coordinates.map(([lng, lat]: number[]) => [lat, lng]) : [];
      delete s.geo; delete s.id;
    }
    t.segments = segs;
  }
  return { languages, categories, pois: poiOut, tours };
}

export async function publishDataset(publishedBy: string | null) {
  const next = ((await pool.query('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM dataset_versions')).rows[0].n) as number;
  await pool.query(`INSERT INTO dataset_versions (version_no, status) VALUES ($1,'BUILDING')`, [next]);
  try {
    const data = await buildDataset();
    const json = JSON.stringify({ version: next, generatedAt: new Date().toISOString(), ...data });
    const checksum = createHash('sha256').update(json).digest('hex');

    // Dev: ghi file local. Production: upload len Azure Blob/CDN va luu URL vao bundle_url.
    fs.mkdirSync(config.storageDir, { recursive: true });
    const file = path.join(config.storageDir, `dataset-v${next}.json`);
    fs.writeFileSync(file, json);

    await tx(async (c) => {
      await c.query(
        `UPDATE dataset_versions SET status='PUBLISHED', bundle_url=$2, checksum=$3, poi_count=$4,
                language_count=$5, published_by=$6, published_at=now() WHERE version_no=$1`,
        [next, file, checksum, data.pois.length, data.languages.length, publishedBy]);
      // Chatbot Service se nghe event nay de nap lai vector index (can outbox publisher nhu payment-service)
      await c.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         SELECT 'dataset', id, 'DatasetPublished', $2::jsonb FROM dataset_versions WHERE version_no=$1`,
        [next, JSON.stringify({ version: next, checksum })]);
    });
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
