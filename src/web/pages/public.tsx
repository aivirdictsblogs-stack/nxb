import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Async, Badge, Empty, Field, Pager, Spinner, api, errMsg, fmt, imgUrl, useApi, useAuth, useTitle, useToast, ErrorBox } from '../lib';

export type Product = { id: string; name: string; slug: string; image_key: string | null; short_description: string; is_featured: number; is_trending: number; is_deal: number; category_name: string; category_slug: string; price_from_minor: number | null; compare_at_minor: number | null; delivery_type: string };
const Tile = ({ p, big }: { p: { name: string; image_key: string | null }; big?: boolean }) => imgUrl(p.image_key)
  ? <img src={imgUrl(p.image_key)!} alt={p.name} loading="lazy" className={`${big ? 'h-full' : 'h-36'} w-full object-cover`} />
  : <div className={`${big ? 'h-full min-h-[220px]' : 'h-36'} grid w-full place-items-center bg-gradient-to-br from-navy via-navy-700 to-electric-600 text-4xl font-black text-white`}>{p.name.slice(0, 1)}</div>;

export function ProductCard({ p }: { p: Product }) {
  const off = p.compare_at_minor && p.price_from_minor && p.compare_at_minor > p.price_from_minor ? Math.round((1 - p.price_from_minor / p.compare_at_minor) * 100) : 0;
  return <Link to={`/products/${p.slug}`} className="card group relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-glow">
    <div className="relative overflow-hidden"><Tile p={p} />{off > 0 && <span className="badge absolute right-2 top-2 bg-electric text-white">{off}% OFF</span>}{p.is_trending ? <span className="badge absolute left-2 top-2 bg-navy/80 text-white">Trending</span> : null}</div>
    <div className="flex flex-1 flex-col p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-electric">{p.category_name}</p><h3 className="mt-0.5 font-bold leading-snug">{p.name}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.short_description}</p>
      <div className="mt-auto flex items-end justify-between pt-3"><div>{p.price_from_minor === null ? <span className="text-sm text-slate-400">Unavailable</span> : <><span className="text-[10px] text-slate-400">From </span><span className="text-lg font-extrabold">{fmt(p.price_from_minor)}</span></>}{off > 0 && <div className="text-xs text-slate-400 line-through">{fmt(p.compare_at_minor)}</div>}</div><span className="btn-primary btn-sm">View plans</span></div></div></Link>;
}
const Grid = ({ items }: { items: Product[] }) => <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{items.map(p => <ProductCard key={p.id} p={p} />)}</div>;
function Section({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) { return <section className="mx-auto max-w-7xl px-4 pt-12"><div className="mb-5 flex items-end justify-between"><h2 className="text-xl font-extrabold sm:text-2xl">{title}</h2>{to && <Link to={to} className="text-sm font-semibold text-electric">View all →</Link>}</div>{children}</section>; }
function Row({ query, title, to }: { query: string; title: string; to: string }) {
  const r = useApi<{ products: Product[] }>(`/products?${query}`);
  if (r.loading) return <Section title={title}><Spinner /></Section>;
  if (r.error || !r.data?.products.length) return null;
  return <Section title={title} to={to}><Grid items={r.data.products} /></Section>;
}

export const DEFAULT_FAQ = [['How fast is delivery?', 'Most orders are delivered within minutes during working hours. Delivery details appear in your account under Orders and you are notified instantly.'], ['How do I add wallet funds?', 'Open Wallet → Add funds, pay using an active method (Bank Transfer, Easypaisa, JazzCash), submit your payment reference and proof. Funds are credited after our team verifies the payment.'], ['Can I get a refund?', 'Refunds are issued to your Noorix wallet according to our Refund Policy. Open a support ticket from your dashboard.'], ['Is my data safe?', 'Passwords are hashed, sessions are secure HTTP-only cookies and delivery credentials are encrypted at rest.']];

export function Home() {
  useTitle('All-in-One Digital Solutions Under One Roof', 'Premium digital subscriptions, AI tools, streaming and software at the best prices in Pakistan.');
  const nav = useNavigate(); const [q, setQ] = useState('');
  const cats = useApi<{ categories: { id: string; name: string; slug: string; image_key: string | null }[] }>('/categories');
  const banners = useApi<{ banners: { id: string; title: string; subtitle: string; link_url: string; image_key: string }[] }>('/banners');
  const st = useApi<{ settings: Record<string, string> }>('/settings/public');
  const s = st.data?.settings ?? {};
  return <>
    <section className="hero-bg text-white"><div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 md:grid-cols-2 md:py-20">
      <div><span className="badge bg-electric/20 text-electric-400">Premium digital marketplace</span>
        <h1 className="mt-4 text-4xl font-black leading-[1.05] sm:text-5xl">{s.hero_title || <>All-in-One Digital Solutions <span className="text-electric-400">Under One Roof.</span></>}</h1>
        <p className="mt-4 max-w-lg text-slate-300">{s.hero_subtitle || 'Premium subscriptions, AI tools and digital products at the best prices — paid from your Noorix wallet and delivered to your account.'}</p>
        <form className="mt-6 flex max-w-lg gap-2" role="search" onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/products?q=${encodeURIComponent(q)}`); }}>
          <input aria-label="Search products" className="input flex-1 border-0" placeholder="Search for products…" value={q} onChange={e => setQ(e.target.value)} /><button className="btn-primary">Search</button></form>
        <div className="mt-8 grid max-w-lg grid-cols-2 gap-3 text-sm text-slate-200 sm:grid-cols-4">{['Instant delivery', 'Secure payments', '24/7 support', 'Best prices'].map(t => <div key={t} className="flex items-center gap-2"><span className="text-electric-400">✔</span>{t}</div>)}</div></div>
      <div className="relative hidden md:block"><div className="absolute -inset-6 rounded-full bg-electric/30 blur-3xl" /><div className="card relative rotate-1 border-white/10 bg-white/5 p-6 backdrop-blur"><div className="grid grid-cols-3 gap-3">{['N', 'P', 'Y', 'S', 'C', 'G'].map(c => <div key={c} className="grid aspect-square place-items-center rounded-2xl bg-navy-700 text-3xl font-black text-electric-400">{c}</div>)}</div><p className="mt-4 text-center text-sm text-slate-300">Netflix · Prime · YouTube · Spotify · Canva · AI tools</p></div></div>
    </div></section>
    {banners.data?.banners.length ? <section className="mx-auto max-w-7xl px-4 pt-8"><div className="grid gap-3 md:grid-cols-2">{banners.data.banners.map(b => <Link key={b.id} to={b.link_url || '/products'} className="hero-bg relative overflow-hidden rounded-2xl p-6 text-white shadow-card">{imgUrl(b.image_key) && <img src={imgUrl(b.image_key)!} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" loading="lazy" />}<div className="relative"><h3 className="text-xl font-extrabold">{b.title}</h3><p className="mt-1 text-sm text-slate-200">{b.subtitle}</p></div></Link>)}</div></section> : null}
    <Section title="Popular categories" to="/categories"><Async r={cats}>{d => <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{d.categories.map(c => <Link key={c.id} to={`/categories/${c.slug}`} className="card flex items-center gap-3 p-4 transition hover:shadow-glow"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-electric-100 font-black text-electric">{c.name[0]}</span><span className="text-sm font-semibold leading-tight">{c.name}</span></Link>)}</div>}</Async></Section>
    <Row title="Featured products" query="featured=1&size=8" to="/products" />
    <Row title="Trending products" query="trending=1&size=8" to="/trending" />
    <Row title="Special offers & deals" query="deals=1&size=8" to="/deals" />
    <Row title="Best-selling subscriptions" query="category=streaming&size=4" to="/categories/streaming" />
    <Row title="AI tools" query="category=ai-tools&size=4" to="/categories/ai-tools" />
    <Row title="Recently added" query="size=8" to="/products" />
    <Section title="Why choose Noorix"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['⚡', 'Fast delivery', 'Automatic or staff-verified delivery straight to your account.'], ['🔒', 'Secure wallet', 'Every rupee is tracked in an immutable ledger.'], ['💬', 'Real support', 'Ticket system plus WhatsApp for quick help.'], ['💎', 'Great prices', 'Premium digital access at honest PKR prices.']].map(([i, t, d]) => <div key={t} className="card p-5"><div className="text-2xl">{i}</div><h3 className="mt-3 font-bold">{t}</h3><p className="mt-1 text-sm text-slate-500">{d}</p></div>)}</div></Section>
    <Section title="How it works"><ol className="grid gap-4 sm:grid-cols-4">{['Create your account', 'Add funds to your wallet', 'Choose a product and plan', 'Receive delivery in your account'].map((t, i) => <li key={t} className="card p-5"><span className="grid h-9 w-9 place-items-center rounded-full bg-electric font-bold text-white">{i + 1}</span><p className="mt-3 font-semibold">{t}</p></li>)}</ol></Section>
    <Section title="Frequently asked questions" to="/faq"><FaqList items={DEFAULT_FAQ.slice(0, 3)} /></Section>
  </>;
}
export function FaqList({ items }: { items: string[][] }) { return <div className="space-y-3">{items.map(([q, a]) => <details key={q} className="card group p-4"><summary className="cursor-pointer list-none font-semibold">{q}</summary><p className="mt-2 text-sm text-slate-600">{a}</p></details>)}</div>; }

export function ProductList({ title, fixed, forceCategory }: { title: string; fixed?: string; forceCategory?: string }) {
  const [sp, setSp] = useSearchParams(); const params = useParams();
  const page = Number(sp.get('page') || 1), q = sp.get('q') ?? '', sort = sp.get('sort') ?? 'new';
  const category = forceCategory ?? params.slug ?? sp.get('category') ?? '';
  const size = 12;
  const qs = new URLSearchParams({ page: String(page), size: String(size), sort }); if (q) qs.set('q', q); if (category) qs.set('category', category); const extra = fixed ? `&${fixed}` : '';
  const cats = useApi<{ categories: { slug: string; name: string }[] }>('/categories'); const r = useApi<{ products: Product[] }>(`/products?${qs}${extra}`);
  const catName = cats.data?.categories.find(c => c.slug === category)?.name;
  useTitle(catName ?? (q ? `Search: ${q}` : title), `Browse ${catName ?? title.toLowerCase()} at Noorix Digital Lab.`);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n); };
  return <div className="mx-auto max-w-7xl px-4 py-8">
    <h1 className="text-2xl font-extrabold">{q ? `Results for “${q}”` : catName ?? title}</h1>
    <div className="mt-4 flex flex-wrap gap-3">
      <input aria-label="Search" className="input max-w-xs" placeholder="Search products" defaultValue={q} onKeyDown={e => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value)} />
      {!forceCategory && !params.slug && <select aria-label="Category" className="input max-w-[220px]" value={category} onChange={e => set('category', e.target.value)}><option value="">All categories</option>{cats.data?.categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>}
      <select aria-label="Sort" className="input max-w-[200px]" value={sort} onChange={e => set('sort', e.target.value)}><option value="new">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name A–Z</option></select>
    </div>
    <div className="mt-6"><Async r={r}>{d => d.products.length ? <><Grid items={d.products} /><Pager page={page} setPage={n => set('page', String(n))} hasMore={d.products.length === size} /></> : <Empty title="No products found" hint="Try a different search or category." action={<Link className="btn-primary" to="/products">Clear filters</Link>} />}</Async></div></div>;
}
export const AllProducts = () => <ProductList title="All products" />;
export const Deals = () => <ProductList title="Today's deals" fixed="deals=1" />;
export const Trending = () => <ProductList title="Trending products" fixed="trending=1" />;
export function Categories() {
  useTitle('Categories', 'Browse all Noorix Digital Lab product categories.');
  const r = useApi<{ categories: { id: string; name: string; slug: string; description: string | null }[] }>('/categories');
  return <div className="mx-auto max-w-7xl px-4 py-8"><h1 className="mb-5 text-2xl font-extrabold">Product categories</h1><Async r={r}>{d => <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.categories.map(c => <Link key={c.id} to={`/categories/${c.slug}`} className="card flex items-center gap-4 p-5 transition hover:shadow-glow"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-navy to-electric-600 text-2xl font-black text-white">{c.name[0]}</span><div><h3 className="font-bold">{c.name}</h3><p className="text-sm text-slate-500">{c.description ?? 'Browse products →'}</p></div></Link>)}</div>}</Async></div>;
}

type Plan = { id: string; name: string; duration: string | null; price_minor: number; compare_at_minor: number | null; in_stock: boolean };
type Detail = { id: string; name: string; slug: string; image_key: string | null; short_description: string; full_description: string; features: string[]; category_name: string; category_slug: string; delivery_type: string; delivery_instructions: string | null; refund_policy: string | null; terms: string | null; plans: Plan[] };
export function ProductDetail() {
  const { slug } = useParams(); const nav = useNavigate(); const { user } = useAuth();
  const r = useApi<{ product: Detail }>(`/products/${slug}`); const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState('Description');
  useTitle(r.data?.product.name ?? 'Product', r.data?.product.short_description);
  if (r.loading) return <Spinner full />; if (r.error) return <div className="mx-auto max-w-lg px-4 py-16"><ErrorBox msg={r.error} /><Link to="/products" className="btn-primary mt-4">Browse products</Link></div>;
  const p = r.data!.product; const plan = p.plans.find(x => x.id === (sel ?? p.plans.find(y => y.in_stock)?.id)) ?? p.plans[0];
  const tabs = ['Description', 'Features', 'Delivery', 'Terms'];
  return <div className="mx-auto max-w-6xl px-4 py-8">
    <nav className="mb-4 text-sm text-slate-500"><Link to="/products">Products</Link> / <Link to={`/categories/${p.category_slug}`}>{p.category_name}</Link> / {p.name}</nav>
    <div className="grid gap-8 md:grid-cols-[320px_1fr]">
      <div className="card overflow-hidden"><Tile p={p} big /></div>
      <div><h1 className="text-3xl font-extrabold">{p.name}</h1><p className="mt-2 text-slate-600">{p.short_description}</p>
        {plan && <div className="mt-5 flex items-end gap-3"><span className="text-3xl font-black text-electric">{fmt(plan.price_minor)}</span>{plan.compare_at_minor && plan.compare_at_minor > plan.price_minor && <><span className="text-slate-400 line-through">{fmt(plan.compare_at_minor)}</span><span className="badge bg-emerald-100 text-emerald-700">{Math.round((1 - plan.price_minor / plan.compare_at_minor) * 100)}% off</span></>}</div>}
        <h2 className="mb-2 mt-6 text-sm font-bold">Choose a plan</h2>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Plans">{p.plans.map(pl => <button key={pl.id} role="radio" aria-checked={plan?.id === pl.id} disabled={!pl.in_stock} onClick={() => setSel(pl.id)} className={`rounded-2xl border-2 p-4 text-left transition ${plan?.id === pl.id ? 'border-electric bg-electric-100/50' : 'border-slate-200 bg-white'} ${!pl.in_stock ? 'opacity-50' : 'hover:border-electric/60'}`}>
          <div className="flex justify-between"><b>{pl.name}</b><span className="font-bold">{fmt(pl.price_minor)}</span></div><div className="mt-1 flex justify-between text-xs text-slate-500"><span>{pl.duration}</span><span className={pl.in_stock ? 'text-emerald-600' : 'text-red-600'}>{pl.in_stock ? 'In stock' : 'Out of stock'}</span></div></button>)}</div>
        <div className="mt-6 flex flex-wrap gap-3"><button className="btn-primary px-8" disabled={!plan?.in_stock} onClick={() => nav(`/checkout?plan=${plan!.id}&product=${p.slug}`)}>{user ? 'Buy now' : 'Login to buy'}</button><a className="btn-ghost" href="/contact">Ask a question</a></div>
        <ul className="mt-5 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">{p.features.slice(0, 4).map(f => <li key={f}>✔ {f}</li>)}</ul>
      </div></div>
    <div className="card mt-8 p-5"><div className="flex gap-1 overflow-x-auto border-b border-slate-100 pb-2" role="tablist">{tabs.map(t => <button key={t} role="tab" aria-selected={tab === t} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-electric text-white' : 'text-slate-600'}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{tab === 'Description' && (p.full_description || p.short_description)}{tab === 'Features' && (p.features.length ? p.features.map(f => `✔ ${f}`).join('\n') : 'No features listed.')}{tab === 'Delivery' && `Delivery method: ${p.delivery_type === 'inventory' ? 'Automatic (instant)' : p.delivery_type === 'api' ? 'Automatic via supplier' : 'Manual (processed by our team)'}\n${p.delivery_instructions ?? ''}`}{tab === 'Terms' && `${p.terms ?? ''}\n${p.refund_policy ?? 'See our Refund Policy.'}`}</div></div></div>;
}

export function TrackOrder() {
  useTitle('Track order', 'Track your Noorix order using your order number and email.');
  const [f, setF] = useState({ order: '', email: '' }); const [res, setRes] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); setRes(null); try { setRes((await api(`/track?order=${encodeURIComponent(f.order.trim())}&email=${encodeURIComponent(f.email.trim())}`)).order); } catch (x) { setErr(errMsg(x)); } setBusy(false); };
  return <div className="mx-auto max-w-xl px-4 py-10"><h1 className="text-2xl font-extrabold">Track your order</h1><p className="mt-1 text-sm text-slate-500">Enter your order number and the email used at checkout. Delivery details are only visible after logging in.</p>
    <form onSubmit={go} className="card mt-5 space-y-4 p-6"><Field label="Order number"><input className="input" required placeholder="NDL-20260101-ABCDEF12" value={f.order} onChange={e => setF({ ...f, order: e.target.value })} /></Field><Field label="Email"><input className="input" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>{err && <p className="text-sm text-red-600" role="alert">{err}</p>}<button className="btn-primary w-full" disabled={busy}>{busy ? 'Checking…' : 'Track order'}</button></form>
    {res && <div className="card mt-5 p-6"><div className="flex items-center justify-between"><b>{res.order_number}</b><Badge s={res.status} /></div><ol className="mt-4 space-y-3 border-l-2 border-electric/30 pl-4">{res.timeline.map((t: any, i: number) => <li key={i}><Badge s={t.status} /><p className="text-sm text-slate-600">{t.note}</p></li>)}</ol></div>}</div>;
}

const POLICY: Record<string, [string, string, string]> = {
  about: ['About Noorix Digital Lab', 'page_about', 'Noorix Digital Lab is a digital marketplace for subscriptions, AI tools, streaming, software and digital services.\n\nOur mission is simple: All-in-One Digital Solutions Under One Roof — with transparent PKR pricing, a secure wallet and dependable delivery.'],
  terms: ['Terms & Conditions', 'page_terms', 'By using Noorix Digital Lab you agree to these terms.\n\nAccounts: you are responsible for your account security. Products are digital and delivered to your account. Prices are in PKR and may change without notice before purchase. Misuse, resale abuse or fraudulent payments may result in suspension.\n\nThe store owner should replace this default text with their own reviewed terms in Admin → Content.'],
  privacy: ['Privacy Policy', 'page_privacy', 'We collect the information you provide (name, email, phone) and order/payment records to operate the service. Passwords are hashed and never stored in plain text. We do not sell your data.\n\nThe store owner should replace this default text with their own reviewed policy in Admin → Content.'],
  refund: ['Refund Policy', 'page_refund', 'Digital products are non-returnable once delivered and working as described. If an order fails or the product does not work, contact support within the validity window and we will replace it or refund the amount to your Noorix wallet.\n\nThe store owner should replace this default text with their own reviewed policy in Admin → Content.'],
};
export function InfoPage({ kind }: { kind: keyof typeof POLICY }) {
  const [title, key, def] = POLICY[kind]; const r = useApi<{ pages: Record<string, string> }>('/pages'); useTitle(title);
  const text = r.data?.pages[key] || def;
  return <div className="mx-auto max-w-3xl px-4 py-10"><h1 className="text-3xl font-extrabold">{title}</h1><div className="card mt-5 space-y-4 p-6 text-slate-700">{r.loading ? <Spinner /> : text.split(/\n\s*\n/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div></div>;
}
export function Faq() {
  useTitle('FAQs'); const r = useApi<{ pages: Record<string, string> }>('/pages');
  let items = DEFAULT_FAQ; try { const j = JSON.parse(r.data?.pages.faq_json ?? ''); if (Array.isArray(j) && j.length) items = j.map((x: any) => [String(x.q), String(x.a)]); } catch { /* default */ }
  return <div className="mx-auto max-w-3xl px-4 py-10"><h1 className="mb-5 text-3xl font-extrabold">Frequently asked questions</h1><FaqList items={items} /></div>;
}
export function Contact() {
  useTitle('Contact us'); const toast = useToast(); const st = useApi<{ settings: Record<string, string> }>('/settings/public');
  const [f, setF] = useState({ name: '', email: '', message: '' }); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { await api('/contact', { body: f }); setDone(true); toast('ok', 'Message sent'); } catch (x) { toast('err', errMsg(x)); } setBusy(false); };
  const wa = st.data?.settings.whatsapp ?? '03154429417';
  return <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 md:grid-cols-2"><div><h1 className="text-3xl font-extrabold">Contact us</h1><p className="mt-2 text-slate-600">Need help with an order or deposit? Logged-in customers get the fastest help via a support ticket.</p><a className="btn-primary mt-5" href={`https://wa.me/${wa.replace(/^0/, '92')}`} target="_blank" rel="noopener noreferrer">Chat on WhatsApp {wa}</a><Link className="btn-ghost ml-2 mt-5" to="/dashboard/tickets">Open a ticket</Link></div>
    <form onSubmit={go} className="card space-y-4 p-6">{done ? <p className="py-8 text-center font-semibold text-emerald-600">Thanks! We will get back to you by email.</p> : <><Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Email"><input type="email" className="input" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field><Field label="Message"><textarea className="input min-h-[120px]" required minLength={5} value={f.message} onChange={e => setF({ ...f, message: e.target.value })} /></Field><button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button></>}</form></div>;
}
