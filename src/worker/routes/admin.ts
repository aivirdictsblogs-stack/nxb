import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AppVars } from '../env';
import { requirePerm, requireStaff, requireAny } from '../lib/session';
import { uid, now, slugify, audit, auditStmt, notifyStmt } from '../lib/util';
import { ledgerStmts, reconcile } from '../lib/ledger';
import { encryptText, decryptText, hashPassword } from '../lib/crypto';
import { appendTimeline } from '../lib/delivery';

export const admin = new Hono<{ Bindings: Env; Variables: AppVars }>();
admin.use('*', requireStaff);
const body = async (c: any) => c.req.json().catch(() => ({}));
const bad = (c: any, p: z.SafeParseError<any>) => c.json({ error: 'Validation failed', issues: p.error.flatten().fieldErrors }, 400);
const actor = (c: any) => c.get('user')!.id as string;

// ---------- Dashboard ----------
admin.get('/dashboard', async (c) => {
  const u = c.get('user')!;
  const db = c.env.DB;
  const one = async (sql: string) => (await db.prepare(sql).first<any>()) ?? {};
  const o = await one(`SELECT COUNT(*) total, SUM(status='completed') completed, SUM(status IN ('pending','processing')) pending, COALESCE(SUM(CASE WHEN payment_status='paid' AND status IN ('processing','completed') THEN total_minor END),0) revenue FROM orders`);
  const stats: any = {
    total_orders: o.total ?? 0, completed_orders: o.completed ?? 0, pending_orders: o.pending ?? 0,
    total_customers: (await one(`SELECT COUNT(*) n FROM users WHERE id NOT IN (SELECT user_id FROM user_roles)`)).n,
    total_products: (await one(`SELECT COUNT(*) n FROM products WHERE status<>'archived'`)).n,
  };
  if (u.perms.includes('reports.view')) {
    stats.total_revenue_minor = o.revenue;
    stats.sales_by_day = (await db.prepare(`SELECT date(created_at,'unixepoch') day, SUM(total_minor) revenue, COUNT(*) orders FROM orders WHERE payment_status='paid' AND status IN ('processing','completed') AND created_at > ? GROUP BY day ORDER BY day`).bind(now() - 30 * 86400).all()).results;
    stats.best_sellers = (await db.prepare(`SELECT product_name, COUNT(*) sold FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.payment_status='paid' GROUP BY product_name ORDER BY sold DESC LIMIT 5`).all()).results;
  }
  if (u.perms.includes('deposits.review') || u.perms.includes('wallets.adjust')) {
    stats.pending_deposits = (await one(`SELECT COUNT(*) n FROM deposits WHERE status='pending'`)).n;
    stats.wallet_liability_minor = (await one(`SELECT COALESCE(SUM(balance_minor),0) n FROM wallet_accounts`)).n;
    stats.recent_transactions = (await db.prepare('SELECT id,user_id,type,amount_minor,created_at FROM wallet_transactions ORDER BY created_at DESC, rowid DESC LIMIT 8').all()).results;
  }
  if (u.perms.includes('orders.manage')) stats.recent_orders = (await db.prepare('SELECT id,order_number,status,total_minor,created_at FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 8').all()).results;
  return c.json(stats);
});

// ---------- Deposits ----------
admin.get('/deposits', requirePerm('deposits.review'), async (c) => {
  const st = c.req.query('status');
  const r = await c.env.DB.prepare(`SELECT d.*, u.email, u.full_name, m.name method FROM deposits d JOIN users u ON u.id=d.user_id JOIN payment_methods m ON m.id=d.payment_method_id ${st ? 'WHERE d.status=?' : ''} ORDER BY d.created_at DESC LIMIT 200`).bind(...(st ? [st] : [])).all();
  return c.json({ deposits: r.results });
});
admin.post('/deposits/:id/approve', requirePerm('deposits.review'), async (c) => {
  const id = (c.req.param('id') as string), db = c.env.DB, by = actor(c), t = now();
  const d = await db.prepare('SELECT * FROM deposits WHERE id=?').bind(id).first<any>();
  if (!d) return c.json({ error: 'Not found' }, 404);
  if (d.status !== 'pending') return c.json({ error: `Deposit already ${d.status}` }, 409);
  const ref = `dep:${id}`;
  try {
    await db.batch([
      db.prepare(`UPDATE deposits SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=? AND status='pending'`).bind(by, t, id),
      // Credit only if THIS call won the pending->approved transition; UNIQUE(reference) blocks any repeat.
      db.prepare(`INSERT INTO wallet_transactions (id,user_id,reference,type,amount_minor,balance_after_minor,ref_type,ref_id,description,actor_id)
        SELECT ?,?,?, 'deposit', ?, (SELECT balance_minor FROM wallet_accounts WHERE user_id=?) + ?, 'deposit', ?, 'Deposit approved', ?
        WHERE EXISTS (SELECT 1 FROM deposits WHERE id=? AND status='approved' AND reviewed_by=? AND reviewed_at=?)`)
        .bind(uid(), d.user_id, ref, d.amount_minor, d.user_id, d.amount_minor, id, by, id, by, t),
      db.prepare(`UPDATE wallet_accounts SET balance_minor = balance_minor + ? WHERE user_id=? AND EXISTS (SELECT 1 FROM wallet_transactions WHERE reference=?)`).bind(d.amount_minor, d.user_id, ref),
      notifyStmt(db, d.user_id, 'deposit_approved', 'Deposit approved', 'Funds were added to your wallet.', '/dashboard/wallet'),
      auditStmt(db, by, 'deposit.approve', 'deposit', id, { amount_minor: d.amount_minor, user_id: d.user_id }),
    ]);
  } catch (e: any) { if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Deposit already credited' }, 409); throw e; }
  const now2 = await db.prepare('SELECT status FROM deposits WHERE id=?').bind(id).first<any>();
  return c.json({ ok: now2?.status === 'approved' });
});
admin.post('/deposits/:id/reject', requirePerm('deposits.review'), async (c) => {
  const p = z.object({ note: z.string().trim().min(3).max(500) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = (c.req.param('id') as string), db = c.env.DB;
  const d = await db.prepare('SELECT * FROM deposits WHERE id=?').bind(id).first<any>();
  if (!d) return c.json({ error: 'Not found' }, 404);
  if (d.status !== 'pending') return c.json({ error: `Deposit already ${d.status}` }, 409);
  await db.batch([
    db.prepare(`UPDATE deposits SET status='rejected', reviewed_by=?, reviewed_at=?, review_note=? WHERE id=? AND status='pending'`).bind(actor(c), now(), p.data.note, id),
    notifyStmt(db, d.user_id, 'deposit_rejected', 'Deposit rejected', p.data.note, '/dashboard/wallet'),
    auditStmt(db, actor(c), 'deposit.reject', 'deposit', id, { note: p.data.note }),
  ]);
  return c.json({ ok: true });
});

// ---------- Customers & wallets ----------
admin.get('/customers', requireAny('customers.manage', 'wallets.adjust'), async (c) => {
  const q = c.req.query('q');
  const r = await c.env.DB.prepare(`SELECT u.id,u.email,u.full_name,u.phone,u.status,u.created_at,w.balance_minor FROM users u LEFT JOIN wallet_accounts w ON w.user_id=u.id WHERE u.id NOT IN (SELECT user_id FROM user_roles) ${q ? 'AND (u.email LIKE ? OR u.full_name LIKE ?)' : ''} ORDER BY u.created_at DESC LIMIT 200`).bind(...(q ? [`%${q}%`, `%${q}%`] : [])).all();
  return c.json({ customers: r.results });
});
admin.post('/customers/:id/status', requirePerm('customers.manage'), async (c) => {
  const p = z.object({ status: z.enum(['active', 'suspended']) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = (c.req.param('id') as string);
  const isStaff = await c.env.DB.prepare('SELECT 1 x FROM user_roles WHERE user_id=?').bind(id).first();
  if (isStaff) return c.json({ error: 'Cannot change staff accounts here' }, 403);
  const stmts = [c.env.DB.prepare('UPDATE users SET status=?, updated_at=? WHERE id=?').bind(p.data.status, now(), id), auditStmt(c.env.DB, actor(c), 'customer.status', 'user', id, p.data)];
  if (p.data.status === 'suspended') stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
admin.get('/customers/:id/wallet', requirePerm('wallets.adjust'), async (c) => {
  const id = (c.req.param('id') as string);
  const tx = await c.env.DB.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 200').bind(id).all();
  return c.json({ reconciliation: await reconcile(c.env.DB, id), transactions: tx.results });
});
admin.post('/customers/:id/wallet-adjust', requirePerm('wallets.adjust'), async (c) => {
  const p = z.object({ direction: z.enum(['credit', 'debit']), amount_minor: z.number().int().positive().max(100_000_000), reason: z.string().trim().min(5).max(300) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const uidc = (c.req.param('id') as string), db = c.env.DB;
  const target = await db.prepare('SELECT id FROM users WHERE id=?').bind(uidc).first();
  if (!target) return c.json({ error: 'Not found' }, 404);
  const signed = p.data.direction === 'credit' ? p.data.amount_minor : -p.data.amount_minor;
  const ref = `adj:${uid()}`;
  try {
    await db.batch([
      ...ledgerStmts(db, { userId: uidc, amountMinor: signed, type: signed > 0 ? 'admin_credit' : 'admin_debit', reference: ref, refType: 'admin', description: p.data.reason, actorId: actor(c) }),
      notifyStmt(db, uidc, 'account', signed > 0 ? 'Wallet credited' : 'Wallet debited', p.data.reason, '/dashboard/wallet'),
      auditStmt(db, actor(c), 'wallet.adjust', 'user', uidc, { ...p.data, reference: ref }),
    ]);
  } catch (e: any) { if (String(e.message).includes('CHECK')) return c.json({ error: 'Insufficient balance for debit' }, 400); throw e; }
  return c.json({ ok: true, reference: ref });
});

// ---------- Products / categories / plans ----------
admin.get('/products', requirePerm('products.manage'), async (c) => {
  const r = await c.env.DB.prepare(`SELECT p.id,p.name,p.slug,p.status,p.delivery_type,p.is_featured,p.is_trending,p.is_deal,c.name category FROM products p JOIN product_categories c ON c.id=p.category_id ORDER BY p.created_at DESC`).all();
  return c.json({ products: r.results });
});
const planSchema = z.object({ name: z.string().min(1).max(100), duration: z.string().max(60).optional(), price_minor: z.number().int().min(0), compare_at_minor: z.number().int().min(0).nullable().optional(), stock: z.number().int().min(0).nullable().optional(), is_available: z.boolean().default(true), provider_sku: z.string().max(100).nullable().optional() });
const productSchema = z.object({
  category_id: z.string(), name: z.string().trim().min(2).max(120), image_key: z.string().max(300).nullable().optional(), short_description: z.string().max(300).default(''), full_description: z.string().max(10000).default(''),
  features: z.array(z.string().max(200)).default([]), status: z.enum(['active', 'disabled', 'archived']).default('active'),
  is_featured: z.boolean().default(false), is_trending: z.boolean().default(false), is_deal: z.boolean().default(false),
  delivery_type: z.enum(['manual', 'inventory', 'api']).default('manual'),
  input_fields: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string(), required: z.boolean().default(false) })).default([]),
  provider_id: z.string().nullable().optional(), delivery_instructions: z.string().max(2000).optional(), refund_policy: z.string().max(2000).optional(), terms: z.string().max(4000).optional(),
  plans: z.array(planSchema).min(1),
});
admin.post('/products', requirePerm('products.manage'), async (c) => {
  const p = productSchema.safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const d = p.data, id = uid(); let slug = slugify(d.name);
  if (await c.env.DB.prepare('SELECT 1 x FROM products WHERE slug=?').bind(slug).first()) slug += '-' + id.slice(0, 4);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO products (id,category_id,name,slug,image_key,short_description,full_description,features,status,is_featured,is_trending,is_deal,delivery_type,input_fields,delivery_instructions,refund_policy,terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, d.category_id, d.name, slug, d.image_key ?? null, d.short_description, d.full_description, JSON.stringify(d.features), d.status, +d.is_featured, +d.is_trending, +d.is_deal, d.delivery_type, JSON.stringify(d.input_fields), d.delivery_instructions ?? null, d.refund_policy ?? null, d.terms ?? null),
    ...d.plans.map((pl, i) => c.env.DB.prepare('INSERT INTO product_plans (id,product_id,name,duration,price_minor,compare_at_minor,stock,is_available,sort_order,provider_sku) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(uid(), id, pl.name, pl.duration ?? null, pl.price_minor, pl.compare_at_minor ?? null, d.delivery_type === 'inventory' ? null : (pl.stock ?? null), +pl.is_available, i, pl.provider_sku ?? null)),
    auditStmt(c.env.DB, actor(c), 'product.create', 'product', id, { name: d.name }),
  ]);
  return c.json({ id, slug }, 201);
});
admin.patch('/products/:id', requirePerm('products.manage'), async (c) => {
  const p = productSchema.omit({ plans: true }).partial().safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = (c.req.param('id') as string), d: any = p.data, sets: string[] = [], args: any[] = [];
  const cols: Record<string, (v: any) => any> = { category_id: v => v, name: v => v, image_key: v => v, short_description: v => v, full_description: v => v, features: JSON.stringify, status: v => v, is_featured: Number, is_trending: Number, is_deal: Number, delivery_type: v => v, provider_id: v => v, input_fields: JSON.stringify, delivery_instructions: v => v, refund_policy: v => v, terms: v => v };
  for (const [k, f] of Object.entries(cols)) if (d[k] !== undefined) { sets.push(`${k}=?`); args.push(f(d[k])); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  const r = await c.env.DB.prepare(`UPDATE products SET ${sets.join(',')}, updated_at=? WHERE id=?`).bind(...args, now(), id).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env.DB, actor(c), 'product.update', 'product', id, d);
  return c.json({ ok: true });
});
admin.delete('/products/:id', requirePerm('products.manage'), async (c) => {
  const id = (c.req.param('id') as string);
  const used = await c.env.DB.prepare('SELECT 1 x FROM order_items WHERE product_id=? LIMIT 1').bind(id).first();
  if (used) return c.json({ error: 'Product has orders; archive it instead' }, 409);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM products WHERE id=?').bind(id), auditStmt(c.env.DB, actor(c), 'product.delete', 'product', id)]);
  return c.json({ ok: true });
});
admin.post('/products/:id/plans', requirePerm('products.manage'), async (c) => {
  const p = planSchema.safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = uid(), d = p.data;
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO product_plans (id,product_id,name,duration,price_minor,compare_at_minor,stock,is_available,provider_sku) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, (c.req.param('id') as string), d.name, d.duration ?? null, d.price_minor, d.compare_at_minor ?? null, d.stock ?? null, +d.is_available, d.provider_sku ?? null), auditStmt(c.env.DB, actor(c), 'plan.create', 'plan', id, d)]);
  return c.json({ id }, 201);
});
admin.patch('/plans/:id', requirePerm('products.manage'), async (c) => {
  const p = planSchema.partial().safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const d: any = p.data, sets: string[] = [], args: any[] = [];
  for (const k of ['name', 'duration', 'price_minor', 'compare_at_minor', 'stock', 'provider_sku']) if (d[k] !== undefined) { sets.push(`${k}=?`); args.push(d[k]); }
  if (d.is_available !== undefined) { sets.push('is_available=?'); args.push(+d.is_available); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE product_plans SET ${sets.join(',')} WHERE id=?`).bind(...args, (c.req.param('id') as string)), auditStmt(c.env.DB, actor(c), 'plan.update', 'plan', (c.req.param('id') as string), d)]);
  return c.json({ ok: true });
});
admin.post('/categories', requirePerm('products.manage'), async (c) => {
  const p = z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(300).optional(), image_key: z.string().optional() }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = uid();
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO product_categories (id,name,slug,description,image_key) VALUES (?,?,?,?,?)').bind(id, p.data.name, slugify(p.data.name), p.data.description ?? null, p.data.image_key ?? null), auditStmt(c.env.DB, actor(c), 'category.create', 'category', id, p.data)]);
  return c.json({ id }, 201);
});

// ---------- Inventory ----------
admin.post('/inventory', requirePerm('inventory.manage'), async (c) => {
  const p = z.object({ plan_id: z.string(), items: z.array(z.string().min(1).max(2000)).min(1).max(500) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const plan = await c.env.DB.prepare('SELECT pl.id FROM product_plans pl JOIN products p ON p.id=pl.product_id WHERE pl.id=? AND p.delivery_type=?').bind(p.data.plan_id, 'inventory').first();
  if (!plan) return c.json({ error: 'Plan not found or product is not inventory-delivered' }, 400);
  const stmts = [];
  for (const it of p.data.items) stmts.push(c.env.DB.prepare('INSERT INTO product_inventory (id,plan_id,payload_encrypted) VALUES (?,?,?)').bind(uid(), p.data.plan_id, await encryptText(it, c.env.DELIVERY_KEY)));
  stmts.push(auditStmt(c.env.DB, actor(c), 'inventory.add', 'plan', p.data.plan_id, { count: p.data.items.length }));
  await c.env.DB.batch(stmts);
  return c.json({ added: p.data.items.length }, 201);
});
admin.get('/inventory', requirePerm('inventory.manage'), async (c) => c.json({ stock: (await c.env.DB.prepare(`SELECT plan_id, SUM(status='available') available, SUM(status='sold') sold FROM product_inventory GROUP BY plan_id`).all()).results }));

// ---------- Orders ----------
admin.get('/orders', requirePerm('orders.manage'), async (c) => {
  const st = c.req.query('status');
  const r = await c.env.DB.prepare(`SELECT o.id,o.order_number,o.status,o.payment_status,o.total_minor,o.created_at,o.contact_email,i.product_name,i.plan_name,i.delivery_type FROM orders o JOIN order_items i ON i.order_id=o.id ${st ? 'WHERE o.status=?' : ''} ORDER BY o.created_at DESC, o.rowid DESC LIMIT 200`).bind(...(st ? [st] : [])).all();
  return c.json({ orders: r.results });
});
admin.get('/orders/:id', requirePerm('orders.manage'), async (c) => {
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind((c.req.param('id') as string)).first<any>();
  if (!o) return c.json({ error: 'Not found' }, 404);
  const items = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id=?').bind(o.id).all();
  let delivery = null;
  if (c.get('user')!.perms.includes('deliveries.manage')) {
    const d = await c.env.DB.prepare('SELECT * FROM order_deliveries WHERE order_id=?').bind(o.id).first<any>();
    if (d) delivery = { method: d.method, note: d.note, delivered_at: d.delivered_at, details: await decryptText(d.payload_encrypted, c.env.DELIVERY_KEY) };
  }
  return c.json({ order: o, items: items.results, delivery });
});
admin.post('/orders/:id/deliver', requirePerm('deliveries.manage'), async (c) => {
  const p = z.object({ details: z.string().trim().min(1).max(5000), note: z.string().max(500).optional() }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = (c.req.param('id') as string), db = c.env.DB;
  const o = await db.prepare('SELECT id,user_id,status,order_number FROM orders WHERE id=?').bind(id).first<any>();
  if (!o) return c.json({ error: 'Not found' }, 404);
  if (o.status !== 'processing') return c.json({ error: `Order is ${o.status}` }, 409);
  try {
    await db.batch([
      db.prepare('INSERT INTO order_deliveries (id,order_id,method,payload_encrypted,note,delivered_by) VALUES (?,?,?,?,?,?)').bind(uid(), id, 'manual', await encryptText(p.data.details, c.env.DELIVERY_KEY), p.data.note ?? null, actor(c)),
      appendTimeline(db, id, 'completed', 'Delivered by staff'),
      notifyStmt(db, o.user_id, 'order_completed', 'Order completed', `${o.order_number} has been delivered.`, `/dashboard/orders/${id}`),
      auditStmt(db, actor(c), 'order.deliver', 'order', id),
    ]);
  } catch (e: any) { if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Already delivered' }, 409); throw e; }
  return c.json({ ok: true });
});
admin.post('/orders/:id/status', requirePerm('orders.manage'), async (c) => {
  const p = z.object({ status: z.enum(['cancelled', 'failed']), note: z.string().max(300).optional() }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = (c.req.param('id') as string), db = c.env.DB;
  const o = await db.prepare('SELECT user_id,status,order_number FROM orders WHERE id=?').bind(id).first<any>();
  if (!o) return c.json({ error: 'Not found' }, 404);
  if (o.status !== 'processing' && o.status !== 'pending') return c.json({ error: `Order is ${o.status}` }, 409);
  await db.batch([
    appendTimeline(db, id, p.data.status, p.data.note ?? `Marked ${p.data.status}`),
    notifyStmt(db, o.user_id, p.data.status === 'failed' ? 'order_failed' : 'order_cancelled', `Order ${p.data.status}`, `${o.order_number} was ${p.data.status}. Refund can be issued by support.`, `/dashboard/orders/${id}`),
    auditStmt(db, actor(c), `order.${p.data.status}`, 'order', id, p.data),
  ]);
  return c.json({ ok: true });
});
admin.post('/orders/:id/refund', requirePerm('refunds.manage'), async (c) => {
  const p = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = (c.req.param('id') as string), db = c.env.DB;
  const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<any>();
  if (!o) return c.json({ error: 'Not found' }, 404);
  if (o.payment_status !== 'paid' || o.total_minor <= 0) return c.json({ error: 'Nothing to refund' }, 409);
  try {
    await db.batch([
      db.prepare(`UPDATE orders SET payment_status='refunded', updated_at=? WHERE id=? AND payment_status='paid'`).bind(now(), id),
      db.prepare('INSERT INTO refunds (id,order_id,user_id,amount_minor,reason,issued_by) VALUES (?,?,?,?,?,?)').bind(uid(), id, o.user_id, o.total_minor, p.data.reason, actor(c)),
      ...ledgerStmts(db, { userId: o.user_id, amountMinor: o.total_minor, type: 'refund', reference: `ref:${id}`, refType: 'order', refId: id, description: `Refund ${o.order_number}`, actorId: actor(c) }),
      appendTimeline(db, id, 'refunded', p.data.reason),
      notifyStmt(db, o.user_id, 'refund_issued', 'Refund issued', `${o.order_number} was refunded to your wallet.`, '/dashboard/wallet'),
      auditStmt(db, actor(c), 'order.refund', 'order', id, { amount_minor: o.total_minor, reason: p.data.reason }),
    ]);
  } catch (e: any) { if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Already refunded' }, 409); throw e; }
  return c.json({ ok: true });
});

// ---------- Tickets ----------
admin.get('/tickets', requirePerm('tickets.manage'), async (c) => c.json({ tickets: (await c.env.DB.prepare('SELECT t.*, u.email FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 200').all()).results }));
admin.get('/tickets/:id', requirePerm('tickets.manage'), async (c) => c.json({ messages: (await c.env.DB.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY created_at, rowid').bind((c.req.param('id') as string)).all()).results }));
admin.post('/tickets/:id/reply', requirePerm('tickets.manage'), async (c) => {
  const p = z.object({ message: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const t = await c.env.DB.prepare('SELECT id,user_id,ticket_number FROM support_tickets WHERE id=?').bind((c.req.param('id') as string)).first<any>();
  if (!t) return c.json({ error: 'Not found' }, 404);
  const stmts = [c.env.DB.prepare('INSERT INTO support_messages (id,ticket_id,author_id,is_staff,is_internal,body) VALUES (?,?,?,1,?,?)').bind(uid(), t.id, actor(c), +p.data.internal, p.data.message)];
  if (!p.data.internal) stmts.push(c.env.DB.prepare(`UPDATE support_tickets SET status='waiting_customer', updated_at=? WHERE id=?`).bind(now(), t.id), notifyStmt(c.env.DB, t.user_id, 'support_reply', 'Support replied', `New reply on ${t.ticket_number}`, `/dashboard/tickets/${t.id}`));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
admin.post('/tickets/:id/update', requirePerm('tickets.manage'), async (c) => {
  const p = z.object({ status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(), assigned_to: z.string().nullable().optional() }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  if (p.data.assigned_to && !(await c.env.DB.prepare('SELECT 1 x FROM user_roles WHERE user_id=?').bind(p.data.assigned_to).first())) return c.json({ error: 'Assignee must be staff' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE support_tickets SET status=COALESCE(?,status), assigned_to=CASE WHEN ? THEN ? ELSE assigned_to END, updated_at=? WHERE id=?').bind(p.data.status ?? null, +(p.data.assigned_to !== undefined), p.data.assigned_to ?? null, now(), (c.req.param('id') as string)),
    auditStmt(c.env.DB, actor(c), 'ticket.update', 'ticket', (c.req.param('id') as string), p.data),
  ]);
  return c.json({ ok: true });
});

// ---------- Content, coupons, payment methods, settings ----------
admin.get('/banners', requirePerm('content.manage'), async (c) => c.json({ banners: (await c.env.DB.prepare('SELECT * FROM homepage_banners ORDER BY sort_order').all()).results }));
admin.post('/banners', requirePerm('content.manage'), async (c) => {
  const p = z.object({ title: z.string().min(2).max(120), subtitle: z.string().max(300).optional(), image_key: z.string().optional(), link_url: z.string().max(300).regex(/^(\/|https:\/\/)/).optional(), sort_order: z.number().int().default(0), is_active: z.boolean().default(true) }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const id = uid(), d = p.data;
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO homepage_banners (id,title,subtitle,image_key,link_url,sort_order,is_active) VALUES (?,?,?,?,?,?,?)').bind(id, d.title, d.subtitle ?? null, d.image_key ?? null, d.link_url ?? null, d.sort_order, +d.is_active), auditStmt(c.env.DB, actor(c), 'banner.create', 'banner', id)]);
  return c.json({ id }, 201);
});
admin.delete('/banners/:id', requirePerm('content.manage'), async (c) => { await c.env.DB.batch([c.env.DB.prepare('DELETE FROM homepage_banners WHERE id=?').bind((c.req.param('id') as string)), auditStmt(c.env.DB, actor(c), 'banner.delete', 'banner', (c.req.param('id') as string))]); return c.json({ ok: true }); });
admin.get('/coupons', requirePerm('coupons.manage'), async (c) => c.json({ coupons: (await c.env.DB.prepare('SELECT * FROM coupons').all()).results }));
admin.post('/coupons', requirePerm('coupons.manage'), async (c) => {
  const p = z.object({ code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/), type: z.enum(['percent', 'fixed']), value: z.number().int().positive(), max_uses: z.number().int().positive().nullable().optional(), min_order_minor: z.number().int().min(0).default(0), expires_at: z.number().int().nullable().optional() }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  if (p.data.type === 'percent' && p.data.value > 100) return c.json({ error: 'Percent max is 100' }, 400);
  const id = uid(), d = p.data;
  try { await c.env.DB.batch([c.env.DB.prepare('INSERT INTO coupons (id,code,type,value,max_uses,min_order_minor,expires_at) VALUES (?,?,?,?,?,?,?)').bind(id, d.code, d.type, d.value, d.max_uses ?? null, d.min_order_minor, d.expires_at ?? null), auditStmt(c.env.DB, actor(c), 'coupon.create', 'coupon', id, d)]); }
  catch (e: any) { if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Code exists' }, 409); throw e; }
  return c.json({ id }, 201);
});
admin.get('/payment-methods', requirePerm('payments.manage'), async (c) => c.json({ methods: (await c.env.DB.prepare('SELECT * FROM payment_methods ORDER BY sort_order').all()).results }));
admin.patch('/payment-methods/:id', requirePerm('payments.manage'), async (c) => {
  const p = z.object({ instructions: z.string().max(2000), account_title: z.string().max(120), account_number: z.string().max(80), min_amount_minor: z.number().int().min(100), max_amount_minor: z.number().int().nullable(), requires_proof: z.boolean(), is_active: z.boolean() }).partial().safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const d: any = p.data, sets: string[] = [], args: any[] = [];
  for (const [k, v] of Object.entries(d)) { sets.push(`${k}=?`); args.push(typeof v === 'boolean' ? +v : v); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE payment_methods SET ${sets.join(',')} WHERE id=? AND is_automatic=0`).bind(...args, (c.req.param('id') as string)), auditStmt(c.env.DB, actor(c), 'payment_method.update', 'payment_method', (c.req.param('id') as string), d)]);
  return c.json({ ok: true });
});
admin.put('/settings', requirePerm('settings.manage'), async (c) => {
  const p = z.record(z.string().max(20000)).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  const allowed = ['site_name', 'tagline', 'whatsapp', 'contact_email', 'about', 'faq_json', 'announcement', 'registration_enabled', 'page_about', 'page_terms', 'page_privacy', 'page_refund', 'hero_title', 'hero_subtitle'];
  const stmts = Object.entries(p.data).filter(([k]) => allowed.includes(k)).map(([k, v]) => c.env.DB.prepare('INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind(k, v, now()));
  if (!stmts.length) return c.json({ error: 'No valid settings' }, 400);
  await c.env.DB.batch([...stmts, auditStmt(c.env.DB, actor(c), 'settings.update', 'settings', 'site', p.data)]);
  return c.json({ ok: true });
});

// ---------- Staff & roles (Super Admin only via staff.manage) ----------
admin.get('/staff', requirePerm('staff.manage'), async (c) => c.json({ staff: (await c.env.DB.prepare('SELECT u.id,u.email,u.full_name,u.status,ur.role_id FROM users u JOIN user_roles ur ON ur.user_id=u.id').all()).results, roles: (await c.env.DB.prepare('SELECT id,name FROM roles').all()).results }));
admin.post('/staff', requirePerm('staff.manage'), async (c) => {
  const p = z.object({ email: z.string().email(), full_name: z.string().min(2).max(100), password: z.string().min(10).max(128), role_id: z.string() }).safeParse(await body(c));
  if (!p.success) return bad(c, p);
  if (!(await c.env.DB.prepare('SELECT 1 x FROM roles WHERE id=?').bind(p.data.role_id).first())) return c.json({ error: 'Unknown role' }, 400);
  if (await c.env.DB.prepare('SELECT 1 x FROM users WHERE email=?').bind(p.data.email).first()) return c.json({ error: 'Email already registered' }, 409);
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id,email,full_name,password_hash,email_verified_at) VALUES (?,?,?,?,?)').bind(id, p.data.email.toLowerCase(), p.data.full_name, await hashPassword(p.data.password), now()),
    c.env.DB.prepare('INSERT INTO wallet_accounts (user_id) VALUES (?)').bind(id),
    c.env.DB.prepare('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)').bind(id, p.data.role_id),
    auditStmt(c.env.DB, actor(c), 'staff.create', 'user', id, { email: p.data.email, role: p.data.role_id }),
  ]);
  return c.json({ id }, 201);
});
admin.get('/audit-logs', requirePerm('audit.view'), async (c) => c.json({ logs: (await c.env.DB.prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC, rowid DESC LIMIT 300').all()).results }));

// ---------- Reports (CSV, injection-safe) ----------
const csvCell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
admin.get('/reports/sales.csv', requirePerm('reports.view'), async (c) => {
  const r = await c.env.DB.prepare(`SELECT o.order_number,o.status,o.payment_status,o.total_minor,datetime(o.created_at,'unixepoch') created,i.product_name,i.plan_name FROM orders o JOIN order_items i ON i.order_id=o.id ORDER BY o.created_at DESC`).all<any>();
  const head = 'order_number,status,payment_status,total_pkr,created,product,plan';
  const rows = r.results.map(x => [x.order_number, x.status, x.payment_status, (x.total_minor / 100).toFixed(2), x.created, x.product_name, x.plan_name].map(csvCell).join(','));
  await audit(c.env.DB, actor(c), 'report.export', 'report', 'sales');
  return new Response([head, ...rows].join('\n'), { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="sales.csv"' } });
});
