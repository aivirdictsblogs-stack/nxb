import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AppVars } from '../env';
import { hashPassword, verifyPassword, randomToken, sha256Hex } from '../lib/crypto';
import { uid, now, rateLimit } from '../lib/util';
import { createSession, clearCookie, requireUser, COOKIE } from '../lib/session';
import { sendEmail } from '../lib/email';
import { googleStart, googleCallback } from '../lib/oauth';

export const auth = new Hono<{ Bindings: Env; Variables: AppVars }>();
const ip = (c: any) => c.req.header('cf-connecting-ip') ?? 'local';
const pw = z.string().min(8).max(128);
const DUMMY = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

auth.post('/register', async (c) => {
  const reg = await c.env.DB.prepare(`SELECT value FROM site_settings WHERE key='registration_enabled'`).first<any>();
  if (reg?.value === '0') return c.json({ error: 'Registration is currently closed' }, 403);
  if (!(await rateLimit(c.env.DB, `reg:${ip(c)}`, 10, 3600))) return c.json({ error: 'Too many attempts' }, 429);
  const p = z.object({ full_name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(200), phone: z.string().trim().min(7).max(20), password: pw, confirm_password: z.string() })
    .refine(d => d.password === d.confirm_password, { message: 'Passwords do not match', path: ['confirm_password'] }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed', issues: p.error.flatten().fieldErrors }, 400);
  const d = p.data;
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(d.email).first();
  if (exists) return c.json({ error: 'An account with this email already exists' }, 409);
  const id = uid(), vtoken = randomToken(32);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id,email,full_name,phone,password_hash) VALUES (?,?,?,?,?)').bind(id, d.email.toLowerCase(), d.full_name, d.phone, await hashPassword(d.password)),
    c.env.DB.prepare('INSERT INTO wallet_accounts (user_id) VALUES (?)').bind(id),
    c.env.DB.prepare('INSERT INTO email_verification_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(uid(), id, await sha256Hex(vtoken), now() + 86400),
  ]);
  await sendEmail(c.env, { to: d.email, subject: 'Verify your Noorix account', text: `Verify: ${c.env.APP_URL}/verify-email?token=${vtoken}` });
  const csrf = await createSession(c, id, false);
  return c.json({ user: { id, email: d.email.toLowerCase(), full_name: d.full_name }, csrf }, 201);
});

auth.post('/login', async (c) => {
  const p = z.object({ email: z.string().email(), password: z.string().min(1).max(128), remember: z.boolean().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Invalid credentials' }, 400);
  const { email, password, remember } = p.data;
  if (!(await rateLimit(c.env.DB, `login:${ip(c)}:${email.toLowerCase()}`, 8, 900))) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  const u = await c.env.DB.prepare('SELECT id,email,full_name,password_hash,status FROM users WHERE email=?').bind(email).first<any>();
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY);
  if (!u || !ok) return c.json({ error: 'Invalid email or password' }, 401);
  if (u.status !== 'active') return c.json({ error: 'Account suspended' }, 403);
  const csrf = await createSession(c, u.id, !!remember); // new session id on every login = rotation
  return c.json({ user: { id: u.id, email: u.email, full_name: u.full_name }, csrf });
});

auth.post('/logout', async (c) => {
  const cookie = c.req.header('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (cookie) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256Hex(cookie)).run();
  clearCookie(c);
  return c.json({ ok: true });
});

auth.get('/me', (c) => {
  const u = c.get('user');
  if (!u) return c.json({ user: null });
  return c.json({ user: { id: u.id, email: u.email, full_name: u.full_name, phone: u.phone, roles: u.roles, perms: u.perms }, csrf: u.csrf });
});

auth.post('/forgot-password', async (c) => {
  const p = z.object({ email: z.string().email() }).safeParse(await c.req.json().catch(() => ({})));
  if (p.success && (await rateLimit(c.env.DB, `forgot:${ip(c)}`, 5, 3600))) {
    const u = await c.env.DB.prepare('SELECT id,email FROM users WHERE email=? AND status=?').bind(p.data.email, 'active').first<any>();
    if (u) {
      const t = randomToken(32);
      await c.env.DB.prepare('INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(uid(), u.id, await sha256Hex(t), now() + 3600).run();
      await sendEmail(c.env, { to: u.email, subject: 'Reset your Noorix password', text: `Reset: ${c.env.APP_URL}/reset-password?token=${t}` });
    }
  }
  return c.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
});

auth.post('/reset-password', async (c) => {
  const p = z.object({ token: z.string().min(10), password: pw }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed' }, 400);
  const th = await sha256Hex(p.data.token);
  const row = await c.env.DB.prepare('SELECT id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at > ?').bind(th, now()).first<any>();
  if (!row) return c.json({ error: 'Invalid or expired token' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE password_reset_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(now(), row.id),
    c.env.DB.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').bind(await hashPassword(p.data.password), now(), row.user_id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id),
  ]);
  return c.json({ ok: true });
});

auth.post('/verify-email', async (c) => {
  const p = z.object({ token: z.string().min(10) }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Invalid token' }, 400);
  const row = await c.env.DB.prepare('SELECT id,user_id FROM email_verification_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at > ?').bind(await sha256Hex(p.data.token), now()).first<any>();
  if (!row) return c.json({ error: 'Invalid or expired token' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE email_verification_tokens SET used_at=? WHERE id=?').bind(now(), row.id),
    c.env.DB.prepare('UPDATE users SET email_verified_at=? WHERE id=?').bind(now(), row.user_id),
  ]);
  return c.json({ ok: true });
});

auth.patch('/profile', requireUser, async (c) => {
  const p = z.object({ full_name: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(20) }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed' }, 400);
  const u = c.get('user')!;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET full_name=?, phone=?, updated_at=? WHERE id=?').bind(p.data.full_name, p.data.phone, now(), u.id),
    c.env.DB.prepare('INSERT INTO notifications (id,user_id,type,title,body) VALUES (?,?,?,?,?)').bind(uid(), u.id, 'account', 'Profile updated', 'Your profile details were changed.'),
  ]);
  return c.json({ ok: true });
});

auth.post('/change-password', requireUser, async (c) => {
  const p = z.object({ current_password: z.string().min(1), new_password: pw }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed' }, 400);
  const u = c.get('user')!;
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(u.id).first<any>();
  if (!(await verifyPassword(p.data.current_password, row?.password_hash))) return c.json({ error: 'Current password is incorrect' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').bind(await hashPassword(p.data.new_password), now(), u.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id),
    c.env.DB.prepare('INSERT INTO notifications (id,user_id,type,title,body) VALUES (?,?,?,?,?)').bind(uid(), u.id, 'account', 'Password changed', 'Your password was changed. All sessions were signed out.'),
  ]);
  const csrf = await createSession(c, u.id, false); // rotate: fresh session
  return c.json({ ok: true, csrf });
});

// Provider-based OAuth (Google). Inactive until GOOGLE_CLIENT_ID/SECRET are set - see docs/GOOGLE_SIGNIN.md
auth.get('/providers', (c) => c.json({ google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }));
auth.get('/oauth/google/start', googleStart);
auth.get('/oauth/google/callback', googleCallback);
