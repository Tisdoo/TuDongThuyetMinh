CREATE TABLE ticket_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  price NUMERIC(12,0) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  validity_hours INT NOT NULL CHECK (validity_hours > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ticket_products (code, name, price, validity_hours)
VALUES ('DAY_PASS', 'Ve tham quan trong ngay', 20000, 12);

CREATE TABLE payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code VARCHAR(12) UNIQUE NOT NULL,
  product_id UUID NOT NULL REFERENCES ticket_products(id),
  amount NUMERIC(12,0) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  method VARCHAR(10) NOT NULL CHECK (method IN ('ONLINE','CASH')),
  status VARCHAR(12) NOT NULL CHECK (status IN ('CREATED','PENDING','PAID','FAILED','EXPIRED','CANCELLED')),
  language VARCHAR(10),
  client_ip INET,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_status_expiry ON payment_orders (status, expires_at);
CREATE INDEX idx_orders_paid_at ON payment_orders (paid_at);

CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES payment_orders(id),
  provider VARCHAR(20) NOT NULL,
  provider_txn_id VARCHAR(100) UNIQUE,
  payment_url TEXT,
  amount NUMERIC(12,0) NOT NULL,
  status VARCHAR(12) NOT NULL CHECK (status IN ('INITIATED','SUCCESS','FAILED')),
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_txn_order ON payment_transactions (order_id);

CREATE TABLE cash_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES payment_orders(id),
  staff_id UUID NOT NULL,                        -- ref logic: Auth.staff_accounts
  amount_received NUMERIC(12,0) NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note VARCHAR(255)
);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL,
  event_id VARCHAR(100) NOT NULL,
  payload JSONB,
  signature_valid BOOLEAN NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  note VARCHAR(200),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, event_id)
);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(30) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox_events (status, created_at);
