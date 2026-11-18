-- POI do Chu dia diem (OWNER) gui len, cho Admin/Bien tap duyet.
-- owner_id = id tai khoan trong auth_db (khac database nen khong co khoa ngoai).
-- POI cua chu quan luon o DRAFT cho toi khi duoc duyet; duyet xong -> PUBLISHED (van can bam Publish dataset).
ALTER TABLE pois
  ADD COLUMN owner_id UUID,
  ADD COLUMN owner_name VARCHAR(50),
  ADD COLUMN review_status VARCHAR(10) NOT NULL DEFAULT 'NONE'
    CHECK (review_status IN ('NONE','PENDING','APPROVED','REJECTED')),
  ADD COLUMN review_note VARCHAR(500),
  ADD COLUMN reviewed_by UUID,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN submitted_at TIMESTAMPTZ;

CREATE INDEX idx_pois_owner ON pois (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_pois_review ON pois (review_status, submitted_at) WHERE review_status = 'PENDING';

-- Loai POI cho quan / cua hang cua chu dia diem (id = 4 tren CSDL moi)
INSERT INTO poi_categories (code, color) VALUES ('SHOP', '#16a34a') ON CONFLICT (code) DO NOTHING;
