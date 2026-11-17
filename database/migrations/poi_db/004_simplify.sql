-- Rut gon poi_db: chi luu noi dung TIENG VIET ngay trong bang pois.
-- Ban dich cac ngon ngu khac va audio duoc content-service tao THEO YEU CAU (khong luu CSDL).
--
-- Truoc khi chay tren du lieu that, nen sao luu:
--   docker compose exec postgres pg_dump -U postgres -d poi_db > poi_db_backup.sql

-- 1) Them 3 cot noi dung tieng Viet vao pois
ALTER TABLE pois
  ADD COLUMN IF NOT EXISTS name VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS short_description VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- 2) Chep noi dung tieng Viet hien co sang (ban dich cac ngon ngu khac bi bo, se dich lai tu dong)
--    (chi chay khi bang con ton tai: chay lai file nay lan 2 cung khong loi)
DO $$
BEGIN
  IF to_regclass('public.poi_translations') IS NOT NULL THEN
    UPDATE pois p
       SET name = t.name, short_description = t.short_description, description = t.description
      FROM poi_translations t
     WHERE t.poi_id = p.id AND t.lang_code = 'vi';
  END IF;
END $$;

-- 3) Xoa 10 bang khong con dung (xoa cung luc trong 1 lenh nen khong vuong khoa ngoai giua chung)
--    - poi_translations, content_jobs, languages: thay bang dich/doc theo yeu cau + cau hinh LANGUAGES
--    - tours, tour_translations, tour_pois, route_segments, route_segment_translations: chua giao dien nao dung
--    - poi_media: khong co cho nao ghi du lieu (da co pois.thumbnail_url)
--    - outbox_events: co ghi su kien nhung khong tien trinh nao doc
DROP TABLE IF EXISTS
  content_jobs, route_segment_translations, route_segments, tour_pois, tour_translations, tours,
  poi_media, poi_translations, outbox_events, languages;
