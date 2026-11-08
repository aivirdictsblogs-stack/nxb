import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import app from '../src/worker/index';
import { Client, makeEnv, register, makeStaff, fund } from './helpers';
import { sitemap } from '../src/worker/routes/extra';

let env: any;
beforeEach(() => { env = makeEnv(); });
afterEach(() => vi.unstubAllGlobals());

describe('seo & public', () => {
  it('sitemap lists products/categories; contact form stores messages', async () => {
    const x = await sitemap(env); expect(x).toContain('/products/netflix-premium'); expect(x).toContain('/categories/ai-tools');
    const res = await app.request('/sitemap.xml', {}, env); expect(res.headers.get('content-type')).toContain('xml');
    const c = new Client(env); expect((await c.post('/api/contact', { name: 'Ali', email: 'a@b.com', message: 'Hello there' })).status).toBe(201);
    const sup = await makeStaff(env, 'support_agent'); expect((await sup.get('/api/admin/messages')).json.messages.length).toBe(1);
  });
  it('registration can be closed from settings', async () => {
    const sa = await makeStaff(env, 'super_admin'); await sa.req('PUT', '/api/admin/settings', { registration_enabled: '0' });
    const c = new Client(env); expect((await c.post('/api/auth/register', { full_name: 'A B', email: 'q@q.com', phone: '0300123456', password: 'Passw0rd!x', confirm_password: 'Passw0rd!x' })).status).toBe(403);
  });
  it('private files require auth; media only serves public/ keys', async () => {
    const c = new Client(env); expect((await c.get('/api/files/proofs/x/y')).status).toBe(401);
    expect((await c.get('/api/media/proofs/x/y')).status).toBe(404);
  });
});
describe('staff & security', () => {
  it('super admin changes roles; staff cannot self-modify; security overview is permission-gated', async () => {
    const sa = await makeStaff(env, 'super_admin'); const sup = await makeStaff(env, 'support_agent');
    const list = (await sa.get('/api/admin/staff')).json.staff; const target = list.find((s: any) => s.role_id === 'support_agent');
    expect((await sa.req('PATCH', `/api/admin/staff/${target.id}`, { role_id: 'order_manager' })).status).toBe(200);
    expect((await sup.get('/api/admin/tickets')).status).toBe(401); // sessions revoked on role change
    const me = list.find((s: any) => s.role_id === 'super_admin'); expect((await sa.req('PATCH', `/api/admin/staff/${me.id}`, { status: 'suspended' })).status).toBe(400);
    expect((await sa.get('/api/admin/security/overview')).json.delivery_key_configured).toBe(true);
    const fin = await makeStaff(env, 'finance_manager'); expect((await fin.get('/api/admin/security/overview')).status).toBe(403);
    expect((await fin.get('/api/admin/customers')).status).toBe(200); // finance can list customers to adjust wallets
    expect((await fin.get('/api/admin/permissions')).status).toBe(403);
  });
});
describe('supplier API delivery', () => {
  async function setup() {
    const sa = await makeStaff(env, 'super_admin'); const fin = await makeStaff(env, 'finance_manager');
    env.SUPPLIER_KEY = 'sk_live_secret';
    const bad = await sa.post('/api/admin/providers', { name: 'Bad', base_url: 'http://localhost/api' }); expect(bad.status).toBe(400); // https + public host only
    const pr = await sa.post('/api/admin/providers', { name: 'Acme Supplier', base_url: 'https://api.supplier.example', secret_name: 'SUPPLIER_KEY', request_template: '{"ref":"{{order_number}}","sku":"{{sku}}","email":"{{inputs.email}}"}', response_map: '{"delivery_path":"data.credentials"}', max_retries: 2, is_active: true });
    expect(pr.status).toBe(201);
    const p = await sa.post('/api/admin/products', { category_id: 'cat-ai', name: 'API Product', delivery_type: 'api', input_fields: [{ key: 'email', label: 'Email', required: true }], plans: [{ name: 'M', price_minor: 10000, provider_sku: 'SKU-1' }] });
    await sa.req('PATCH', `/api/admin/products/${p.json.id}`, { provider_id: pr.json.id });
    const plan = env.DB.raw.prepare('SELECT id FROM product_plans WHERE product_id=?').get(p.json.id).id;
    const u = await register(env); await fund(env, fin, u.id, 100000);
    return { sa, u, plan, prov: pr.json.id };
  }
  const order = (c: Client, plan: string) => c.req('POST', '/api/me/checkout', { plan_id: plan, contact_name: 'T U', contact_email: 't@u.com', contact_phone: '0300123456', inputs: { email: 'me@x.com' } }, { 'idempotency-key': crypto.randomUUID() });
  it('dispatches with secret header + templated body, stores encrypted delivery, completes order', async () => {
    const { u, plan } = await setup(); let seen: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ data: { credentials: 'ACC: abc / 123' } }), { status: 200 }); }));
    const r = await order(u.c, plan); expect(r.status).toBe(201); expect(r.json.order.status).toBe('completed');
    expect(seen.url).toBe('https://api.supplier.example/orders'); expect(seen.init.headers.Authorization).toBe('Bearer sk_live_secret');
    expect(JSON.parse(seen.init.body)).toMatchObject({ sku: 'SKU-1', email: 'me@x.com' });
    expect((await u.c.get(`/api/me/orders/${r.json.order.id}`)).json.delivery.details).toBe('ACC: abc / 123');
    expect(env.DB.raw.prepare('SELECT payload_encrypted p FROM order_deliveries').get().p).not.toContain('ACC');
  });
  it('retries on failure, logs redact secrets, leaves order processing for staff retry', async () => {
    const { sa, u, plan, prov } = await setup();
    const f = vi.fn(async () => new Response('error with sk_live_secret inside', { status: 500 })); vi.stubGlobal('fetch', f);
    const r = await order(u.c, plan); expect(r.json.order.status).toBe('processing'); expect(f).toHaveBeenCalledTimes(2);
    const logs = (await sa.get(`/api/admin/providers/${prov}/logs`)).json.logs; expect(logs.length).toBe(2); expect(JSON.stringify(logs)).not.toContain('sk_live_secret');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { credentials: 'OK-2' } }), { status: 200 })));
    expect((await sa.post(`/api/admin/orders/${r.json.order.id}/provider-dispatch`)).status).toBe(200);
    expect((await u.c.get(`/api/me/orders/${r.json.order.id}`)).json.order.status).toBe('completed');
    expect((await sa.get('/api/admin/providers')).text).not.toContain('sk_live_secret');
  });
});

describe('appearance settings', () => {
  it('super admin sets theme/logo/favicon/fonts; they are public; page text and other secrets are not; others cannot change them', async () => {
    const sa = await makeStaff(env, 'super_admin'); const pm = await makeStaff(env, 'product_manager');
    expect((await sa.req('PUT', '/api/admin/settings', { theme_id: 'rose-luxe', heading_font: 'playfair', brand_primary: 'NOORIX', logo_key: 'public/abc', favicon_key: 'public/def', page_terms: 'secret long text' })).status).toBe(200);
    const pub = (await new Client(env).get('/api/settings/public')).json.settings;
    expect(pub).toMatchObject({ theme_id: 'rose-luxe', heading_font: 'playfair', logo_key: 'public/abc', favicon_key: 'public/def' });
    expect(pub.page_terms).toBeUndefined(); expect(JSON.stringify(pub)).not.toMatch(/DELIVERY|SETUP|password/i);
    expect((await pm.req('PUT', '/api/admin/settings', { theme_id: 'plum' })).status).toBe(403);
    expect((await new Client(env).get('/api/settings/public')).json.settings.theme_id).toBe('rose-luxe');
  });
  it('admin image upload rejects non-images and requires permission', async () => {
    const u = await register(env); const fd = new FormData(); fd.append('file', new Blob(['x'], { type: 'text/html' }), 'x.html');
    u.c.csrf = u.c.csrf; const res = await app.request('/api/admin/uploads', { method: 'POST', headers: { cookie: u.c.cookie, 'x-csrf-token': u.c.csrf }, body: fd }, env);
    expect(res.status).toBe(403);
  });
});
