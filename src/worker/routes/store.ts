import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AppVars } from '../env';
import { requireUser } from '../lib/session';
import { uid, now, orderNumber, notifyStmt, rateLimit } from '../lib/util';
import { ledgerStmts, getBalance } from '../lib/ledger';
import { decryptText } from '../lib/crypto';
import { claimInventory } from '../lib/delivery';
import { dispatchProvider } from '../lib/provider';

export const store = new Hono<{ Bindings: Env; Variables: AppVars }>();
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- Public catalog ----------
store.get('/categories', async (c) => {
  const r = await c.env.DB.prepare('SELECT id,name,slug,image_key,description FROM product_categories WHERE is_active=1 ORDER BY sort_order').all();
  return c.json({ categories: r.results });
});
const productSelect = `SELECT p.id,p.name,p.slug,p.image_key,p.short_description,p.is_featured,p.is_trending,p.is_deal,p.delivery_type,c.name category_name,c.slug category_slug,
  (SELECT MIN(price_minor) FROM product_plans WHERE product_id=p.id AND is_available=1) price_from_minor,
  (SELECT compare_at_minor FROM product_plans WHERE product_id=p.id AND is_available=1 ORDER BY price_minor LIMIT 1) compare_at_minor
  FROM products p JOIN product_categories c ON c.id=p.category_id WHERE p.status='active' AND c.is_active=1`;
store.get('/products', async (c) => {
  const q = c.req.query(); const page = Math.max(1, Number(q.page) || 1), size = Math.min(48, Number(q.size) || 24);
  let sql = productSelect; const args: any[] = [];
  if (q.category) { sql += ' AND c.slug=?'; args.push(q.category); }
  if (q.q) { sql += ' AND (p.name LIKE ? OR p.short_description LIKE ?)'; args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.featured === '1') sql += ' AND p.is_featured=1';
  if (q.trending === '1') sql += ' AND p.is_trending=1';
  if (q.deals === '1') sql += ' AND p.is_deal=1';
  const order = { price_asc: 'price_from_minor ASC', price_desc: 'price_from_minor DESC', name: 'p.name ASC' }[q.sort as string] ?? 'p.created_at DESC, p.name';
  sql += ` ORDER BY ${order} LIMIT ? OFFSET ?`; args.push(size, (page - 1) * size);
  const r = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ products: r.results, page, size });
});
store.get('/products/:slug', async (c) => {
  const p = await c.env.DB.prepare(`SELECT p.*, c.name category_name, c.slug category_slug FROM products p JOIN product_categories c ON c.id=p.category_id WHERE p.slug=? AND p.status='active'`).bind(c.req.param('slug')).first<any>();
  if (!p) return c.json({ error: 'Not found' }, 404);
  const plans = await c.env.DB.prepare('SELECT id,name,duration,price_minor,compare_at_minor,stock,is_available FROM product_plans WHERE product_id=? ORDER BY sort_order,price_minor').bind(p.id).all<any>();
  const inv = p.delivery_type === 'inventory'
    ? await c.env.DB.prepare(`SELECT plan_id, COUNT(*) n FROM product_inventory WHERE status='available' GROUP BY plan_id`).all<any>() : { results: [] as any[] };
  const avail = new Map(inv.results.map((x: any) => [x.plan_id, x.n]));
  delete p.provider_id;
  return c.json({ product: { ...p, features: parse(p.features, []), input_fields: parse(p.input_fields, []),
    plans: plans.results.map((pl: any) => ({ ...pl, in_stock: !!pl.is_available && (p.delivery_type === 'inventory' ? (avail.get(pl.id) ?? 0) > 0 : pl.stock === null || pl.stock > 0) })) } });
});
store.get('/banners', async (c) => c.json({ banners: (await c.env.DB.prepare('SELECT id,title,subtitle,image_key,link_url FROM homepage_banners WHERE is_active=1 ORDER BY sort_order').all()).results }));
store.get('/settings/public', async (c) => {
  const r = await c.env.DB.prepare('SELECT key,value FROM site_settings').all<any>();
  return c.json({ settings: Object.fromEntries(r.results.map((x: any) => [x.key, x.value])) });
});
store.get('/payment-methods', async (c) => c.json({ methods: (await c.env.DB.prepare('SELECT id,code,name,instructions,account_title,account_number,min_amount_minor,max_amount_minor,requires_proof FROM payment_methods WHERE is_active=1 AND is_automatic=0 ORDER BY sort_order').all()).results }));

// ---------- Authenticated customer ----------
const mine = new Hono<{ Bindings: Env; Variables: AppVars }>();
mine.use('*', requireUser);

mine.get('/dashboard', async (c) => {
  const u = c.get('user')!;
  const [bal, o, tx, notif, tk] = await Promise.all([
    getBalance(c.env.DB, u.id),
    c.env.DB.prepare(`SELECT COUNT(*) total, SUM(status='completed') completed, SUM(status IN ('pending','processing')) pending FROM orders WHERE user_id=?`).bind(u.id).first<any>(),
    c.env.DB.prepare('SELECT id,type,amount_minor,balance_after_minor,description,created_at FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 5').bind(u.id).all(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').bind(u.id).first<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) n FROM support_tickets WHERE user_id=? AND status NOT IN ('resolved','closed')`).bind(u.id).first<any>(),
  ]);
  const recent = await c.env.DB.prepare(`SELECT o.id,o.order_number,o.status,o.total_minor,o.created_at,i.product_name,i.plan_name FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC, o.rowid DESC LIMIT 5`).bind(u.id).all();
  return c.json({ wallet_balance_minor: bal, total_orders: o?.total ?? 0, completed_orders: o?.completed ?? 0, pending_orders: o?.pending ?? 0,
    unread_notifications: notif?.n ?? 0, open_tickets: tk?.n ?? 0, recent_orders: recent.results, recent_transactions: tx.results });
});

mine.get('/wallet', async (c) => {
  const u = c.get('user')!;
  const [tx, dep] = await Promise.all([
    c.env.DB.prepare('SELECT id,reference,type,amount_minor,balance_after_minor,description,created_at FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100').bind(u.id).all(),
    c.env.DB.prepare('SELECT d.id,d.amount_minor,d.status,d.payment_reference,d.review_note,d.created_at,m.name method FROM deposits d JOIN payment_methods m ON m.id=d.payment_method_id WHERE d.user_id=? ORDER BY d.created_at DESC LIMIT 50').bind(u.id).all(),
  ]);
  return c.json({ balance_minor: await getBalance(c.env.DB, u.id), transactions: tx.results, deposits: dep.results });
});

mine.post('/deposits', async (c) => {
  const u = c.get('user')!;
  if (!(await rateLimit(c.env.DB, `dep:${u.id}`, 10, 3600))) return c.json({ error: 'Too many deposit requests' }, 429);
  const p = z.object({ payment_method_id: z.string(), amount_minor: z.number().int().positive(), payment_reference: z.string().trim().min(4).max(100), proof_key: z.string().max(300).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed', issues: p.error.flatten().fieldErrors }, 400);
  const d = p.data;
  const m = await c.env.DB.prepare('SELECT * FROM payment_methods WHERE id=? AND is_active=1 AND is_automatic=0').bind(d.payment_method_id).first<any>();
  if (!m) return c.json({ error: 'Payment method unavailable' }, 400);
  if (d.amount_minor < m.min_amount_minor || (m.max_amount_minor && d.amount_minor > m.max_amount_minor)) return c.json({ error: 'Amount outside allowed range' }, 400);
  if (m.requires_proof && !d.proof_key) return c.json({ error: 'Payment proof is required' }, 400);
  if (d.proof_key && !d.proof_key.startsWith(`proofs/${u.id}/`)) return c.json({ error: 'Invalid proof file' }, 400);
  const id = uid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO deposits (id,user_id,payment_method_id,amount_minor,payment_reference,proof_key) VALUES (?,?,?,?,?,?)').bind(id, u.id, m.id, d.amount_minor, d.payment_reference, d.proof_key ?? null),
      notifyStmt(c.env.DB, u.id, 'deposit_submitted', 'Deposit submitted', 'Your deposit is awaiting review.', '/dashboard/wallet'),
    ]);
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) return c.json({ error: 'This payment reference was already submitted' }, 409);
    throw e;
  }
  return c.json({ id, status: 'pending' }, 201);
});

// Secure upload (R2). Key is namespaced by user; type/size validated.
mine.post('/uploads', async (c) => {
  const u = c.get('user')!;
  if (!c.env.UPLOADS) return c.json({ error: 'Storage not configured' }, 501);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file') as unknown as File | null;
  const kind = form?.get('kind') === 'attachment' ? 'attachments' : 'proofs';
  if (!file || typeof file === 'string') return c.json({ error: 'file required' }, 400);
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) return c.json({ error: 'PNG/JPG/WEBP/PDF up to 5MB only' }, 400);
  const key = `${kind}/${u.id}/${uid()}`;
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return c.json({ key }, 201);
});

// ---------- Checkout ----------
const checkoutSchema = z.object({
  plan_id: z.string(), contact_name: z.string().trim().min(2).max(100), contact_email: z.string().email(), contact_phone: z.string().trim().min(7).max(20),
  inputs: z.record(z.string().max(500)).default({}), coupon_code: z.string().trim().max(40).optional(),
});
mine.post('/checkout', async (c) => {
  const u = c.get('user')!;
  const idem = c.req.header('idempotency-key');
  if (!idem || idem.length < 8 || idem.length > 100) return c.json({ error: 'Idempotency-Key header required' }, 400);
  const p = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed', issues: p.error.flatten().fieldErrors }, 400);
  const d = p.data;

  const dup = await c.env.DB.prepare('SELECT id,order_number,status FROM orders WHERE user_id=? AND idempotency_key=?').bind(u.id, idem).first<any>();
  if (dup) return c.json({ order: dup, duplicate: true });

  const plan = await c.env.DB.prepare(`SELECT pl.*, p.name product_name, p.delivery_type, p.input_fields, p.provider_id, p.status pstatus FROM product_plans pl JOIN products p ON p.id=pl.product_id WHERE pl.id=?`).bind(d.plan_id).first<any>();
  if (!plan || plan.pstatus !== 'active' || !plan.is_available) return c.json({ error: 'This plan is not available' }, 400);
  if (plan.delivery_type === 'inventory') {
    const n = await c.env.DB.prepare(`SELECT COUNT(*) n FROM product_inventory WHERE plan_id=? AND status='available'`).bind(plan.id).first<any>();
    if (!n || n.n < 1) return c.json({ error: 'Out of stock' }, 409);
  } else if (plan.stock !== null && plan.stock < 1) return c.json({ error: 'Out of stock' }, 409);

  const fields = parse(plan.input_fields, []) as { key: string; label: string; required?: boolean }[];
  const inputs: Record<string, string> = {};
  for (const f of fields) {
    const v = (d.inputs[f.key] ?? '').trim();
    if (f.required && !v) return c.json({ error: `${f.label} is required` }, 400);
    if (v) inputs[f.key] = v;
  }

  const subtotal = plan.price_minor as number;
  let discount = 0; let couponId: string | null = null;
  if (d.coupon_code) {
    const cp = await c.env.DB.prepare('SELECT * FROM coupons WHERE code=? AND is_active=1').bind(d.coupon_code).first<any>();
    if (!cp || (cp.expires_at && cp.expires_at < now()) || (cp.max_uses !== null && cp.used_count >= cp.max_uses) || subtotal < cp.min_order_minor) return c.json({ error: 'Invalid coupon' }, 400);
    const used = await c.env.DB.prepare('SELECT 1 x FROM coupon_redemptions WHERE coupon_id=? AND user_id=?').bind(cp.id, u.id).first();
    if (used) return c.json({ error: 'Coupon already used' }, 400);
    discount = cp.type === 'percent' ? Math.floor(subtotal * Math.min(cp.value, 100) / 100) : Math.min(cp.value, subtotal);
    couponId = cp.id;
  }
  const total = subtotal - discount;
  const balance = await getBalance(c.env.DB, u.id);
  if (balance < total) return c.json({ error: 'Insufficient wallet balance', required_minor: total - balance, balance_minor: balance, add_funds: true }, 402);

  const orderId = uid(), number = orderNumber();
  const timeline = JSON.stringify([{ at: now(), status: 'processing', note: 'Order placed and paid from wallet' }]);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('INSERT INTO orders (id,order_number,user_id,idempotency_key,status,payment_status,subtotal_minor,discount_minor,total_minor,coupon_id,contact_name,contact_email,contact_phone,timeline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(orderId, number, u.id, idem, 'processing', 'paid', subtotal, discount, total, couponId, d.contact_name, d.contact_email, d.contact_phone, timeline),
    c.env.DB.prepare('INSERT INTO order_items (id,order_id,product_id,plan_id,product_name,plan_name,delivery_type,unit_price_minor,customer_inputs) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(uid(), orderId, plan.product_id, plan.id, plan.product_name, plan.name, plan.delivery_type, subtotal, JSON.stringify(inputs)),
  ];
  if (total > 0) stmts.push(...ledgerStmts(c.env.DB, { userId: u.id, amountMinor: -total, type: 'purchase', reference: `ord:${orderId}`, refType: 'order', refId: orderId, description: `Order ${number}` }));
  if (plan.stock !== null && plan.delivery_type !== 'inventory') stmts.push(c.env.DB.prepare('UPDATE product_plans SET stock = stock - 1 WHERE id=?').bind(plan.id)); // CHECK(stock>=0) aborts on oversell
  if (couponId) stmts.push(
    c.env.DB.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id=?').bind(couponId), // CHECK(used_count<=max_uses)
    c.env.DB.prepare('INSERT INTO coupon_redemptions (id,coupon_id,user_id,order_id) VALUES (?,?,?,?)').bind(uid(), couponId, u.id, orderId));
  stmts.push(notifyStmt(c.env.DB, u.id, 'order_placed', 'Order placed', `${number} is being processed.`, `/dashboard/orders/${orderId}`));
  try { await c.env.DB.batch(stmts); }
  catch (e: any) {
    const m = String(e.message);
    if (m.includes('UNIQUE') && m.includes('idempotency')) { const o = await c.env.DB.prepare('SELECT id,order_number,status FROM orders WHERE user_id=? AND idempotency_key=?').bind(u.id, idem).first(); return c.json({ order: o, duplicate: true }); }
    if (m.includes('CHECK') && m.includes('balance')) return c.json({ error: 'Insufficient wallet balance', add_funds: true }, 402);
    if (m.includes('CHECK') && m.includes('stock')) return c.json({ error: 'Out of stock' }, 409);
    if (m.includes('CHECK') || m.includes('UNIQUE')) return c.json({ error: 'Could not place order. Please retry.' }, 409);
    throw e;
  }
  let status = 'processing';
  if (plan.delivery_type === 'inventory') status = (await claimInventory(c.env, orderId, plan.id, u.id, number)) ? 'completed' : 'processing';
  else if (plan.delivery_type === 'api') { try { status = (await dispatchProvider(c.env, orderId)).delivered ? 'completed' : 'processing'; } catch (e) { console.error('provider dispatch failed', e); } }
  return c.json({ order: { id: orderId, order_number: number, status, total_minor: total } }, 201);
});

// ---------- Orders ----------
mine.get('/orders', async (c) => {
  const u = c.get('user')!;
  const r = await c.env.DB.prepare(`SELECT o.id,o.order_number,o.status,o.payment_status,o.total_minor,o.created_at,i.product_name,i.plan_name FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC, o.rowid DESC LIMIT 100`).bind(u.id).all();
  return c.json({ orders: r.results });
});
mine.get('/orders/:id', async (c) => {
  const u = c.get('user')!;
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first<any>(); // ownership enforced in query
  if (!o) return c.json({ error: 'Not found' }, 404);
  const items = await c.env.DB.prepare('SELECT product_name,plan_name,delivery_type,unit_price_minor,customer_inputs FROM order_items WHERE order_id=?').bind(o.id).all<any>();
  const del = await c.env.DB.prepare('SELECT method,payload_encrypted,note,delivered_at FROM order_deliveries WHERE order_id=?').bind(o.id).first<any>();
  let delivery = null;
  if (del) delivery = { method: del.method, note: del.note, delivered_at: del.delivered_at, details: await decryptText(del.payload_encrypted, c.env.DELIVERY_KEY) };
  return c.json({ order: { ...o, timeline: parse(o.timeline, []) }, items: items.results.map((i: any) => ({ ...i, customer_inputs: parse(i.customer_inputs, {}) })), delivery });
});
// Public order tracking: requires order number AND the contact email on the order. Never returns delivery data.
store.get('/track', async (c) => {
  const n = c.req.query('order'), e = c.req.query('email');
  if (!n || !e) return c.json({ error: 'order and email required' }, 400);
  if (!(await rateLimit(c.env.DB, `track:${c.req.header('cf-connecting-ip') ?? 'local'}`, 20, 600))) return c.json({ error: 'Too many requests' }, 429);
  const o = await c.env.DB.prepare('SELECT order_number,status,payment_status,created_at,timeline FROM orders WHERE order_number=? AND lower(contact_email)=lower(?)').bind(n, e).first<any>();
  if (!o) return c.json({ error: 'Order not found' }, 404);
  return c.json({ order: { ...o, timeline: parse(o.timeline, []) } });
});

// ---------- Notifications ----------
mine.get('/notifications', async (c) => c.json({ notifications: (await c.env.DB.prepare('SELECT id,type,title,body,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(c.get('user')!.id).all()).results }));
mine.post('/notifications/read', async (c) => { await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now(), c.get('user')!.id).run(); return c.json({ ok: true }); });

// ---------- Tickets ----------
mine.get('/tickets', async (c) => c.json({ tickets: (await c.env.DB.prepare('SELECT id,ticket_number,category,subject,status,created_at,updated_at FROM support_tickets WHERE user_id=? ORDER BY updated_at DESC').bind(c.get('user')!.id).all()).results }));
mine.post('/tickets', async (c) => {
  const u = c.get('user')!;
  const p = z.object({ category: z.string().min(2).max(40), subject: z.string().trim().min(3).max(150), message: z.string().trim().min(3).max(5000), attachment_key: z.string().optional(), order_id: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed' }, 400);
  const d = p.data;
  if (d.attachment_key && !d.attachment_key.startsWith(`attachments/${u.id}/`)) return c.json({ error: 'Invalid attachment' }, 400);
  if (d.order_id && !(await c.env.DB.prepare('SELECT 1 x FROM orders WHERE id=? AND user_id=?').bind(d.order_id, u.id).first())) return c.json({ error: 'Invalid order' }, 400);
  const id = uid(), num = `TKT-${Math.floor(Date.now() / 1000).toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO support_tickets (id,ticket_number,user_id,category,subject,order_id) VALUES (?,?,?,?,?,?)').bind(id, num, u.id, d.category, d.subject, d.order_id ?? null),
    c.env.DB.prepare('INSERT INTO support_messages (id,ticket_id,author_id,body,attachment_key) VALUES (?,?,?,?,?)').bind(uid(), id, u.id, d.message, d.attachment_key ?? null),
  ]);
  return c.json({ id, ticket_number: num }, 201);
});
mine.get('/tickets/:id', async (c) => {
  const u = c.get('user')!;
  const t = await c.env.DB.prepare('SELECT id,ticket_number,category,subject,status,created_at FROM support_tickets WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first();
  if (!t) return c.json({ error: 'Not found' }, 404);
  const m = await c.env.DB.prepare('SELECT id,is_staff,body,attachment_key,created_at FROM support_messages WHERE ticket_id=? AND is_internal=0 ORDER BY created_at, rowid').bind(c.req.param('id')).all();
  return c.json({ ticket: t, messages: m.results });
});
mine.post('/tickets/:id/reply', async (c) => {
  const u = c.get('user')!;
  const p = z.object({ message: z.string().trim().min(1).max(5000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'Validation failed' }, 400);
  const t = await c.env.DB.prepare('SELECT id,status FROM support_tickets WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first<any>();
  if (!t) return c.json({ error: 'Not found' }, 404);
  if (t.status === 'closed') return c.json({ error: 'Ticket is closed' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO support_messages (id,ticket_id,author_id,body) VALUES (?,?,?,?)').bind(uid(), t.id, u.id, p.data.message),
    c.env.DB.prepare(`UPDATE support_tickets SET status='open', updated_at=? WHERE id=?`).bind(now(), t.id),
  ]);
  return c.json({ ok: true });
});

store.route('/me', mine);
