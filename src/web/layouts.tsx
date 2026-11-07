import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Logo, useAuth, useApi } from './lib';

export function SiteLayout() {
  const { user, logout } = useAuth(); const nav = useNavigate(); const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const settings = useApi<{ settings: Record<string, string> }>('/settings/public');
  const wa = (settings.data?.settings.whatsapp ?? '03154429417').replace(/^0/, '92');
  const links = [['/products', 'All products'], ['/categories', 'Categories'], ['/deals', "Today's deals"], ['/trending', 'Trending'], ['/track-order', 'Track order'], ['/faq', 'Support']];
  return <div className="flex min-h-screen flex-col">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Logo light />
        <form className="mx-auto hidden max-w-md flex-1 md:block" onSubmit={e => { e.preventDefault(); nav(`/products?q=${encodeURIComponent(q)}`); }} role="search">
          <input aria-label="Search products" value={q} onChange={e => setQ(e.target.value)} placeholder="Search subscriptions, software, AI tools…" className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-slate-400 focus:border-electric focus:outline-none" />
        </form>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {user ? <>
            {user.roles.length > 0 && <Link to="/admin" className="btn-sm btn bg-white/10 text-white hover:bg-white/20">Admin</Link>}
            <Link to="/dashboard" className="btn-primary btn-sm">My account</Link>
            <button className="hidden text-sm text-slate-300 hover:text-white sm:block" onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
          </> : <><Link to="/login" className="hidden text-sm font-semibold text-white sm:block">Login</Link><Link to="/register" className="btn-primary btn-sm">Register</Link></>}
          <button className="rounded-lg p-2 text-white md:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>☰</button>
        </div>
      </div>
      <nav className={`${open ? 'block' : 'hidden'} border-t border-white/10 md:block`}>
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-2 md:flex-row md:gap-6">
          {links.map(([to, l]) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `py-1.5 text-sm font-medium ${isActive ? 'text-electric-400' : 'text-slate-300 hover:text-white'}`}>{l}</NavLink>)}
          <form className="py-2 md:hidden" onSubmit={e => { e.preventDefault(); setOpen(false); nav(`/products?q=${encodeURIComponent(q)}`); }}><input aria-label="Search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400" /></form>
        </div>
      </nav>
    </header>
    <main className="flex-1"><Outlet /></main>
    <footer className="mt-16 bg-navy text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div><Logo light /><p className="mt-4 text-sm text-slate-400">All-in-One Digital Solutions Under One Roof.</p>
          <a href={`https://wa.me/${wa}`} className="btn-primary mt-4" target="_blank" rel="noopener noreferrer">WhatsApp {settings.data?.settings.whatsapp ?? '03154429417'}</a></div>
        <FootCol t="Shop" l={[['/products', 'All products'], ['/categories', 'Categories'], ['/deals', "Today's deals"], ['/trending', 'Trending']]} />
        <FootCol t="Support" l={[['/track-order', 'Track order'], ['/faq', 'FAQs'], ['/contact', 'Contact us'], ['/dashboard/tickets', 'My tickets']]} />
        <FootCol t="Company" l={[['/about', 'About us'], ['/terms', 'Terms & Conditions'], ['/privacy', 'Privacy Policy'], ['/refund-policy', 'Refund Policy']]} />
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-slate-500">© {new Date().getFullYear()} Noorix Digital Lab. All prices in PKR.</div>
    </footer>
  </div>;
}
const FootCol = ({ t, l }: { t: string; l: string[][] }) => <div><h4 className="mb-3 text-sm font-bold text-white">{t}</h4><ul className="space-y-2 text-sm">{l.map(([to, n]) => <li key={to}><Link className="hover:text-white" to={to}>{n}</Link></li>)}</ul></div>;

const DASH = [['/dashboard', 'Overview', '◧'], ['/dashboard/wallet', 'Wallet', '◍'], ['/dashboard/orders', 'Orders', '▤'], ['/dashboard/tickets', 'Tickets', '✉'], ['/dashboard/notifications', 'Notifications', '◔'], ['/dashboard/settings', 'Settings', '⚙']];
export function DashLayout() {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const unread = useApi<{ notifications: { read_at: number | null }[] }>('/me/notifications');
  const n = unread.data?.notifications.filter(x => !x.read_at).length ?? 0;
  return <div className="min-h-screen bg-mist">
    <header className="bg-navy"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3"><Logo light /><div className="flex items-center gap-3 text-sm text-slate-300"><Link to="/products" className="btn-primary btn-sm">Shop now</Link><button onClick={async () => { await logout(); nav('/'); }} className="hover:text-white">Sign out</button></div></div></header>
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
      <nav className="card flex gap-1 overflow-x-auto p-2 lg:flex-col lg:self-start" aria-label="Account">
        {DASH.map(([to, l, ic]) => <NavLink key={to} end={to === '/dashboard'} to={to} className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold ${isActive ? 'bg-electric text-white' : 'text-slate-600 hover:bg-slate-50'}`}><span aria-hidden>{ic}</span>{l}{l === 'Notifications' && n > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] text-white">{n}</span>}</NavLink>)}
      </nav>
      <div className="min-w-0"><p className="mb-4 text-sm text-slate-500">Signed in as <b>{user?.full_name}</b></p><Outlet /></div>
    </div></div>;
}

export function AdminShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth(); const nav = useNavigate(); const [open, setOpen] = useState(false);
  const p = (x: string) => user?.perms.includes(x);
  const items: [string, string, boolean | undefined][] = [['/admin', 'Dashboard', true], ['/admin/orders', 'Orders', p('orders.manage')], ['/admin/deposits', 'Deposits', p('deposits.review')], ['/admin/customers', 'Customers & wallets', p('customers.manage') || p('wallets.adjust')],
    ['/admin/products', 'Products', p('products.manage')], ['/admin/categories', 'Categories', p('products.manage')], ['/admin/inventory', 'Inventory', p('inventory.manage')], ['/admin/suppliers', 'Suppliers / API', p('payments.manage')],
    ['/admin/payment-methods', 'Payment methods', p('payments.manage')], ['/admin/coupons', 'Coupons', p('coupons.manage')], ['/admin/tickets', 'Support tickets', p('tickets.manage')], ['/admin/content', 'Content & banners', p('content.manage')],
    ['/admin/reports', 'Reports', p('reports.view')], ['/admin/staff', 'Staff & roles', p('staff.manage')], ['/admin/audit', 'Audit logs', p('audit.view')], ['/admin/settings', 'Settings & security', p('settings.manage')]];
  return <div className="min-h-screen bg-mist lg:grid lg:grid-cols-[250px_1fr]">
    <aside className={`${open ? 'block' : 'hidden'} fixed inset-0 z-40 overflow-y-auto bg-navy p-4 lg:static lg:block lg:min-h-screen`}>
      <div className="mb-6 flex items-center justify-between"><Logo light /><button className="text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">✕</button></div>
      <nav className="space-y-1" aria-label="Admin">{items.filter(i => i[2]).map(([to, l]) => <NavLink key={to} end={to === '/admin'} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `block rounded-xl px-3.5 py-2.5 text-sm font-semibold ${isActive ? 'bg-electric text-white shadow-glow' : 'text-slate-300 hover:bg-white/10'}`}>{l}</NavLink>)}</nav>
      <div className="mt-8 border-t border-white/10 pt-4 text-xs text-slate-400"><p className="font-semibold text-white">{user?.full_name}</p><p>{user?.roles.join(', ').replace(/_/g, ' ')}</p><Link className="mt-3 block hover:text-white" to="/">← View store</Link><button className="mt-2 hover:text-white" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button></div>
    </aside>
    <div className="min-w-0"><div className="sticky top-0 z-30 flex items-center justify-between bg-navy px-4 py-3 lg:hidden"><Logo light /><button className="text-white" onClick={() => setOpen(true)} aria-label="Open menu">☰</button></div>
      <div className="p-4 sm:p-6">{children ?? <Outlet />}</div></div></div>;
}
