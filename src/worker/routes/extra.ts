import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AppVars } from '../env';
import { requirePerm, requireStaff } from '../lib/session';
import { uid, now, audit, auditStmt, rateLimit } from '../lib/util';
import { dispatchProvider, validateProviderUrl } from '../lib/provider';

export const pub = new Hono<{ Bindings: Env; Variables: AppVars }>();
export const admin2 = new Hono<{ Bindings: Env; Variables: AppVars }>();
admin2.use('*', requireStaff);
const actor = (c: any) => c.get('user')!.id as string;
const bad = (c: any, p: z.SafeParseError<any>) => c.json({ error: 'Validation failed', issues: p.error.flatten().fieldErrors }, 400);
const IMG = ['image/png', 'image/jpeg', 'image/webp'];

// Public media (only keys under public/)
pub.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace('/api/media/', ''));
  if (!key.startsWith('public/') || key.includes('..') || !c.env.UPLOADS) return c.json({ error: 'Not found' }, 404);
  const o = await c.env.UPLOADS.get(key);
  if (!o) return c.json({ error: 'Not found' }, 404);
  return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
});
// Private files: owner, or staff with the matching permission
pub.get('/files/*', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Authentication required' }, 401);
  const key = decodeURIComponent(c.req.path.replace('/api/files/', ''));
  const m = key.match(/^(proofs|attachments)\/([^/]+)\/[^/]+$/);
  if (!m || !c.env.UPLOADS) return c.json({ error: 'Not found' }, 404);
  const need = m[1] === 'proofs' ? 'deposits.review' : 'tickets.manage';
  if (m[2] !== u.id && !u.perms.includes(need)) return c.json({ error: 'Forbidden' }, 403);
  const o = await c.env.UPLOADS.get(key);
  if (!o) return c.json({ error: 'Not found' }, 404);
  return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, no-store', 'content-disposition': 'inline', 'x-content-type-options': 'nosniff' } });
});
pub.post('/contact', async (c) => {
  if (!(await rateLimit(c.env.DB, `contact:${c.req.header('cf-connecting-ip') ?? 'local'}`, 5, 3600))) return c.json({ error: 'Too many messages' }, 429);
  const p = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), message: z.string().trim().min(5).max(3000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return bad(c, p);
  await c.env.DB.prepare('INSERT INTO contact_messages (id,name,email,message) VALUES (?,?,?,?)').bind(uid(), p.data.name, p.data.email, p.data.message).run();
  return c.json({ ok: true }, 201);
});
pub.get('/pages', async (c) => {
  const r = await c.env.DB.prepare(`SELECT key,value FROM site_settings WHERE key LIKE 'page_%' OR key IN ('faq_json','about','contact_email')`).all<any>();
  return c.json({ pages: Object.fromEntries(r.results.map((x: any) => [x.key, x.value])) });
});
export async function sitemap(env: Env) {
  const base = env.APP_URL;
  const [cats, prods] = await Promise.all([env.DB.prepare('SELECT slug FROM product_categories WHERE is_active=1').all<any>(), env.DB.prepare(`SELECT slug FROM products WHERE status='active'`).all<any>()]);
  const urls = ['/', '/products', '/categories', '/deals', '/trending', '/track-order', '/about', '/contact', '/faq', '/terms', '/privacy', '/refund-policy',
    ...cats.results.map((x: any) => `/categories/${x.slug}`), ...prods.results.map((x: any) => `/products/${x.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>`;
}

// ---- admin extras ----
admin2.post('/uploads', async (c) => {
  const u = c.get('user')!;
  if (!u.perms.includes('products.manage') && !u.perms.includes('content.manage')) return c.json({ error: 'Forbidden' }, 403);
  if (!c.env.UPLOADS) return c.json({ error: 'Storage not configured' }, 501);
  const f = (await c.req.formData().catch(() => null))?.get('file') as unknown as File | null;
  if (!f || typeof f === 'string' || !IMG.includes(f.type) || f.size > 3 * 1024 * 1024) return c.json({ error: 'PNG/JPG/WEBP up to 3MB only' }, 400);
  const key = `public/${uid()}`;
  await c.env.UPLOADS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
  await audit(c.env.DB, u.id, 'upload.image', 'file', key);
  return c.json({ key }, 201);
});
admin2.get('/categories', requirePerm('products.manage'), async (c) => c.json({ categories: (await c.env.DB.prepare('SELECT * FROM product_categories ORDER BY sort_order').all()).results }));
admin2.patch('/categories/:id', requirePerm('products.manage'), async (c) => {
  const p = z.object({ name: z.string().min(2).max(80), description: z.string().max(300).nullable(), image_key: z.string().nullable(), sort_order: z.number().int(), is_active: z.boolean() }).partial().safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return bad(c, p);
  const d: any = p.data, sets: string[] = [], args: any[] = [];
  for (const [k, v] of Object.entries(d)) { sets.push(`${k}=?`); args.push(typeof v === 'boolean' ? +v : v); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE product_categories SET ${sets.join(',')} WHERE id=?`).bind(...args, c.req.param('id') as string), auditStmt(c.env.DB, actor(c), 'category.update', 'category', c.req.param('id') as string, d)]);
  return c.json({ ok: true });
});
admin2.get('/products/:id', requirePerm('products.manage'), async (c) => {
  const id = c.req.param('id') as string;
  const p = await c.env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first<any>();
  if (!p) return c.json({ error: 'Not found' }, 404);
  const plans = await c.env.DB.prepare(`SELECT pl.*, (SELECT COUNT(*) FROM product_inventory WHERE plan_id=pl.id AND status='available') inventory_available FROM product_plans pl WHERE product_id=? ORDER BY sort_order`).bind(id).all();
  return c.json({ product: { ...p, features: JSON.parse(p.features), input_fields: JSON.parse(p.input_fields), plans: plans.results } });
});
admin2.get('/messages', requirePerm('tickets.manage'), async (c) => c.json({ messages: (await c.env.DB.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 200').all()).results }));
admin2.post('/messages/:id/handled', requirePerm('tickets.manage'), async (c) => { await c.env.DB.prepare('UPDATE contact_messages SET handled=1 WHERE id=?').bind(c.req.param('id') as string).run(); return c.json({ ok: true }); });
admin2.get('/settings', requirePerm('settings.manage'), async (c) => c.json({ settings: Object.fromEntries((await c.env.DB.prepare('SELECT key,value FROM site_settings').all<any>()).results.map((x: any) => [x.key, x.value])) }));
admin2.patch('/staff/:id', requirePerm('staff.manage'), async (c) => {
  const p = z.object({ role_id: z.string().optional(), status: z.enum(['active', 'suspended']).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return bad(c, p);
  const id = c.req.param('id') as string;
  if (id === actor(c)) return c.json({ error: 'You cannot change your own role or status' }, 400);
  if (!(await c.env.DB.prepare('SELECT 1 x FROM user_roles WHERE user_id=?').bind(id).first())) return c.json({ error: 'Not a staff account' }, 404);
  const stmts = [];
  if (p.data.role_id) {
    if (!(await c.env.DB.prepare('SELECT 1 x FROM roles WHERE id=?').bind(p.data.role_id).first())) return c.json({ error: 'Unknown role' }, 400);
    stmts.push(c.env.DB.prepare('DELETE FROM user_roles WHERE user_id=?').bind(id), c.env.DB.prepare('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)').bind(id, p.data.role_id), c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id));
  }
  if (p.data.status) { stmts.push(c.env.DB.prepare('UPDATE users SET status=? WHERE id=?').bind(p.data.status, id)); if (p.data.status === 'suspended') stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)); }
  if (!stmts.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.batch([...stmts, auditStmt(c.env.DB, actor(c), 'staff.update', 'user', id, p.data)]);
  return c.json({ ok: true });
});
admin2.get('/permissions', requirePerm('staff.manage'), async (c) => {
  const r = await c.env.DB.prepare('SELECT role_id, permission_id FROM role_permissions ORDER BY role_id').all<any>();
  const m: Record<string, string[]> = {}; for (const x of r.results) (m[x.role_id] ||= []).push(x.permission_id);
  return c.json({ roles: m });
});
admin2.post('/security/revoke-sessions', requirePerm('staff.manage'), async (c) => {
  const p = z.object({ user_id: z.string() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return bad(c, p);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(p.data.user_id), auditStmt(c.env.DB, actor(c), 'security.revoke_sessions', 'user', p.data.user_id)]);
  return c.json({ ok: true });
});
admin2.get('/security/overview', requirePerm('settings.manage'), async (c) => {
  const one = async (s: string) => (await c.env.DB.prepare(s).first<any>())?.n ?? 0;
  return c.json({ active_sessions: await one(`SELECT COUNT(*) n FROM sessions WHERE expires_at > ${now()}`), staff_accounts: await one('SELECT COUNT(DISTINCT user_id) n FROM user_roles'),
    unverified_customers: await one('SELECT COUNT(*) n FROM users WHERE email_verified_at IS NULL'), failed_login_buckets: await one(`SELECT COUNT(*) n FROM rate_limits WHERE key LIKE 'login:%' AND count >= 8 AND reset_at > ${now()}`),
    delivery_key_configured: !!c.env.DELIVERY_KEY, setup_token_still_set: !!c.env.SETUP_TOKEN, google_configured: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) });
});

// ---- suppliers / providers ----
const provSchema = z.object({ name: z.string().min(2).max(80), base_url: z.string().max(300), secret_name: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/).nullable().optional(), auth_header: z.string().max(60).default('Authorization'), auth_scheme: z.string().max(30).default('Bearer'),
  create_path: z.string().max(200).default('/orders'), status_path: z.string().max(200).nullable().optional(), request_template: z.string().max(4000).default('{}'), response_map: z.string().max(2000).default('{}'), max_retries: z.number().int().min(1).max(5).default(3), is_active: z.boolean().default(false) });
const jsonOk = (s: string) => { try { JSON.parse(s); return true; } catch { return false; } };
admin2.get('/providers', requirePerm('payments.manage'), async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM provider_integrations').all<any>();
  return c.json({ providers: r.results.map((p: any) => ({ ...p, secret_configured: !!(p.secret_name && c.env[p.secret_name]) })) });
});
admin2.post('/providers', requirePerm('payments.manage'), async (c) => {
  const p = provSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return bad(c, p);
  const d = p.data;
  if (!validateProviderUrl(d.base_url)) return c.json({ error: 'base_url must be a public https URL' }, 400);
  if (!jsonOk(d.request_template) || !jsonOk(d.response_map)) return c.json({ error: 'Template and response map must be valid JSON' }, 400);
  const id = uid();
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO provider_integrations (id,name,base_url,secret_name,auth_header,auth_scheme,create_path,status_path,request_template,response_map,max_retries,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, d.name, d.base_url, d.secret_name ?? null, d.auth_header, d.auth_scheme, d.create_path, d.status_path ?? null, d.request_template, d.response_map, d.max_retries, +d.is_active), auditStmt(c.env.DB, actor(c), 'provider.create', 'provider', id, { name: d.name })]);
  return c.json({ id }, 201);
});
admin2.patch('/providers/:id', requirePerm('payments.manage'), async (c) => {
  const p = provSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return bad(c, p);
  const d: any = p.data;
  if (d.base_url && !validateProviderUrl(d.base_url)) return c.json({ error: 'base_url must be a public https URL' }, 400);
  if ((d.request_template && !jsonOk(d.request_template)) || (d.response_map && !jsonOk(d.response_map))) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = [], args: any[] = [];
  for (const [k, v] of Object.entries(d)) { sets.push(`${k}=?`); args.push(typeof v === 'boolean' ? +v : v); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE provider_integrations SET ${sets.join(',')} WHERE id=?`).bind(...args, c.req.param('id') as string), auditStmt(c.env.DB, actor(c), 'provider.update', 'provider', c.req.param('id') as string, { fields: Object.keys(d) })]);
  return c.json({ ok: true });
});
admin2.get('/providers/:id/logs', requirePerm('payments.manage'), async (c) => c.json({ logs: (await c.env.DB.prepare('SELECT l.*, o.order_number FROM provider_order_logs l JOIN orders o ON o.id=l.order_id WHERE provider_id=? ORDER BY l.created_at DESC, l.rowid DESC LIMIT 100').bind(c.req.param('id') as string).all()).results }));
admin2.post('/orders/:id/provider-dispatch', requirePerm('deliveries.manage'), async (c) => {
  const r = await dispatchProvider(c.env, c.req.param('id') as string);
  await audit(c.env.DB, actor(c), 'order.provider_dispatch', 'order', c.req.param('id') as string, r);
  return c.json(r, r.ok ? 200 : 502);
});
