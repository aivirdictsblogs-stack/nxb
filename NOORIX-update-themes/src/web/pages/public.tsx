import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, catIcon } from '../icons';
import { Async, Badge, Empty, Field, Pager, Spinner, api, errMsg, fmt, imgUrl, useApi, useAuth, useTitle, useToast, ErrorBox } from '../lib';

export type Product = { id: string; name: string; slug: string; image_key: string | null; short_description: string; is_featured: number; is_trending: number; is_deal: number; category_name: string; category_slug: string; price_from_minor: number | null; compare_at_minor: number | null; delivery_type: string };
const HUES = ['from-blue-600 to-indigo-700', 'from-sky-500 to-blue-700', 'from-violet-600 to-indigo-700', 'from-cyan-500 to-blue-600', 'from-blue-700 to-slate-900'];
const hue = (n: string) => HUES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
/** Logo tile: object-contain so every logo is shown completely on mobile and desktop (never cropped). */
const Tile = ({ p, big }: { p: { name: string; image_key: string | null }; big?: boolean }) => {
  const src = imgUrl(p.image_key);
  return <div className={`relative flex w-full items-center justify-center overflow-hidden bg-gradient-to-br from-white to-slate-100 ${big ? 'aspect-square' : 'aspect-[4/3]'}`}>
    {src ? <img src={src} alt={p.name} loading="lazy" decoding="async" className={`h-full w-full object-contain transition duration-300 group-hover:scale-105 ${big ? 'p-8' : 'p-4 sm:p-5'}`} />
      : <div className={`grid ${big ? 'h-40 w-40 text-7xl' : 'h-16 w-16 text-3xl sm:h-20 sm:w-20 sm:text-4xl'} place-items-center rounded-3xl bg-gradient-to-br ${hue(p.name)} font-black text-white shadow-lg`}>{p.name.slice(0, 1)}</div>}
  </div>;
};

export function ProductCard({ p }: { p: Product }) {
  const off = p.compare_at_minor && p.price_from_minor && p.compare_at_minor > p.price_from_minor ? Math.round((1 - p.price_from_minor / p.compare_at_minor) * 100) : 0;
  return <Link to={`/products/${p.slug}`} className="card group relative flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-glow">
    <div className="relative border-b border-slate-100"><Tile p={p} />
      {off > 0 && <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white shadow">{off}% OFF</span>}
      {p.is_trending ? <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-navy/90 px-2.5 py-1 text-[11px] font-bold text-white"><Icon name="flame" className="h-3 w-3 text-electric-400" />Hot</span> : null}</div>
    <div className="flex flex-1 flex-col p-3.5 sm:p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-electric sm:text-[11px]">{p.category_name}</p>
      <h3 className="mt-1 text-[15px] font-bold leading-snug sm:text-base">{p.name}</h3>
      <p className="mt-1 line-clamp-2 hidden text-xs text-slate-500 sm:block">{p.short_description}</p>
      <div className="mt-auto pt-3"><div className="flex items-baseline gap-2">{p.price_from_minor === null ? <span className="text-sm text-slate-400">Unavailable</span> : <><span className="text-[11px] text-slate-400">From</span><span className="text-lg font-extrabold sm:text-xl">{fmt(p.price_from_minor)}</span></>}{off > 0 && <span className="text-xs text-slate-400 line-through">{fmt(p.compare_at_minor)}</span>}</div>
        <span className="btn-primary btn-sm mt-3 w-full">View plans<Icon name="arrow" className="h-4 w-4" /></span></div></div></Link>;
}
const Grid = ({ items }: { items: Product[] }) => <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{items.map(p => <ProductCard key={p.id} p={p} />)}</div>;
function Section({ title, to, eyebrow, children }: { title: string; to?: string; eyebrow?: string; children: React.ReactNode }) { return <section className="mx-auto max-w-7xl px-4 pt-14 sm:pt-16"><div className="mb-6 flex items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[.18em] text-electric">{eyebrow}</p>}<h2 className="text-2xl font-extrabold sm:text-3xl">{title}</h2></div>{to && <Link to={to} className="btn-ghost btn-sm shrink-0">View all<Icon name="arrow" className="h-4 w-4" /></Link>}</div>{children}</section>; }
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
  const cats = useApi<{ categories: { id: string; name: string; slug: string; image_key: string | null; description: string | null }[] }>('/categories');
  const banners = useApi<{ banners: { id: string; title: string; subtitle: string; link_url: string; image_key: string }[] }>('/banners');
  const feat = useApi<{ products: Product[] }>('/products?featured=1&size=4');
  const st = useApi<{ settings: Record<string, string> }>('/settings/public'); const s = st.data?.settings ?? {};
  const wa = (s.whatsapp ?? '03154429417').replace(/^0/, '92');
  const trust: [string, string, string][] = [['bolt', 'Fast delivery', 'Straight to your account'], ['lock', 'Secure wallet', 'Every rupee tracked'], ['headset', 'Real support', 'Tickets + WhatsApp'], ['tag', 'Best prices', 'Honest PKR pricing']];
  return <>
    <section className="hero-bg relative overflow-hidden text-white"><div className="grid-bg absolute inset-0" aria-hidden />
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-12 sm:pb-24 sm:pt-16 lg:grid-cols-[1.15fr_1fr]">
        <div className="animate-fadeup"><span className="inline-flex items-center gap-2 rounded-full border border-electric/30 bg-electric/10 px-3.5 py-1.5 text-xs font-semibold text-electric-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-electric-400" />Premium digital marketplace · Pakistan</span>
          <h1 className="mt-5 text-[2.5rem] font-black leading-[1.05] sm:text-6xl">{s.hero_title || <>All-in-One Digital Solutions <span className="text-grad">Under One Roof.</span></>}</h1>
          <p className="mt-5 max-w-xl text-base text-slate-300 sm:text-lg">{s.hero_subtitle || 'Netflix, ChatGPT, Canva, Spotify and more — pay from your Noorix wallet in PKR and get delivery in your account.'}</p>
          <form className="mt-7 flex max-w-xl flex-col gap-2 sm:flex-row" role="search" onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/products?q=${encodeURIComponent(q)}`); }}>
            <div className="relative flex-1"><Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input aria-label="Search products" className="h-[54px] w-full rounded-2xl border-0 bg-white pl-12 pr-4 text-base text-navy placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-electric/40" placeholder="Search Netflix, ChatGPT, Canva…" value={q} onChange={e => setQ(e.target.value)} /></div>
            <button className="btn-primary btn-lg sm:w-auto">Search</button></form>
          <div className="mt-4 flex flex-wrap gap-2 text-sm"><span className="py-1.5 text-slate-400">Popular:</span>{['Netflix', 'ChatGPT', 'Canva', 'Spotify', 'YouTube'].map(t => <Link key={t} to={`/products?q=${t}`} className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 font-medium text-slate-200 transition hover:border-electric hover:bg-electric/20">{t}</Link>)}</div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link to="/products" className="btn-primary btn-lg">Browse all products<Icon name="arrow" className="h-5 w-5" /></Link><Link to="/register" className="btn btn-lg border border-white/20 bg-white/5 text-white hover:bg-white/10">Create free account</Link></div></div>
        <div className="relative hidden lg:block" aria-hidden={!feat.data?.products.length}><div className="absolute -inset-10 rounded-full bg-electric/25 blur-3xl" />
          <div className="relative grid animate-floaty grid-cols-2 gap-4">{(feat.data?.products.length ? feat.data.products : []).slice(0, 4).map((p, i) => <Link key={p.id} to={`/products/${p.slug}`} className={`glass group rounded-3xl p-3 transition hover:border-electric ${i % 2 ? 'translate-y-6' : ''}`}><div className="overflow-hidden rounded-2xl"><Tile p={p} /></div><div className="px-1 pb-1 pt-3"><p className="truncate text-sm font-bold">{p.name}</p><p className="text-xs text-electric-400">From {fmt(p.price_from_minor)}</p></div></Link>)}</div></div>
      </div></section>
    <section className="relative z-10 mx-auto -mt-8 max-w-7xl px-4"><div className="card grid grid-cols-2 gap-px overflow-hidden bg-slate-100 lg:grid-cols-4">{trust.map(([ic, t, d]) => <div key={t} className="flex items-center gap-3 bg-white p-4 sm:p-5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-electric-100 text-electric"><Icon name={ic} className="h-5 w-5" /></span><div><p className="text-sm font-bold">{t}</p><p className="text-xs text-slate-500">{d}</p></div></div>)}</div></section>
    {banners.data?.banners.length ? <section className="mx-auto max-w-7xl px-4 pt-10"><div className="grid gap-4 md:grid-cols-2">{banners.data.banners.map(b => <Link key={b.id} to={b.link_url || '/products'} className="hero-bg group relative flex min-h-[150px] items-end overflow-hidden rounded-3xl p-6 text-white shadow-card">{imgUrl(b.image_key) && <img src={imgUrl(b.image_key)!} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50 transition duration-500 group-hover:scale-105" loading="lazy" />}<div className="relative"><h3 className="text-xl font-extrabold sm:text-2xl">{b.title}</h3><p className="mt-1 text-sm text-slate-200">{b.subtitle}</p></div></Link>)}</div></section> : null}
    <Section eyebrow="Browse" title="Popular categories" to="/categories"><Async r={cats}>{d => <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">{d.categories.map(c => <Link key={c.id} to={`/categories/${c.slug}`} className="card group flex w-[150px] shrink-0 snap-start flex-col items-center gap-3 p-5 text-center transition hover:-translate-y-1 hover:shadow-glow sm:w-auto sm:flex-row sm:text-left"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-navy to-electric-600 text-white shadow-md transition group-hover:scale-105"><Icon name={catIcon(c.slug)} className="h-6 w-6" /></span><span className="text-sm font-bold leading-tight">{c.name}</span></Link>)}</div>}</Async></Section>
    <Row title="Featured products" query="featured=1&size=8" to="/products" />
    <Row title="Trending now" query="trending=1&size=8" to="/trending" />
    <Row title="Special offers & deals" query="deals=1&size=8" to="/deals" />
    <Row title="Streaming subscriptions" query="category=streaming&size=4" to="/categories/streaming" />
    <Row title="AI tools" query="category=ai-tools&size=4" to="/categories/ai-tools" />
    <Row title="Recently added" query="size=8" to="/products" />
    <Section eyebrow="Simple" title="How it works"><ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Create your account', 'Register free in under a minute.', 'accounts'], ['Add funds', 'Deposit by bank, Easypaisa or JazzCash.', 'wallet'], ['Pick a plan', 'Choose your product and plan.', 'shop'], ['Get delivery', 'Details appear in your account.', 'bolt']].map(([t, d, ic], i) => <li key={t} className="card relative p-6"><span className="absolute right-5 top-4 text-5xl font-black text-slate-100">{i + 1}</span><span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-electric text-white shadow-glow"><Icon name={ic} /></span><p className="relative mt-4 font-bold">{t}</p><p className="relative mt-1 text-sm text-slate-500">{d}</p></li>)}</ol></Section>
    <section className="mx-auto max-w-7xl px-4 pt-16"><div className="hero-bg relative overflow-hidden rounded-3xl p-8 text-center text-white sm:p-14"><div className="grid-bg absolute inset-0" aria-hidden /><div className="relative"><h2 className="text-2xl font-black sm:text-4xl">Ready to upgrade your digital life?</h2><p className="mx-auto mt-3 max-w-xl text-slate-300">Join Noorix today — secure wallet, fast delivery and real human support.</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><Link to="/register" className="btn-primary btn-lg">Get started free</Link><a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="btn btn-lg border border-white/20 bg-white/5 text-white hover:bg-white/10"><Icon name="chat" className="h-5 w-5" />WhatsApp us</a></div></div></div></section>
    <Section eyebrow="Help" title="Frequently asked questions" to="/faq"><FaqList items={DEFAULT_FAQ.slice(0, 3)} /></Section>
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
  return <div className="mx-auto max-w-7xl px-4 py-10"><p className="text-xs font-bold uppercase tracking-[.18em] text-electric">Browse</p><h1 className="mb-6 text-3xl font-extrabold">Product categories</h1><Async r={r}>{d => <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.categories.map(c => <Link key={c.id} to={`/categories/${c.slug}`} className="card group flex items-center gap-4 p-5 transition hover:-translate-y-1 hover:shadow-glow"><span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-navy to-electric-600 text-white shadow-md"><Icon name={catIcon(c.slug)} className="h-7 w-7" /></span><div className="min-w-0 flex-1"><h3 className="font-bold">{c.name}</h3><p className="text-sm text-slate-500">{c.description ?? 'Browse products'}</p></div><Icon name="arrow" className="h-5 w-5 text-slate-300 transition group-hover:text-electric" /></Link>)}</div>}</Async></div>;
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
  return <div className="mx-auto max-w-6xl px-4 py-6 pb-28 md:py-8 md:pb-8">
    <nav className="mb-4 text-sm text-slate-500"><Link to="/products">Products</Link> / <Link to={`/categories/${p.category_slug}`}>{p.category_name}</Link> / {p.name}</nav>
    <div className="grid gap-6 md:grid-cols-[360px_1fr] md:gap-10">
      <div className="card overflow-hidden md:sticky md:top-24 md:self-start"><Tile p={p} big /></div>
      <div><span className="badge bg-electric-100 text-electric-600">{p.category_name}</span><h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{p.name}</h1><p className="mt-2 text-slate-600">{p.short_description}</p>
        {plan && <div className="mt-5 flex items-end gap-3"><span className="text-3xl font-black text-electric">{fmt(plan.price_minor)}</span>{plan.compare_at_minor && plan.compare_at_minor > plan.price_minor && <><span className="text-slate-400 line-through">{fmt(plan.compare_at_minor)}</span><span className="badge bg-emerald-100 text-emerald-700">{Math.round((1 - plan.price_minor / plan.compare_at_minor) * 100)}% off</span></>}</div>}
        <h2 className="mb-2 mt-6 text-sm font-bold">Choose a plan</h2>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Plans">{p.plans.map(pl => <button key={pl.id} role="radio" aria-checked={plan?.id === pl.id} disabled={!pl.in_stock} onClick={() => setSel(pl.id)} className={`min-h-[64px] rounded-2xl border-2 p-4 text-left transition ${plan?.id === pl.id ? 'border-electric bg-electric-100/50' : 'border-slate-200 bg-white'} ${!pl.in_stock ? 'opacity-50' : 'hover:border-electric/60'}`}>
          <div className="flex justify-between"><b>{pl.name}</b><span className="font-bold">{fmt(pl.price_minor)}</span></div><div className="mt-1 flex justify-between text-xs text-slate-500"><span>{pl.duration}</span><span className={pl.in_stock ? 'text-emerald-600' : 'text-red-600'}>{pl.in_stock ? 'In stock' : 'Out of stock'}</span></div></button>)}</div>
        <div className="mt-6 hidden flex-wrap gap-3 md:flex"><button className="btn-primary btn-lg px-10" disabled={!plan?.in_stock} onClick={() => nav(`/checkout?plan=${plan!.id}&product=${p.slug}`)}>{user ? 'Buy now' : 'Login to buy'}</button><a className="btn-ghost btn-lg" href="/contact">Ask a question</a></div>
        <ul className="mt-6 grid gap-2.5 text-sm text-slate-700 sm:grid-cols-2">{p.features.slice(0, 6).map(f => <li key={f} className="flex items-start gap-2"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600"><Icon name="check" className="h-3 w-3" /></span>{f}</li>)}</ul>
      </div></div>
    {plan && <div className="pb-safe fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom,0px))] z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:hidden"><div className="mx-auto flex max-w-lg items-center gap-3"><div className="min-w-0"><p className="truncate text-[11px] text-slate-500">{plan.name}</p><p className="text-lg font-black text-electric">{fmt(plan.price_minor)}</p></div><button className="btn-primary btn-lg ml-auto flex-1" disabled={!plan.in_stock} onClick={() => nav(`/checkout?plan=${plan.id}&product=${p.slug}`)}>{!plan.in_stock ? 'Out of stock' : user ? 'Buy now' : 'Login to buy'}</button></div></div>}
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
