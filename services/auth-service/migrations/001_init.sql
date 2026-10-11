CREATE TABLE roles (
  id SMALLINT PRIMARY KEY,
  code VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL
);
INSERT INTO roles (id, code, name) VALUES
  (1, 'ADMIN', 'Quan tri vien'),
  (2, 'STAFF', 'Nhan vien quay'),
  (3, 'CONTENT_EDITOR', 'Bien tap noi dung');

CREATE TABLE staff_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(150) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role_id SMALLINT NOT NULL REFERENCES roles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_accounts(id),
  token_hash CHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE,                 -- ref logic: payment_orders.id
  auth_code_hash CHAR(64) UNIQUE,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('ONLINE','CASH')),
  status VARCHAR(12) NOT NULL CHECK (status IN ('PENDING','PAID','CONSUMED','EXPIRED','CANCELLED')),
  validity_hours INT NOT NULL,
  grant_expires_at TIMESTAMPTZ NOT NULL,
  created_by_staff_id UUID REFERENCES staff_accounts(id),
  paid_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_grants_status_expiry ON access_grants (status, grant_expires_at);

CREATE TABLE access_sessions (
  id UUID PRIMARY KEY,                           -- = jti cua JWT
  grant_id UUID NOT NULL UNIQUE REFERENCES access_grants(id),
  preferred_language VARCHAR(10),
  user_agent VARCHAR(300),
  ip_address INET,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(100)
);

CREATE TABLE signing_keys (
  kid VARCHAR(50) PRIMARY KEY,
  public_key_pem TEXT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ
);

CREATE TABLE auth_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_type VARCHAR(10) NOT NULL,
  actor_id UUID,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(30),
  entity_id VARCHAR(64),
  ip_address INET,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processed_events (
  event_id VARCHAR(100) PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
