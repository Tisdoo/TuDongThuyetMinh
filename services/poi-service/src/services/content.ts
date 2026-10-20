import { PoolClient } from 'pg';

/**
 * Xep job dich + TTS cho POI da co noi dung tieng Viet (poiId = null: moi POI chua ARCHIVED).
 * Khong ghi de ban dich tay (HUMAN), khong xep trung job dang QUEUED/RUNNING.
 * Dung chung cho nut "Dich va tao audio" va khi duyet POI cua chu quan.
 */
export async function queueContentJobs(c: PoolClient, poiId: string | null) {
  // 1) bao dam co dong ban dich (PENDING) cho moi ngon ngu dang bat
  await c.query(
    `INSERT INTO poi_translations (poi_id, lang_code, status, translation_origin)
     SELECT p.id, l.code, 'PENDING', 'MACHINE'
       FROM pois p JOIN languages l ON l.is_active AND l.code <> 'vi'
      WHERE ($1::uuid IS NULL OR p.id = $1) AND p.status <> 'ARCHIVED'
        AND EXISTS (SELECT 1 FROM poi_translations s WHERE s.poi_id = p.id AND s.lang_code = 'vi' AND s.name <> '')
     ON CONFLICT (poi_id, lang_code) DO NOTHING`, [poiId]);
  // 2) job DICH cho ban may chua dich hoac bi loi
  const tr = await c.query(
    `INSERT INTO content_jobs (translation_id, job_type)
     SELECT t.id, 'TRANSLATE' FROM poi_translations t
      WHERE ($1::uuid IS NULL OR t.poi_id = $1) AND t.lang_code <> 'vi'
        AND t.translation_origin = 'MACHINE' AND t.status IN ('PENDING', 'FAILED')
        AND NOT EXISTS (SELECT 1 FROM content_jobs j WHERE j.translation_id = t.id AND j.job_type = 'TRANSLATE' AND j.status IN ('QUEUED', 'RUNNING'))
     RETURNING id`, [poiId]);
  // 3) job TTS cho moi ban da co noi dung nhung chua co audio
  const tts = await c.query(
    `INSERT INTO content_jobs (translation_id, job_type)
     SELECT t.id, 'TTS' FROM poi_translations t
      WHERE ($1::uuid IS NULL OR t.poi_id = $1) AND t.status = 'TRANSLATED' AND t.audio_url IS NULL AND t.description <> ''
        AND NOT EXISTS (SELECT 1 FROM content_jobs j WHERE j.translation_id = t.id AND j.job_type = 'TTS' AND j.status IN ('QUEUED', 'RUNNING'))
     RETURNING id`, [poiId]);
  return { translateQueued: tr.rowCount ?? 0, ttsQueued: tts.rowCount ?? 0 };
}
