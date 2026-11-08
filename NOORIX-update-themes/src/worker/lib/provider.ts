import type { Env } from '../env';
import { encryptText } from './crypto';
import { uid, notifyStmt } from './util';
import { appendTimeline } from './delivery';

const getPath = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const fill = (v: any, ctx: Record<string, string>): any =>
  typeof v === 'string' ? v.replace(/\{\{([\w.]+)\}\}/g, (_, k) => ctx[k] ?? '') : Array.isArray(v) ? v.map(x => fill(x, ctx)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, ctx)])) : v;
export function validateProviderUrl(u: string) {
  let url: URL; try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname;
  return !(h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.endsWith('.local') || h.endsWith('.internal'));
}

/** Generic, configurable supplier call. No supplier is assumed; everything comes from provider_integrations. */
export async function dispatchProvider(env: Env, orderId: string): Promise<{ ok: boolean; delivered: boolean; error?: string }> {
  const db = env.DB;
  const row = await db.prepare(`SELECT o.id,o.user_id,o.order_number,o.status,o.contact_email,i.customer_inputs,i.plan_id,pl.provider_sku,p.provider_id
    FROM orders o JOIN order_items i ON i.order_id=o.id JOIN product_plans pl ON pl.id=i.plan_id JOIN products p ON p.id=i.product_id WHERE o.id=?`).bind(orderId).first<any>();
  if (!row || row.status !== 'processing') return { ok: false, delivered: false, error: 'Order not dispatchable' };
  const done = await db.prepare('SELECT 1 x FROM order_deliveries WHERE order_id=?').bind(orderId).first();
  if (done) return { ok: false, delivered: false, error: 'Already delivered' };
  const prov = row.provider_id ? await db.prepare('SELECT * FROM provider_integrations WHERE id=? AND is_active=1').bind(row.provider_id).first<any>() : null;
  if (!prov) return { ok: false, delivered: false, error: 'No active provider configured for this product' };
  if (!validateProviderUrl(prov.base_url)) return { ok: false, delivered: false, error: 'Provider URL invalid' };
  const secret = prov.secret_name ? (env[prov.secret_name] as string | undefined) : undefined;
  if (prov.secret_name && !secret) return { ok: false, delivered: false, error: `Secret ${prov.secret_name} is not set on the Worker` };
  const inputs = JSON.parse(row.customer_inputs || '{}');
  const ctx: Record<string, string> = { order_number: row.order_number, sku: row.provider_sku ?? '', email: row.contact_email ?? '' };
  for (const [k, v] of Object.entries(inputs)) ctx[`inputs.${k}`] = String(v);
  let template: any = {}; try { template = JSON.parse(prov.request_template || '{}'); } catch {}
  const map = (() => { try { return JSON.parse(prov.response_map || '{}'); } catch { return {}; } })();
  const prior = await db.prepare('SELECT COUNT(*) n FROM provider_order_logs WHERE order_id=?').bind(orderId).first<any>();
  let attempt = prior?.n ?? 0, last = '';
  for (let i = 0; i < prov.max_retries; i++) {
    attempt++;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret) headers[prov.auth_header] = `${prov.auth_scheme ? prov.auth_scheme + ' ' : ''}${secret}`;
    let status = 0, text = '', ok = false;
    try {
      const res = await fetch(prov.base_url.replace(/\/$/, '') + prov.create_path, { method: 'POST', headers, body: JSON.stringify(fill(template, ctx)), redirect: 'error' });
      status = res.status; text = (await res.text()).slice(0, 2000); ok = res.ok;
    } catch (e: any) { text = String(e.message).slice(0, 300); }
    await db.prepare('INSERT INTO provider_order_logs (id,provider_id,order_id,attempt,request_summary,response_status,response_body,ok) VALUES (?,?,?,?,?,?,?,?)')
      .bind(uid(), prov.id, orderId, attempt, `${prov.create_path} sku=${ctx.sku}`, status, secret ? text.split(secret).join('[redacted]') : text, +ok).run();
    if (ok) {
      let json: any = null; try { json = JSON.parse(text); } catch {}
      const payload = map.delivery_path && json ? getPath(json, map.delivery_path) : undefined;
      if (payload != null) {
        await db.batch([
          db.prepare('INSERT INTO order_deliveries (id,order_id,method,payload_encrypted) VALUES (?,?,?,?)').bind(uid(), orderId, 'api', await encryptText(typeof payload === 'string' ? payload : JSON.stringify(payload), env.DELIVERY_KEY)),
          appendTimeline(db, orderId, 'completed', 'Delivered by supplier'),
          notifyStmt(db, row.user_id, 'order_completed', 'Order completed', `${row.order_number} has been delivered.`, `/dashboard/orders/${orderId}`),
        ]);
        return { ok: true, delivered: true };
      }
      return { ok: true, delivered: false };
    }
    last = `HTTP ${status}`;
  }
  return { ok: false, delivered: false, error: last || 'Provider unreachable' };
}
