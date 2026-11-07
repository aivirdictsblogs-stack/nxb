import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AppVars } from './env';
import { sessionMiddleware } from './lib/session';
import { auth } from './routes/auth';
import { store } from './routes/store';
import { admin } from './routes/admin';
import { pub, admin2, sitemap } from './routes/extra';
import { hashPassword } from './lib/crypto';
import { uid, now, audit } from './lib/util';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
});
app.use('/api/*', sessionMiddleware);
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', auth);
app.route('/api', store);
app.route('/api', pub);
app.route('/api/admin', admin);
app.route('/api/admin', admin2);
app.get('/sitemap.xml', async (c) => new Response(await sitemap(c.env), { headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' } }));

// One-time first Super Admin setup. Requires SETUP_TOKEN secret; permanently refuses once a Super Admin exists.
app.post('/api/setup/super-admin', async (c) => {
  if (!c.env.SETUP_TOKEN || c.req.header('x-setup-token') !== c.env.SETUP_TOKEN) return c.json({ error: 'Not found' }, 404);
  const done = await c.env.DB.prepare(`SELECT 1 x FROM user_roles WHERE role_id='super_admin' LIMIT 1`).first();
  if (done) return c.json({ error: 'Setup already completed' }, 410);
  const p = z.object({ email: z.string().email(), full_name: z.string().min(2).max(100), password: z.string().min(12).max(128) }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed (password min 12 chars)' }, 400);
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id,email,full_name,password_hash,email_verified_at) VALUES (?,?,?,?,?)').bind(id, p.data.email.toLowerCase(), p.data.full_name, await hashPassword(p.data.password), now()),
    c.env.DB.prepare('INSERT INTO wallet_accounts (user_id) VALUES (?)').bind(id),
    c.env.DB.prepare(`INSERT INTO user_roles (user_id,role_id) VALUES (?, 'super_admin')`).bind(id),
  ]);
  await audit(c.env.DB, id, 'setup.super_admin', 'user', id);
  return c.json({ ok: true }, 201);
});

app.notFound((c) => c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404)));
app.onError((err, c) => { console.error(err); return c.json({ error: 'Internal error' }, 500); });
export default app;
