-- Chuyen chu de sang "Thuyet minh quan an Quan 5": them cac loai POI am thuc.
-- Dat id co dinh (11..16) de trang Admin va file CSV dung so loai on dinh tren moi CSDL.
-- Cac loai cu (STATUE, HALL, FACILITY, SHOP) van giu lai de POI cu khong bi mat loai.
INSERT INTO poi_categories (id, code, color) VALUES
  (11, 'NOODLE',  '#c2410c'),  -- Mi, hu tieu, bun, pho
  (12, 'RICE',    '#a16207'),  -- Com, chao
  (13, 'DIMSUM',  '#b91c1c'),  -- Dimsum, diem tam, ha cao, xiu mai
  (14, 'DESSERT', '#db2777'),  -- Che, tau hu, banh ngot
  (15, 'DRINK',   '#0f766e'),  -- Tra, sam bo luong, nuoc mia
  (16, 'SNACK',   '#7c3aed')   -- An vat, banh bao, sui cao
ON CONFLICT DO NOTHING;

-- Vi chen id thu cong nen phai day sequence len, neu khong lan INSERT tu dong tiep theo se trung id.
SELECT setval(pg_get_serial_sequence('poi_categories', 'id'), (SELECT MAX(id) FROM poi_categories));
