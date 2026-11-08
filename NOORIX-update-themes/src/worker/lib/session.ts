import type { Context, Next } from 'hono';
import type { Env, AppVars, AuthUser } from '../env';
import { randomToken, sha256Hex } from './crypto';
import { uid, now } from './util';

export const COOKIE = 'noorix_session';
type C = Context<{ Bindings: Env; Variables: AppVars }>;

export async function createSession(c: C, userId: string, remember: boolean) {
  const token = randomToken(32), csrf = randomToken(24);
  const ttl = remember ? 30 * 86400 : 86400;
  await c.env.DB.prepare('INSERT INTO sessions (id,user_id,token_hash,csrf_token,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?)')
    .bind(uid(), userId, await sha256Hex(token), csrf, now() + ttl, c.req.header('cf-connecting-ip') ?? null, (c.req.header('user-agent') ?? '').slice(0, 200)).run();
  const secure = c.env.ENVIRONMENT === 'development' ? '' : '; Secure';
  c.header('Set-Cookie', `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${ttl}`, { append: true });
  return csrf;
}
export function clearCookie(c: C) {
  c.header('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`, { append: true });
}
function readCookie(header: string | undefined, name: string) {
  for (const p of (header ?? '').split(';')) { const [k, ...v] = p.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
export async function sessionMiddleware(c: C, next: Next) {
  c.set('user', null);
  const token = readCookie(c.req.header('cookie'), COOKIE);
  if (token) {
    const row = await c.env.DB.prepare(`SELECT s.id sid, s.csrf_token csrf, u.id, u.email, u.full_name, u.phone, u.status
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?`)
      .bind(await sha256Hex(token), now()).first<any>();
    if (row && row.status === 'active') {
      const rp = await c.env.DB.prepare(`SELECT ur.role_id r, rp.permission_id p FROM user_roles ur LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id=?`).bind(row.id).all<any>();
      const roles = [...new Set(rp.results.map(x => x.r))] as string[];
      const perms = [...new Set(rp.results.map(x => x.p).filter(Boolean))] as string[];
      const user: AuthUser = { id: row.id, email: row.email, full_name: row.full_name, phone: row.phone, status: row.status, csrf: row.csrf, perms, roles };
      c.set('user', user);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-csrf-token') !== row.csrf) {
        return c.json({ error: 'Invalid CSRF token' }, 403);
      }
    }
  }
  await next();
}
export const requireUser = async (c: C, next: Next) => {
  if (!c.get('user')) return c.json({ error: 'Authentication required' }, 401);
  await next();
};
export const requirePerm = (perm: string) => async (c: C, next: Next) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Authentication required' }, 401);
  if (!u.perms.includes(perm)) return c.json({ error: 'Forbidden' }, 403);
  await next();
};
export const requireStaff = async (c: C, next: Next) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Authentication required' }, 401);
  if (!u.roles.length) return c.json({ error: 'Forbidden' }, 403);
  await next();
};
export const requireAny = (...perms: string[]) => async (c: C, next: Next) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Authentication required' }, 401);
  if (!perms.some(p => u.perms.includes(p))) return c.json({ error: 'Forbidden' }, 403);
  await next();
};
