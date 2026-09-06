-- Retail Management Sprint1 DDL (PostgreSQL)
-- 単店舗起動を想定しつつ、将来の store_id 拡張を前提にした最小DDL

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE role_code AS ENUM ('OWNER', 'MANAGER', 'STAFF', 'VIEWER');
CREATE TYPE closing_status AS ENUM ('open', 'locked');
CREATE TYPE transaction_status AS ENUM ('pending', 'imported', 'posted', 'corrected', 'cancelled');
CREATE TYPE import_status AS ENUM ('received', 'processed', 'failed', 'retrying', 'duplicated');
CREATE TYPE pos_method AS ENUM ('card', 'cash', 'qr', 'other');
CREATE TYPE movement_type AS ENUM ('in', 'out', 'return_adjust', 'stocktake_adjust', 'transfer_in', 'transfer_out');
CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'approve', 'lock', 'unlock', 'retry');

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  currency TEXT NOT NULL DEFAULT 'JPY',
  tax_default_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id SMALLSERIAL PRIMARY KEY,
  code role_code UNIQUE NOT NULL,
  label TEXT NOT NULL
);

INSERT INTO roles(code, label)
VALUES
  ('OWNER','オーナー'),
  ('MANAGER','店長'),
  ('STAFF','スタッフ'),
  ('VIEWER','閲覧専用')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_roles_chk CHECK (valid_to IS NULL OR valid_to >= valid_from),
  UNIQUE(user_id, store_id, role_id, valid_from)
);

CREATE TABLE IF NOT EXISTS master_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('product_category','expense_category','payment_method','cost_type')),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  is_fixed_cost BOOLEAN DEFAULT FALSE,
  tax_rate NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain, name)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES master_categories(id),
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1000,
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '個',
  shelf_location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, sku)
);

CREATE TABLE IF NOT EXISTS pos_ingest_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  terminal_id TEXT,
  source_key TEXT NOT NULL,
  request_id TEXT,
  status import_status NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL,
  error_code TEXT,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, source_key)
);

CREATE TABLE IF NOT EXISTS sales_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_no TEXT NOT NULL,
  external_transaction_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  staff_id UUID REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_refund BOOLEAN NOT NULL DEFAULT FALSE,
  status transaction_status NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'pos_api',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, external_transaction_id),
  CONSTRAINT sales_amount_check CHECK (total_amount >= 0)
);

CREATE TABLE IF NOT EXISTS sales_transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_transaction_id UUID NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_transaction_id UUID NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  method_category_id UUID NOT NULL REFERENCES master_categories(id),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  on_hand_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserved_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMPTZ,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, product_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type movement_type NOT NULL,
  qty NUMERIC(12,2) NOT NULL,
  related_transaction_type TEXT,
  related_transaction_id TEXT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT non_zero_qty CHECK (qty <> 0)
);

CREATE TABLE IF NOT EXISTS corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sales_transaction_id UUID NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action audit_action NOT NULL,
  before_json JSONB,
  after_json JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  target_month TEXT NOT NULL,
  status closing_status NOT NULL DEFAULT 'open',
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, target_month)
);

CREATE INDEX IF NOT EXISTS idx_sales_transactions_store_occured
  ON sales_transactions (store_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_external
  ON sales_transactions (store_id, external_transaction_id);
CREATE INDEX IF NOT EXISTS idx_sales_transaction_items_tx
  ON sales_transaction_items (sales_transaction_id);
CREATE INDEX IF NOT EXISTS idx_sales_payments_tx
  ON sales_payments (sales_transaction_id);
CREATE INDEX IF NOT EXISTS idx_pos_ingest_store_status
  ON pos_ingest_logs (store_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_ingest_source_key
  ON pos_ingest_logs (store_id, source_key);
CREATE INDEX IF NOT EXISTS idx_audit_store_time
  ON audit_logs (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_store_active
  ON products (store_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_store
  ON inventory_stocks (store_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movement_store
  ON inventory_movements (store_id, product_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_tx
  ON corrections (store_id, sales_transaction_id);

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stores_updated_at BEFORE UPDATE ON stores
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_user_roles_updated_at BEFORE UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_master_categories_updated_at BEFORE UPDATE ON master_categories
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_pos_ingest_logs_updated_at BEFORE UPDATE ON pos_ingest_logs
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_sales_transactions_updated_at BEFORE UPDATE ON sales_transactions
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_inventory_stocks_updated_at BEFORE UPDATE ON inventory_stocks
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_inventory_movements_updated_at BEFORE UPDATE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_corrections_updated_at BEFORE UPDATE ON corrections
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_monthly_closings_updated_at BEFORE UPDATE ON monthly_closings
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

