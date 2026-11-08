import type { Env } from '../env';
import { encryptText, decryptText } from './crypto';
import { uid, now, notifyStmt } from './util';

const tl = (note: string, status: string) => JSON.stringify({ at: now(), status, note });
const appendTimeline = (db: D1Database, orderId: string, status: string, note: string) =>
  db.prepare(`UPDATE orders SET timeline = json_insert(timeline,'$[#]',json(?)), status=?, updated_at=? WHERE id=?`).bind(tl(note, status), status, now(), orderId);

/** Atomically claim one inventory item for an order. Order only completes if a row was actually claimed. */
export async function claimInventory(env: Env, orderId: string, planId: string, userId: string, orderNo: string) {
  const claim = await env.DB.prepare(`UPDATE product_inventory SET status='sold', order_id=?, sold_at=? WHERE id = (SELECT id FROM product_inventory WHERE plan_id=? AND status='available' ORDER BY created_at LIMIT 1) AND status='available' RETURNING id,payload_encrypted`)
    .bind(orderId, now(), planId).first<{ id: string; payload_encrypted: string }>();
  if (!claim) return false;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO order_deliveries (id,order_id,method,payload_encrypted) VALUES (?,?,?,?)').bind(uid(), orderId, 'inventory', claim.payload_encrypted),
    appendTimeline(env.DB, orderId, 'completed', 'Delivered automatically'),
    notifyStmt(env.DB, userId, 'order_completed', 'Order completed', `${orderNo} has been delivered.`, `/dashboard/orders/${orderId}`),
  ]);
  return true;
}
export { appendTimeline, encryptText, decryptText };
