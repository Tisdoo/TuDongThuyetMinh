-- Vai tro Chu dia diem (OWNER) va don dang ky tu phuc vu
INSERT INTO roles (id, code, name) VALUES (4, 'OWNER', 'Chu dia diem') ON CONFLICT (id) DO NOTHING;

CREATE TABLE owner_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES staff_accounts(id),
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  email VARCHAR(150),
  business_name VARCHAR(150) NOT NULL,
  address VARCHAR(255),
  note VARCHAR(500),
  id_number_enc TEXT,                 -- so CCCD, ma hoa AES-256-GCM (tien to v1:)
  id_masked VARCHAR(20),              -- chi hien 3 so cuoi, VD *********123
  pii_redacted_at TIMESTAMPTZ,        -- thoi diem tu dong xoa CCCD sau 180 ngay
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  admin_note VARCHAR(500),
  reviewed_by UUID REFERENCES staff_accounts(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_owner_reg_status ON owner_registrations (status, created_at);
