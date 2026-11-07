-- Noorix Digital Lab schema. All money = integer minor units (paisa). Timestamps = unix seconds.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Provider-based identities (Google etc.). Separate from users so accounts can link safely.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, provider_email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, provider TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT);
CREATE TABLE IF NOT EXISTS permissions (id TEXT PRIMARY KEY, description TEXT);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, image_key TEXT,
  description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES product_categories(id),
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, image_key TEXT,
  short_description TEXT, full_description TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','archived')),
  is_featured INTEGER NOT NULL DEFAULT 0, is_trending INTEGER NOT NULL DEFAULT 0, is_deal INTEGER NOT NULL DEFAULT 0,
  delivery_type TEXT NOT NULL DEFAULT 'manual' CHECK (delivery_type IN ('manual','inventory','api')),
  input_fields TEXT NOT NULL DEFAULT '[]',
  delivery_instructions TEXT, refund_policy TEXT, terms TEXT,
  provider_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id, status);
CREATE TABLE IF NOT EXISTS product_plans (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, duration TEXT,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  compare_at_minor INTEGER CHECK (compare_at_minor IS NULL OR compare_at_minor >= 0),
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  is_available INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  provider_sku TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_plans_product ON product_plans(product_id);
CREATE TABLE IF NOT EXISTS product_inventory (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES product_plans(id) ON DELETE CASCADE,
  payload_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','void')),
  order_id TEXT UNIQUE, sold_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_inv_avail ON product_inventory(plan_id, status);
CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Immutable ledger: signed amount_minor (+credit / -debit)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('deposit','purchase','refund','admin_credit','admin_debit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  balance_after_minor INTEGER NOT NULL CHECK (balance_after_minor >= 0),
  ref_type TEXT, ref_id TEXT, description TEXT, actor_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_wtx_user ON wallet_transactions(user_id, created_at);
CREATE TRIGGER IF NOT EXISTS wallet_tx_no_update BEFORE UPDATE ON wallet_transactions BEGIN SELECT RAISE(ABORT,'ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wallet_tx_no_delete BEFORE DELETE ON wallet_transactions BEGIN SELECT RAISE(ABORT,'ledger is immutable'); END;
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  instructions TEXT, account_title TEXT, account_number TEXT,
  min_amount_minor INTEGER NOT NULL DEFAULT 10000, max_amount_minor INTEGER,
  requires_proof INTEGER NOT NULL DEFAULT 1, is_automatic INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  payment_reference TEXT NOT NULL, proof_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT REFERENCES users(id), reviewed_at INTEGER, review_note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (payment_method_id, payment_reference)
);
CREATE INDEX IF NOT EXISTS idx_dep_status ON deposits(status, created_at);
CREATE INDEX IF NOT EXISTS idx_dep_user ON deposits(user_id);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT,
  processed_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider, event_id)
);
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')), value INTEGER NOT NULL CHECK (value > 0),
  max_uses INTEGER, used_count INTEGER NOT NULL DEFAULT 0,
  min_order_minor INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
  CHECK (max_uses IS NULL OR used_count <= max_uses)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('pending','processing','completed','cancelled','refunded','failed')),
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  subtotal_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL,
  coupon_id TEXT REFERENCES coupons(id),
  contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  timeline TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id), plan_id TEXT NOT NULL REFERENCES product_plans(id),
  product_name TEXT NOT NULL, plan_name TEXT NOT NULL, delivery_type TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  customer_inputs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS order_deliveries (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL, payload_encrypted TEXT NOT NULL, note TEXT,
  delivered_by TEXT REFERENCES users(id), delivered_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  user_id TEXT NOT NULL REFERENCES users(id), amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT, issued_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id),
  user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, ticket_number TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL, subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  assigned_to TEXT REFERENCES users(id), order_id TEXT REFERENCES orders(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id), is_staff INTEGER NOT NULL DEFAULT 0,
  is_internal INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, attachment_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_msgs_ticket ON support_messages(ticket_id);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  read_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
CREATE TABLE IF NOT EXISTS homepage_banners (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT, image_key TEXT, link_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  details TEXT, ip TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at);
CREATE TABLE IF NOT EXISTS provider_integrations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
  secret_name TEXT,
  auth_header TEXT NOT NULL DEFAULT 'Authorization', auth_scheme TEXT NOT NULL DEFAULT 'Bearer',
  create_path TEXT NOT NULL DEFAULT '/orders', status_path TEXT,
  request_template TEXT NOT NULL DEFAULT '{}', response_map TEXT NOT NULL DEFAULT '{}',
  max_retries INTEGER NOT NULL DEFAULT 3, is_active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS provider_order_logs (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES provider_integrations(id),
  order_id TEXT NOT NULL REFERENCES orders(id), attempt INTEGER NOT NULL DEFAULT 1,
  request_summary TEXT, response_status INTEGER, response_body TEXT, ok INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
