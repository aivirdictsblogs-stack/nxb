import type { Context } from 'hono';
import type { Env, AppVars } from '../env';
import { randomToken, sha256Hex } from './crypto';
import { uid, now } from './util';
import { createSession } from './session';

type C = Context<{ Bindings: Env; Variables: AppVars }>;
const configured = (e: Env) => !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
const redirectUri = (e: Env) => `${e.APP_URL}/api/auth/oauth/google/callback`;
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function googleStart(c: C) {
  if (!configured(c.env)) return c.json({ error: 'Google sign-in is not configured' }, 501);
  const state = randomToken(24), nonce = randomToken(24), verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  await c.env.DB.prepare('INSERT INTO oauth_states (state,provider,nonce,code_verifier,expires_at) VALUES (?,?,?,?,?)').bind(state, 'google', nonce, verifier, now() + 600).run();
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(c.env), response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return c.redirect(u.toString());
}

/** Links by provider id; else by VERIFIED email to an existing user; else creates a user. Never duplicates accounts. */
export async function linkOrCreateUser(db: D1Database, p: { provider: string; sub: string; email: string; emailVerified: boolean; name: string }) {
  const linked = await db.prepare('SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_user_id=?').bind(p.provider, p.sub).first<{ user_id: string }>();
  if (linked) return linked.user_id;
  if (!p.emailVerified) throw new Error('Provider email is not verified');
  const existing = await db.prepare('SELECT id FROM users WHERE email=?').bind(p.email).first<{ id: string }>();
  const userId = existing?.id ?? uid();
  const stmts = [];
  if (!existing) {
    stmts.push(db.prepare('INSERT INTO users (id,email,full_name,email_verified_at) VALUES (?,?,?,?)').bind(userId, p.email.toLowerCase(), p.name || p.email, now()));
    stmts.push(db.prepare('INSERT INTO wallet_accounts (user_id) VALUES (?)').bind(userId));
  } else stmts.push(db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id=?').bind(now(), userId));
  stmts.push(db.prepare('INSERT INTO oauth_accounts (id,user_id,provider,provider_user_id,provider_email,email_verified) VALUES (?,?,?,?,?,1)').bind(uid(), userId, p.provider, p.sub, p.email));
  await db.batch(stmts);
  return userId;
}

export async function googleCallback(c: C) {
  if (!configured(c.env)) return c.json({ error: 'Google sign-in is not configured' }, 501);
  const code = c.req.query('code'), state = c.req.query('state');
  if (!code || !state) return c.json({ error: 'Invalid callback' }, 400);
  const st = await c.env.DB.prepare('SELECT * FROM oauth_states WHERE state=? AND expires_at > ?').bind(state, now()).first<any>();
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(state).run(); // single use
  if (!st) return c.json({ error: 'Invalid or expired state' }, 400);
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID!, client_secret: c.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(c.env), grant_type: 'authorization_code', code_verifier: st.code_verifier }) });
  if (!res.ok) return c.json({ error: 'Token exchange failed' }, 400);
  const tok = await res.json<any>();
  // id_token received directly from Google's token endpoint over TLS; validate claims.
  const claims = JSON.parse(atob(String(tok.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.aud !== c.env.GOOGLE_CLIENT_ID || claims.nonce !== st.nonce || claims.exp < now())
    return c.json({ error: 'Invalid id_token' }, 400);
  const userId = await linkOrCreateUser(c.env.DB, { provider: 'google', sub: claims.sub, email: claims.email, emailVerified: claims.email_verified === true, name: claims.name });
  const status = await c.env.DB.prepare('SELECT status FROM users WHERE id=?').bind(userId).first<any>();
  if (status?.status !== 'active') return c.json({ error: 'Account suspended' }, 403);
  await createSession(c, userId, true);
  return c.redirect(`${c.env.APP_URL}/dashboard`);
}
