import type { Env } from '../env';
export const uid = () => crypto.randomUUID();
export const now = () => Math.floor(Date.now() / 1000);
export const orderNumber = () => {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `NDL-${d}-${r}`;
};
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
export async function audit(db: D1Database, actor: string | null, action: string, entityType: string, entityId: string, details: unknown = {}) {
  await db.prepare('INSERT INTO admin_audit_logs (id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?)')
    .bind(uid(), actor, action, entityType, entityId, JSON.stringify(details)).run();
}
export const auditStmt = (db: D1Database, actor: string | null, action: string, entityType: string, entityId: string, details: unknown = {}) =>
  db.prepare('INSERT INTO admin_audit_logs (id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?)')
    .bind(uid(), actor, action, entityType, entityId, JSON.stringify(details));
export const notifyStmt = (db: D1Database, userId: string, type: string, title: string, body = '', link = '') =>
  db.prepare('INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)').bind(uid(), userId, type, title, body, link);
export async function rateLimit(db: D1Database, key: string, max: number, windowSec: number) {
  const t = now();
  await db.prepare('INSERT INTO rate_limits (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END, reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END')
    .bind(key, t + windowSec, t, t, t + windowSec).run();
  const r = await db.prepare('SELECT count FROM rate_limits WHERE key=?').bind(key).first<{ count: number }>();
  return (r?.count ?? 0) <= max;
}
export type { Env };
