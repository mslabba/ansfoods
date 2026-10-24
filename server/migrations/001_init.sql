-- ANS Foods e-commerce schema
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Key/value store for admin-editable settings (Cashfree keys, SMTP, alerts).
-- Nothing secret is hardcoded; everything lives here and is edited in /admin/.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  district TEXT NOT NULL,
  pincode TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                      -- display id: ANS-YYYYMMDD-XXXX
  customer_id INT REFERENCES customers(id),
  items JSONB NOT NULL,                     -- [{id, name, qty, price_paise}]
  amount_paise INT NOT NULL,                -- server-computed, never trusted from client
  currency TEXT NOT NULL DEFAULT 'INR',
  method TEXT NOT NULL,                     -- 'cod' | 'online'
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | confirmed | paid | failed | cancelled | shipped
  cf_order_id TEXT,                         -- Cashfree order id (no hyphens)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  gateway TEXT NOT NULL DEFAULT 'cashfree',
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  amount_paise INT NOT NULL,
  status TEXT NOT NULL,                     -- initiated | success | failed
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
