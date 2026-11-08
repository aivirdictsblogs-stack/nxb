import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Logo, useAuth, useApi } from './lib';
import { Icon } from './icons';

export function SiteLayout() {
  const { user, logout } = useAuth(); const nav = useNavigate(); const loc = useLocation(); const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const settings = useApi<{ settings: Record<string, string> }>('/settings/public');
  const s = settings.data?.settings ?? {}; const wa = (s.whatsapp ?? '03154429417').replace(/^0/, '92');
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  const links = [['/products', 'All products'], ['/categories', 'Categories'], ['/deals', "Today's deals"], ['/trending', 'Trending'], ['/track-order', 'Track order'], ['/faq', 'Support']];
  const search = (e: React.FormEvent) => { e.preventDefault(); setOpen(false); nav(`/products?q=${encodeURIComponent(q)}`); };
  return <div className="flex min-h-screen flex-col">
    {s.announcement && <div className="bg-gradient-to-r from-electric-600 via-electric to-electric-600 px-4 py-2 text-center text-xs font-semibold text-white">{s.announcement}</div>}
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Logo light />
        <form className="mx-6 hidden max-w-lg flex-1 md:block" onSubmit={search} role="search"><div className="relative"><Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Search products" value={q} onChange={e => setQ(e.target.value)} placeholder="Search subscriptions, software, AI tools…" className="h-11 w-full rounded-xl border border-white/10 bg-white/10 pl-10 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-electric focus:outline-none" /></div></form>
        <div className="ml-auto flex items-center gap-2">
          {user ? <>{user.roles.length > 0 && <Link to="/admin" className="btn btn-sm hidden bg-white/10 text-white hover:bg-white/20 sm:inline-flex">Admin</Link>}<Link to="/dashboard" className="btn-primary btn-sm hidden sm:inline-flex">My account</Link><button className="hidden px-2 text-sm text-slate-300 hover:text-white lg:block" onClick={async () => { await logout(); nav('/'); }}>Sign out</button></>
            : <><Link to="/login" className="hidden px-3 text-sm font-semibold text-white sm:block">Login</Link><Link to="/register" className="btn-primary btn-sm">Register</Link></>}
          <button className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white md:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
        </div>
      </div>
      <nav className="hidden border-t border-white/10 md:block" aria-label="Main"><div className="mx-auto flex max-w-7xl gap-7 px-4">{links.map(([to, l]) => <NavLink key={to} to={to} className={({ isActive }) => `border-b-2 py-3 text-sm font-semibold transition ${isActive ? 'border-electric text-white' : 'border-transparent text-slate-300 hover:text-white'}`}>{l}</NavLink>)}</div></nav>
    </header>
    {open && <div className="fixed inset-0 z-50 md:hidden"><div className="absolute inset-0 bg-navy/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="absolute right-0 top-0 flex h-full w-[86%] max-w-sm flex-col overflow-y-auto bg-navy p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="mb-5 flex items-center justify-between"><Logo light /><button className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white" aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="close" /></button></div>
        <form onSubmit={search} role="search"><input aria-label="Search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search products…" className="h-12 w-full rounded-xl bg-white/10 px-4 text-white placeholder:text-slate-400" /></form>
        <nav className="mt-4 space-y-1">{links.map(([to, l]) => <Link key={to} to={to} className="flex min-h-[52px] items-center justify-between rounded-xl px-4 text-base font-semibold text-white active:bg-white/10">{l}<Icon name="arrow" className="h-4 w-4 text-slate-500" /></Link>)}</nav>
        <div className="mt-auto space-y-2 pt-6">{user ? <><Link to="/dashboard" className="btn-primary btn-lg w-full">My account</Link>{user.roles.length > 0 && <Link to="/admin" className="btn btn-lg w-full bg-white/10 text-white">Admin panel</Link>}<button className="btn btn-lg w-full bg-white/5 text-slate-300" onClick={async () => { await logout(); nav('/'); }}>Sign out</button></>
          : <><Link to="/login" className="btn-primary btn-lg w-full">Login</Link><Link to="/register" className="btn btn-lg w-full bg-white/10 text-white">Create account</Link></>}</div></div></div>}
    <main className="flex-1 pb-20 md:pb-0"><Outlet /></main>
    <footer className="bg-navy text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div><Logo light /><p className="mt-4 max-w-xs text-sm text-slate-400">{s.tagline || 'All-in-One Digital Solutions Under One Roof.'}</p>
          <a href={`https://wa.me/${wa}`} className="btn-primary mt-5" target="_blank" rel="noopener noreferrer"><Icon name="chat" className="h-4 w-4" />WhatsApp {s.whatsapp ?? '03154429417'}</a></div>
        <FootCol t="Shop" l={[['/products', 'All products'], ['/categories', 'Categories'], ['/deals', "Today's deals"], ['/trending', 'Trending']]} />
        <FootCol t="Support" l={[['/track-order', 'Track order'], ['/faq', 'FAQs'], ['/contact', 'Contact us'], ['/dashboard/tickets', 'My tickets']]} />
        <FootCol t="Company" l={[['/about', 'About us'], ['/terms', 'Terms & Conditions'], ['/privacy', 'Privacy Policy'], ['/refund-policy', 'Refund Policy']]} />
      </div>
      <div className="border-t border-white/10 px-4 py-6 pb-24 text-center text-xs text-slate-500 md:pb-6">© {new Date().getFullYear()} Noorix Digital Lab · All prices in PKR · Powered by Cloudflare</div>
    </footer>
    <MobileBar />
  </div>;
}
const FootCol = ({ t, l }: { t: string; l: string[][] }) => <div><h4 className="mb-4 text-sm font-bold text-white">{t}</h4><ul className="space-y-3 text-sm">{l.map(([to, n]) => <li key={to}><Link className="hover:text-white" to={to}>{n}</Link></li>)}</ul></div>;

function TabBar({ items }: { items: [string, string, string, boolean?][] }) {
  return <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden" aria-label="Quick navigation"><div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
    {items.map(([to, label, ic, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? 'text-electric' : 'text-slate-500'}`}><Icon name={ic} className="h-[22px] w-[22px]" />{label}</NavLink>)}</div></nav>;
}
function MobileBar() {
  const { user } = useAuth();
  return <TabBar items={[['/', 'Home', 'home', true], ['/products', 'Shop', 'shop'], ['/deals', 'Deals', 'tag'], ['/track-order', 'Track', 'orders'], [user ? '/dashboard' : '/login', user ? 'Account' : 'Login', 'user']]} />;
}

const DASH: [string, string, string][] = [['/dashboard', 'Overview', 'home'], ['/dashboard/wallet', 'Wallet', 'wallet'], ['/dashboard/orders', 'Orders', 'orders'], ['/dashboard/tickets', 'Tickets', 'chat'], ['/dashboard/notifications', 'Alerts', 'bell'], ['/dashboard/settings', 'Settings', 'gear']];
export function DashLayout() {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const notes = useApi<{ notifications: { read_at: number | null }[] }>('/me/notifications');
  const n = notes.data?.notifications.filter(x => !x.read_at).length ?? 0;
  return <div className="min-h-screen bg-mist pb-24 lg:pb-0">
    <header className="sticky top-0 z-30 bg-navy/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3"><Logo light /><div className="flex items-center gap-2"><Link to="/products" className="btn-primary btn-sm">Shop now</Link><button onClick={async () => { await logout(); nav('/'); }} className="hidden px-2 text-sm text-slate-300 hover:text-white sm:block">Sign out</button></div></div></header>
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 lg:grid-cols-[240px_1fr] lg:py-8">
      <nav className="card hidden p-2 lg:block lg:self-start" aria-label="Account">
        {DASH.map(([to, l, ic]) => <NavLink key={to} end={to === '/dashboard'} to={to} className={({ isActive }) => `flex min-h-[48px] items-center gap-3 rounded-xl px-3.5 text-sm font-semibold ${isActive ? 'bg-electric text-white shadow-glow' : 'text-slate-600 hover:bg-slate-50'}`}><Icon name={ic} className="h-[18px] w-[18px]" />{l === 'Alerts' ? 'Notifications' : l}{l === 'Alerts' && n > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] text-white">{n}</span>}</NavLink>)}
        <button onClick={async () => { await logout(); nav('/'); }} className="mt-1 flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">Sign out</button></nav>
      <div className="min-w-0"><p className="mb-4 hidden text-sm text-slate-500 sm:block">Signed in as <b>{user?.full_name}</b></p><Outlet /></div></div>
    <TabBar items={[['/dashboard', 'Home', 'home', true], ['/dashboard/wallet', 'Wallet', 'wallet'], ['/dashboard/orders', 'Orders', 'orders'], ['/dashboard/tickets', 'Help', 'chat'], ['/dashboard/settings', n ? `Me (${n})` : 'Me', 'user']]} />
  </div>;
}

export function AdminShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth(); const nav = useNavigate(); const [open, setOpen] = useState(false);
  const p = (x: string) => user?.perms.includes(x);
  const items: [string, string, boolean | undefined][] = [['/admin', 'Dashboard', true], ['/admin/orders', 'Orders', p('orders.manage')], ['/admin/deposits', 'Deposits', p('deposits.review')], ['/admin/customers', 'Customers & wallets', p('customers.manage') || p('wallets.adjust')],
    ['/admin/products', 'Products', p('products.manage')], ['/admin/categories', 'Categories', p('products.manage')], ['/admin/inventory', 'Inventory', p('inventory.manage')], ['/admin/suppliers', 'Suppliers / API', p('payments.manage')],
    ['/admin/payment-methods', 'Payment methods', p('payments.manage')], ['/admin/coupons', 'Coupons', p('coupons.manage')], ['/admin/tickets', 'Support tickets', p('tickets.manage')], ['/admin/content', 'Content & banners', p('content.manage')],
    ['/admin/reports', 'Reports', p('reports.view')], ['/admin/staff', 'Staff & roles', p('staff.manage')], ['/admin/audit', 'Audit logs', p('audit.view')], ['/admin/appearance', 'Appearance & themes', p('settings.manage')], ['/admin/settings', 'Settings & security', p('settings.manage')]];
  return <div className="min-h-screen bg-mist lg:grid lg:grid-cols-[250px_1fr]">
    <aside className={`${open ? 'block' : 'hidden'} fixed inset-0 z-40 overflow-y-auto bg-navy p-4 lg:static lg:block lg:min-h-screen`}>
      <div className="mb-6 flex items-center justify-between"><Logo light /><button className="text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">✕</button></div>
      <nav className="space-y-1" aria-label="Admin">{items.filter(i => i[2]).map(([to, l]) => <NavLink key={to} end={to === '/admin'} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `block rounded-xl px-3.5 py-2.5 text-sm font-semibold ${isActive ? 'bg-electric text-white shadow-glow' : 'text-slate-300 hover:bg-white/10'}`}>{l}</NavLink>)}</nav>
      <div className="mt-8 border-t border-white/10 pt-4 text-xs text-slate-400"><p className="font-semibold text-white">{user?.full_name}</p><p>{user?.roles.join(', ').replace(/_/g, ' ')}</p><Link className="mt-3 block hover:text-white" to="/">← View store</Link><button className="mt-2 hover:text-white" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button></div>
    </aside>
    <div className="min-w-0"><div className="sticky top-0 z-30 flex items-center justify-between bg-navy px-4 py-3 lg:hidden"><Logo light /><button className="text-white" onClick={() => setOpen(true)} aria-label="Open menu">☰</button></div>
      <div className="p-4 sm:p-6">{children ?? <Outlet />}</div></div></div>;
}
