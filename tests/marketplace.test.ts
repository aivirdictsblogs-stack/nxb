import { describe, it, expect, beforeEach } from 'vitest';
import { Client, makeEnv, register, makeStaff, fund } from './helpers';
import { reconcile } from '../src/worker/lib/ledger';
import { encryptText } from '../src/worker/lib/crypto';

let env: any;
beforeEach(() => { env = makeEnv(); (globalThis as any).__mailbox = []; });
const buy = (c: Client, plan = 'pl-netflix-1', key = crypto.randomUUID(), extra: any = {}) =>
  c.req('POST', '/api/me/checkout', { plan_id: plan, contact_name: 'T U', contact_email: 'tu@example.com', contact_phone: '03001234567', inputs: {}, ...extra }, { 'idempotency-key': key });

describe('auth', () => {
  it('registers, logs out, logs in, rejects bad password, never leaks hash', async () => {
    const { c, email } = await register(env);
    expect((await c.get('/api/auth/me')).json.user.email).toBe(email);
    await c.post('/api/auth/logout'); c.csrf = '';
    expect((await c.get('/api/auth/me')).json.user).toBeNull();
    expect((await c.post('/api/auth/login', { email, password: 'wrong-password' })).status).toBe(401);
    const ok = await c.post('/api/auth/login', { email, password: 'Passw0rd!x', remember: true });
    expect(ok.status).toBe(200);
    expect(ok.text).not.toMatch(/password_hash|pbkdf2/);
  });
  it('sets HttpOnly Secure cookie and stores only a hashed token', async () => {
    const c = new Client(env);
    const r = await c.post('/api/auth/register', { full_name: 'A B', email: 'a@b.com', phone: '03001112222', password: 'Passw0rd!x', confirm_password: 'Passw0rd!x' });
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/Secure/); expect(sc).toMatch(/SameSite=Lax/);
    const tok = sc.match(/noorix_session=([^;]+)/)![1];
    const rows = env.DB.raw.prepare('SELECT token_hash FROM sessions').all();
    expect(rows.every((x: any) => x.token_hash !== tok)).toBe(true);
  });
  it('blocks mutating requests without CSRF token', async () => {
    const { c } = await register(env); c.csrf = '';
    expect((await c.req('PATCH', '/api/auth/profile', { full_name: 'New Name', phone: '03001234567' })).status).toBe(403);
  });
  it('rejects duplicate email and mismatched passwords', async () => {
    const { email } = await register(env);
    const c = new Client(env);
    expect((await c.post('/api/auth/register', { full_name: 'X Y', email, phone: '0300123456', password: 'Passw0rd!x', confirm_password: 'Passw0rd!x' })).status).toBe(409);
    expect((await c.post('/api/auth/register', { full_name: 'X Y', email: 'n@n.com', phone: '0300123456', password: 'Passw0rd!x', confirm_password: 'nope1234' })).status).toBe(400);
  });
  it('password reset: token single-use, old sessions revoked, no enumeration', async () => {
    const { c, email } = await register(env);
    const unknown = await c.post('/api/auth/forgot-password', { email: 'nobody@x.com' });
    expect(unknown.json.ok).toBe(true);
    await c.post('/api/auth/forgot-password', { email });
    const mail = (globalThis as any).__mailbox.find((m: any) => m.subject.includes('Reset'));
    const token = mail.text.split('token=')[1];
    expect((await new Client(env).post('/api/auth/reset-password', { token, password: 'NewPassw0rd!!' })).status).toBe(200);
    expect((await new Client(env).post('/api/auth/reset-password', { token, password: 'Another0ne!!' })).status).toBe(400);
    expect((await c.get('/api/auth/me')).json.user).toBeNull();
    expect((await new Client(env).post('/api/auth/login', { email, password: 'NewPassw0rd!!' })).status).toBe(200);
  });
  it('rate-limits repeated failed logins', async () => {
    const { email } = await register(env); const c = new Client(env); let last = 0;
    for (let i = 0; i < 10; i++) last = (await c.post('/api/auth/login', { email, password: 'bad-pass-word' })).status;
    expect(last).toBe(429);
  });
  it('email verification and change-password work', async () => {
    const { c, email } = await register(env);
    const t = (globalThis as any).__mailbox.find((m: any) => m.subject.includes('Verify')).text.split('token=')[1];
    expect((await c.post('/api/auth/verify-email', { token: t })).status).toBe(200);
    expect((await c.post('/api/auth/change-password', { current_password: 'Passw0rd!x', new_password: 'Brand#New123' })).status).toBe(200);
    expect((await new Client(env).post('/api/auth/login', { email, password: 'Brand#New123' })).status).toBe(200);
  });
  it('google sign-in is inactive without credentials', async () => {
    const c = new Client(env);
    expect((await c.get('/api/auth/providers')).json.google).toBe(false);
    expect((await c.get('/api/auth/oauth/google/start')).status).toBe(501);
  });
});

describe('catalog', () => {
  it('lists, searches, and shows product details without internals', async () => {
    const c = new Client(env);
    expect((await c.get('/api/products')).json.products.length).toBeGreaterThanOrEqual(6);
    expect((await c.get('/api/products?q=netflix')).json.products[0].slug).toBe('netflix-premium');
    const d = (await c.get('/api/products/netflix-premium')).json.product;
    expect(d.plans[0].price_minor).toBe(29900); expect(d.provider_id).toBeUndefined();
    expect((await c.get('/api/products/nope')).status).toBe(404);
  });
});

describe('deposits & wallet', () => {
  async function setupDeposit() {
    const fin = await makeStaff(env, 'finance_manager'); const sa = await makeStaff(env, 'super_admin');
    await sa.req('PATCH', '/api/admin/payment-methods/pm-ep', { is_active: true, account_number: '0300-0000000', account_title: 'Noorix' });
    const u = await register(env);
    const dep = await u.c.post('/api/me/deposits', { payment_method_id: 'pm-ep', amount_minor: 100000, payment_reference: 'TXN123456', proof_key: `proofs/${u.id}/x` });
    return { fin, sa, u, dep };
  }
  it('does not credit until approval; approval credits exactly once', async () => {
    const { fin, u, dep } = await setupDeposit();
    expect(dep.status).toBe(201);
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(0);
    expect((await fin.post(`/api/admin/deposits/${dep.json.id}/approve`)).status).toBe(200);
    expect((await fin.post(`/api/admin/deposits/${dep.json.id}/approve`)).status).toBe(409);
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(100000);
    expect((await reconcile(env.DB, u.id)).ok).toBe(true);
  });
  it('concurrent approvals credit only once', async () => {
    const { fin, u, dep } = await setupDeposit();
    await Promise.all([1, 2, 3].map(() => fin.post(`/api/admin/deposits/${dep.json.id}/approve`)));
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(100000);
  });
  it('rejected deposit never credits and cannot be approved later', async () => {
    const { fin, u, dep } = await setupDeposit();
    expect((await fin.post(`/api/admin/deposits/${dep.json.id}/reject`, { note: 'no such payment' })).status).toBe(200);
    expect((await fin.post(`/api/admin/deposits/${dep.json.id}/approve`)).status).toBe(409);
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(0);
  });
  it('rejects duplicate payment references, missing proof and foreign proof keys', async () => {
    const { u } = await setupDeposit();
    const o = await register(env);
    expect((await o.c.post('/api/me/deposits', { payment_method_id: 'pm-ep', amount_minor: 100000, payment_reference: 'TXN123456', proof_key: `proofs/${o.id}/y` })).status).toBe(409);
    expect((await u.c.post('/api/me/deposits', { payment_method_id: 'pm-ep', amount_minor: 100000, payment_reference: 'TXN9999' })).status).toBe(400);
    expect((await u.c.post('/api/me/deposits', { payment_method_id: 'pm-ep', amount_minor: 100000, payment_reference: 'TXN8888', proof_key: 'proofs/someone-else/z' })).status).toBe(400);
  });
  it('inactive (unconfigured) payment methods cannot be used', async () => {
    const u = await register(env);
    expect((await u.c.post('/api/me/deposits', { payment_method_id: 'pm-bank', amount_minor: 100000, payment_reference: 'TXN1111', proof_key: `proofs/${u.id}/x` })).status).toBe(400);
  });
  it('admin adjustments are audited, debits cannot overdraw, ledger is immutable', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env);
    await fund(env, fin, u.id, 50000);
    expect((await fin.post(`/api/admin/customers/${u.id}/wallet-adjust`, { direction: 'debit', amount_minor: 60000, reason: 'too much' })).status).toBe(400);
    expect((await fin.post(`/api/admin/customers/${u.id}/wallet-adjust`, { direction: 'debit', amount_minor: 20000, reason: 'correction' })).status).toBe(200);
    expect((await reconcile(env.DB, u.id))).toMatchObject({ balance: 30000, ledger: 30000, ok: true });
    expect(env.DB.raw.prepare(`SELECT COUNT(*) n FROM admin_audit_logs WHERE action='wallet.adjust'`).get().n).toBe(2);
    expect(() => env.DB.raw.exec(`UPDATE wallet_transactions SET amount_minor=1`)).toThrow(/immutable/);
    expect(() => env.DB.raw.exec(`DELETE FROM wallet_transactions`)).toThrow(/immutable/);
  });
});

describe('checkout & orders', () => {
  it('insufficient balance returns required amount and creates nothing', async () => {
    const u = await register(env);
    const r = await buy(u.c);
    expect(r.status).toBe(402); expect(r.json.required_minor).toBe(29900); expect(r.json.add_funds).toBe(true);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM orders').get().n).toBe(0);
  });
  it('debits wallet once, writes ledger, and is idempotent', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 100000);
    const key = crypto.randomUUID();
    const a = await buy(u.c, 'pl-netflix-1', key); const b = await buy(u.c, 'pl-netflix-1', key);
    expect(a.status).toBe(201); expect(b.json.duplicate).toBe(true);
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(70100);
    expect(env.DB.raw.prepare('SELECT COUNT(*) n FROM orders').get().n).toBe(1);
    expect((await reconcile(env.DB, u.id)).ok).toBe(true);
  });
  it('parallel duplicate submissions never double-charge', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 100000);
    const key = crypto.randomUUID();
    await Promise.all([1, 2, 3, 4].map(() => buy(u.c, 'pl-netflix-1', key)));
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(70100);
  });
  it('wallet never goes negative across racing different orders', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 40000);
    const rs = await Promise.all([1, 2, 3].map(() => buy(u.c)));
    expect(rs.filter(r => r.status === 201).length).toBe(1);
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(10100);
    expect((await reconcile(env.DB, u.id)).ok).toBe(true);
  });
  it('uses backend price and validates required product inputs', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 500000);
    expect((await buy(u.c, 'pl-ytp-1')).status).toBe(400);
    const ok = await buy(u.c, 'pl-ytp-1', crypto.randomUUID(), { inputs: { email: 'me@gmail.com' }, price_minor: 1 });
    expect(ok.status).toBe(201); expect(ok.json.order.total_minor).toBe(29900);
  });
  it('coupons apply discount once per user', async () => {
    const pm = await makeStaff(env, 'product_manager'); const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 500000);
    await pm.post('/api/admin/coupons', { code: 'SAVE10', type: 'percent', value: 10, max_uses: 5 });
    const a = await buy(u.c, 'pl-netflix-1', crypto.randomUUID(), { coupon_code: 'save10' });
    expect(a.json.order.total_minor).toBe(26910);
    expect((await buy(u.c, 'pl-netflix-1', crypto.randomUUID(), { coupon_code: 'SAVE10' })).status).toBe(400);
  });
  it('limited stock cannot be oversold', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 500000);
    env.DB.raw.exec(`UPDATE product_plans SET stock=1 WHERE id='pl-netflix-1'`);
    const rs = await Promise.all([buy(u.c), buy(u.c)]);
    expect(rs.filter(r => r.status === 201).length).toBe(1);
    expect((await buy(u.c)).status).toBe(409);
  });
  it('customers cannot read other customers\' orders; track requires matching email', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const a = await register(env); const b = await register(env); await fund(env, fin, a.id, 100000);
    const o = (await buy(a.c)).json.order;
    expect((await b.c.get(`/api/me/orders/${o.id}`)).status).toBe(404);
    expect((await new Client(env).get(`/api/track?order=${o.order_number}&email=wrong@x.com`)).status).toBe(404);
    const t = await new Client(env).get(`/api/track?order=${o.order_number}&email=tu@example.com`);
    expect(t.status).toBe(200); expect(JSON.stringify(t.json)).not.toMatch(/delivery|details/);
  });
  it('dashboard figures come from the database', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 100000); await buy(u.c);
    const d = (await u.c.get('/api/me/dashboard')).json;
    expect(d).toMatchObject({ wallet_balance_minor: 70100, total_orders: 1, pending_orders: 1, completed_orders: 0 });
  });
});

describe('delivery', () => {
  it('manual delivery: staff delivers, customer sees decrypted details, stored encrypted, others cannot see', async () => {
    const om = await makeStaff(env, 'order_manager'); const fin = await makeStaff(env, 'finance_manager');
    const u = await register(env); const other = await register(env); await fund(env, fin, u.id, 100000);
    const o = (await buy(u.c)).json.order;
    expect((await u.c.get(`/api/me/orders/${o.id}`)).json.delivery).toBeNull();
    expect((await om.post(`/api/admin/orders/${o.id}/deliver`, { details: 'user: x pass: y' })).status).toBe(200);
    expect((await om.post(`/api/admin/orders/${o.id}/deliver`, { details: 'again' })).status).toBe(409);
    const view = (await u.c.get(`/api/me/orders/${o.id}`)).json;
    expect(view.order.status).toBe('completed'); expect(view.delivery.details).toBe('user: x pass: y');
    expect(env.DB.raw.prepare('SELECT payload_encrypted p FROM order_deliveries').get().p).not.toContain('pass');
    expect((await other.c.get(`/api/me/orders/${o.id}`)).status).toBe(404);
    expect(env.DB.raw.prepare(`SELECT COUNT(*) n FROM notifications WHERE type='order_completed'`).get().n).toBe(1);
  });
  it('automatic delivery: inventory assigned once, never duplicated', async () => {
    const pm = await makeStaff(env, 'product_manager'); const fin = await makeStaff(env, 'finance_manager');
    const r = await pm.post('/api/admin/products', { category_id: 'cat-vpn', name: 'Test VPN', delivery_type: 'inventory', plans: [{ name: '1 Year', price_minor: 50000 }] });
    expect(r.status).toBe(201);
    const planId = env.DB.raw.prepare(`SELECT id FROM product_plans WHERE product_id=?`).get(env.DB.raw.prepare(`SELECT id FROM products WHERE slug=?`).get(r.json.slug).id).id;
    const add = await pm.post('/api/admin/inventory', { plan_id: planId, items: ['KEY-AAA', 'KEY-BBB'] });
    expect(add.status).toBe(201);
    expect(env.DB.raw.prepare('SELECT payload_encrypted p FROM product_inventory').get().p).not.toContain('KEY');
    const u1 = await register(env); const u2 = await register(env); const u3 = await register(env);
    for (const u of [u1, u2, u3]) await fund(env, fin, u.id, 100000);
    const rs = await Promise.all([buy(u1.c, planId), buy(u2.c, planId), buy(u3.c, planId)]);
    expect(rs.filter(x => x.status === 201).length).toBe(2);
    expect(rs.filter(x => x.status === 409).length).toBe(1);
    const got = [];
    for (const [u, x] of [[u1, rs[0]], [u2, rs[1]]] as any) if (x.status === 201) got.push((await u.c.get(`/api/me/orders/${x.json.order.id}`)).json);
    expect(new Set(got.map(g => g.delivery.details)).size).toBe(2);
    expect(got.every(g => g.order.status === 'completed')).toBe(true);
    expect(env.DB.raw.prepare(`SELECT COUNT(*) n FROM product_inventory WHERE status='sold'`).get().n).toBe(2);
  });
});

describe('refunds', () => {
  it('refund credits wallet exactly once, audited', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const om = await makeStaff(env, 'order_manager'); const u = await register(env); await fund(env, fin, u.id, 100000);
    const o = (await buy(u.c)).json.order;
    expect((await om.post(`/api/admin/orders/${o.id}/refund`, { reason: 'x y z' })).status).toBe(403);
    expect((await fin.post(`/api/admin/orders/${o.id}/refund`, { reason: 'customer request' })).status).toBe(200);
    expect((await fin.post(`/api/admin/orders/${o.id}/refund`, { reason: 'again please' })).status).toBe(409);
    expect((await u.c.get('/api/me/wallet')).json.balance_minor).toBe(100000);
    expect((await reconcile(env.DB, u.id)).ok).toBe(true);
    expect((await u.c.get(`/api/me/orders/${o.id}`)).json.order.payment_status).toBe('refunded');
  });
  it('cancel then refund flow', async () => {
    const fin = await makeStaff(env, 'finance_manager'); const om = await makeStaff(env, 'order_manager'); const u = await register(env); await fund(env, fin, u.id, 100000);
    const o = (await buy(u.c)).json.order;
    expect((await om.post(`/api/admin/orders/${o.id}/status`, { status: 'cancelled' })).status).toBe(200);
    expect((await om.post(`/api/admin/orders/${o.id}/deliver`, { details: 'x' })).status).toBe(409);
    expect((await fin.post(`/api/admin/orders/${o.id}/refund`, { reason: 'cancelled order' })).status).toBe(200);
  });
});

describe('tickets & notifications', () => {
  it('customer opens ticket, staff replies (internal notes hidden), customer is notified', async () => {
    const sup = await makeStaff(env, 'support_agent'); const u = await register(env); const other = await register(env);
    const t = (await u.c.post('/api/me/tickets', { category: 'Order', subject: 'Help me', message: 'Where is my order?' })).json;
    expect((await other.c.get(`/api/me/tickets/${t.id}`)).status).toBe(404);
    await sup.post(`/api/admin/tickets/${t.id}/reply`, { message: 'internal only', internal: true });
    await sup.post(`/api/admin/tickets/${t.id}/reply`, { message: 'On it!' });
    const v = (await u.c.get(`/api/me/tickets/${t.id}`)).json;
    expect(v.messages.map((m: any) => m.body)).toEqual(['Where is my order?', 'On it!']);
    expect(v.ticket.status).toBe('waiting_customer');
    await u.c.post(`/api/me/tickets/${t.id}/reply`, { message: 'thanks' });
    expect((await u.c.get(`/api/me/tickets/${t.id}`)).json.ticket.status).toBe('open');
    const n = (await u.c.get('/api/me/notifications')).json.notifications;
    expect(n.some((x: any) => x.type === 'support_reply')).toBe(true);
    await u.c.post('/api/me/notifications/read');
    expect((await u.c.get('/api/me/notifications')).json.notifications.every((x: any) => x.read_at)).toBe(true);
  });
});

describe('admin security & permissions', () => {
  it('first-run setup requires token, works once, then is disabled', async () => {
    const c = new Client(env); const body = { email: 'r@r.com', full_name: 'Root', password: 'SuperSecret#12345' };
    expect((await c.post('/api/setup/super-admin', body)).status).toBe(404);
    expect((await c.post('/api/setup/super-admin', body, { 'x-setup-token': 'wrong' })).status).toBe(404);
    expect((await c.post('/api/setup/super-admin', body, { 'x-setup-token': 'setup-secret-123' })).status).toBe(201);
    expect((await c.post('/api/setup/super-admin', { ...body, email: 'r2@r.com' }, { 'x-setup-token': 'setup-secret-123' })).status).toBe(410);
  });
  it('customers and anonymous users are blocked from /admin', async () => {
    await makeStaff(env, 'super_admin');
    expect((await new Client(env).get('/api/admin/dashboard')).status).toBe(401);
    const u = await register(env);
    expect((await u.c.get('/api/admin/dashboard')).status).toBe(403);
    expect((await u.c.get('/api/admin/deposits')).status).toBe(403);
  });
  it('role matrix is enforced', async () => {
    const pm = await makeStaff(env, 'product_manager'); const sup = await makeStaff(env, 'support_agent'); const fin = await makeStaff(env, 'finance_manager'); const om = await makeStaff(env, 'order_manager');
    const u = await register(env);
    expect((await pm.post(`/api/admin/customers/${u.id}/wallet-adjust`, { direction: 'credit', amount_minor: 100, reason: 'hack attempt' })).status).toBe(403);
    expect((await sup.get('/api/admin/deposits')).status).toBe(403);
    expect((await sup.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await fin.post('/api/admin/products', { category_id: 'cat-ai', name: 'X', plans: [{ name: 'a', price_minor: 1 }] })).status).toBe(403);
    expect((await om.req('PUT', '/api/admin/settings', { site_name: 'hacked' })).status).toBe(403);
    expect((await fin.post('/api/admin/staff', { email: 'e@e.com', full_name: 'Eve Eve', password: 'LongPassword#123', role_id: 'super_admin' })).status).toBe(403);
    expect((await fin.get('/api/admin/reports/sales.csv')).status).toBe(200);
    expect((await sup.get('/api/admin/reports/sales.csv')).status).toBe(403);
  });
  it('product management: create, edit price, disable hides it, archive, delete rules', async () => {
    const pm = await makeStaff(env, 'product_manager'); const pub = new Client(env);
    const r = await pm.post('/api/admin/products', { category_id: 'cat-ai', name: 'Gemini Pro', is_featured: true, plans: [{ name: '1 Month', price_minor: 99900, compare_at_minor: 150000 }] });
    expect(r.status).toBe(201);
    expect((await pub.get('/api/products/gemini-pro')).json.product.plans[0].price_minor).toBe(99900);
    const planId = (await pub.get('/api/products/gemini-pro')).json.product.plans[0].id;
    await pm.req('PATCH', `/api/admin/plans/${planId}`, { price_minor: 89900 });
    expect((await pub.get('/api/products/gemini-pro')).json.product.plans[0].price_minor).toBe(89900);
    await pm.req('PATCH', `/api/admin/products/${r.json.id}`, { status: 'disabled' });
    expect((await pub.get('/api/products/gemini-pro')).status).toBe(404);
    expect((await pm.req('DELETE', `/api/admin/products/${r.json.id}`)).status).toBe(200);
  });
  it('customer management: suspend blocks login and kills sessions', async () => {
    const sup = await makeStaff(env, 'support_agent'); const u = await register(env);
    expect((await sup.post(`/api/admin/customers/${u.id}/status`, { status: 'suspended' })).status).toBe(200);
    expect((await u.c.get('/api/auth/me')).json.user).toBeNull();
    expect((await new Client(env).post('/api/auth/login', { email: u.email, password: 'Passw0rd!x' })).status).toBe(403);
  });
  it('admin dashboard returns real aggregates; finance data hidden from order managers', async () => {
    const sa = await makeStaff(env, 'super_admin'); const fin = await makeStaff(env, 'finance_manager'); const om = await makeStaff(env, 'order_manager');
    const u = await register(env); await fund(env, fin, u.id, 100000); await buy(u.c);
    const d = (await sa.get('/api/admin/dashboard')).json;
    expect(d).toMatchObject({ total_orders: 1, pending_orders: 1, total_revenue_minor: 29900, wallet_liability_minor: 70100, total_customers: 1 });
    const od = (await om.get('/api/admin/dashboard')).json;
    expect(od.total_revenue_minor).toBeUndefined(); expect(od.wallet_liability_minor).toBeUndefined();
  });
  it('CSV export neutralises formula injection', async () => {
    const sa = await makeStaff(env, 'super_admin'); const fin = await makeStaff(env, 'finance_manager'); const u = await register(env); await fund(env, fin, u.id, 100000);
    env.DB.raw.exec(`UPDATE product_plans SET name='=HYPERLINK("x")' WHERE id='pl-netflix-1'`);
    await buy(u.c);
    expect((await sa.get('/api/admin/reports/sales.csv')).text).toContain(`"'=HYPERLINK`);
  });
});
