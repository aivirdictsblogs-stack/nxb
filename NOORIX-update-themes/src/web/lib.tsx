import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { applyTheme } from './themes';

// ---------- API client (cookies + CSRF header; no token storage in JS-accessible storage) ----------
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };
export class ApiError extends Error { constructor(public status: number, message: string, public data: any) { super(message); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (!opts.form) headers['content-type'] = 'application/json';
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch('/api' + path, { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), credentials: 'same-origin', headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (data?.csrf) csrf = data.csrf;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

// ---------- money / dates ----------
export const fmt = (minor: number | null | undefined) => `PKR ${((minor ?? 0) / 100).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const parseMoney = (s: string): number | null => { const n = Number(s.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 && /^\d+(\.\d{1,2})?$/.test(s.replace(/,/g, '').trim()) ? Math.round(n * 100) : null; };
export const dt = (s: number | null | undefined) => s ? new Date(s * 1000).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const imgUrl = (k?: string | null) => (k ? `/api/media/${k}` : null);

// ---------- data hook ----------
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return; let live = true; setLoading(true); setError(null);
    api<T>(path).then(d => { if (live) { setData(d); setLoading(false); } }).catch(e => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [path, tick]);
  return { data, error, loading, reload: useCallback(() => setTick(t => t + 1), []) };
}

// ---------- toast ----------
type Toast = { id: number; kind: 'ok' | 'err'; msg: string };
const ToastCtx = createContext<(kind: 'ok' | 'err', msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]); const id = useRef(0);
  const push = useCallback((kind: 'ok' | 'err', msg: string) => { const i = ++id.current; setList(l => [...l, { id: i, kind, msg }]); setTimeout(() => setList(l => l.filter(t => t.id !== i)), 4500); }, []);
  return <ToastCtx.Provider value={push}>{children}
    <div className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
      {list.map(t => <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.kind === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}>{t.msg}</div>)}
    </div></ToastCtx.Provider>;
}

// ---------- auth ----------
export type User = { id: string; email: string; full_name: string; phone: string | null; roles: string[]; perms: string[] };
type AuthState = { user: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<AuthState>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { try { const r = await api<{ user: User | null }>('/auth/me'); setUser(r.user); } catch { setUser(null); } setLoading(false); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = useCallback(async () => { try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } setCsrf(''); setUser(null); }, []);
  return <AuthCtx.Provider value={{ user, loading, refresh, logout }}>{children}</AuthCtx.Provider>;
}
export function Protected({ children, staff, perm }: { children: ReactNode; staff?: boolean; perm?: string }) {
  const { user, loading } = useAuth(); const loc = useLocation();
  if (loading) return <Spinner full />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (staff && !user.roles.length) return <Navigate to="/dashboard" replace />;
  if (perm && !perm.split(',').some(x => user.perms.includes(x))) return <Forbidden />;
  return <>{children}</>;
}
export const Forbidden = () => <div className="card mx-auto mt-10 max-w-md p-8 text-center"><h2 className="text-lg font-bold">Access denied</h2><p className="mt-2 text-sm text-slate-500">Your role does not include this area. Permissions are enforced by the server.</p><Link className="btn-primary mt-5" to="/admin">Back to admin</Link></div>;

// ---------- UI primitives ----------
export const Spinner = ({ full }: { full?: boolean }) => <div className={`flex items-center justify-center ${full ? 'min-h-[50vh]' : 'py-10'}`} role="progressbar" aria-label="Loading"><div className="h-8 w-8 animate-spin rounded-full border-4 border-electric/20 border-t-electric" /></div>;
export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => <div className="card border-red-100 bg-red-50 p-5 text-sm text-red-700" role="alert">{msg}{retry && <button className="ml-3 font-semibold underline" onClick={retry}>Retry</button>}</div>;
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => <div className="card flex flex-col items-center p-10 text-center"><div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-electric-100 text-electric">✦</div><p className="font-semibold">{title}</p>{hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}{action && <div className="mt-4">{action}</div>}</div>;
export function Async<T>({ r, children, empty }: { r: ReturnType<typeof useApi<T>>; children: (d: T) => ReactNode; empty?: (d: T) => boolean | undefined }) {
  if (r.loading) return <Spinner />; if (r.error) return <ErrorBox msg={r.error} retry={r.reload} />; if (!r.data) return null; return <>{children(r.data)}</>;
}
const STATUS: Record<string, string> = { completed: 'bg-emerald-100 text-emerald-700', approved: 'bg-emerald-100 text-emerald-700', active: 'bg-emerald-100 text-emerald-700', resolved: 'bg-emerald-100 text-emerald-700', paid: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-electric-100 text-electric-600', in_progress: 'bg-electric-100 text-electric-600', open: 'bg-blue-100 text-blue-700', pending: 'bg-amber-100 text-amber-700', waiting_customer: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-slate-200 text-slate-600', closed: 'bg-slate-200 text-slate-600', disabled: 'bg-slate-200 text-slate-600', archived: 'bg-slate-200 text-slate-600', refunded: 'bg-purple-100 text-purple-700', failed: 'bg-red-100 text-red-700', rejected: 'bg-red-100 text-red-700', suspended: 'bg-red-100 text-red-700' };
export const Badge = ({ s }: { s: string }) => <span className={`badge ${STATUS[s] ?? 'bg-slate-100 text-slate-600'}`}>{s.replace(/_/g, ' ')}</span>;
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) { return <div><label className="block"><span className="label">{label}</span>{children}</label>{error && <p className="mt-1 text-xs text-red-600">{error}</p>}</div>; }
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" aria-label={title} className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl sm:p-6 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
      <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">{title}</h3><button aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}>✕</button></div>{children}</div></div>;
}
export const Table = ({ heads, children }: { heads: string[]; children: ReactNode }) => <div className="card overflow-x-auto"><table className="min-w-full divide-y divide-slate-100"><thead className="bg-slate-50/70"><tr>{heads.map(h => <th key={h} className="th">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table></div>;
export const PageHead = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) => <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-extrabold">{title}</h1>{sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}</div><div className="flex flex-wrap gap-2">{actions}</div></div>;
// ---------- site settings (theme, logo, favicon, brand text) — loaded from the backend before first paint ----------
type Site = { settings: Record<string, string>; ready: boolean; refresh: () => void };
const SiteCtx = createContext<Site>({ settings: {}, ready: true, refresh: () => {} });
export const useSite = () => useContext(SiteCtx);
export function applyFavicon(key?: string) {
  const link = (document.querySelector('link[rel="icon"]') as HTMLLinkElement | null) ?? Object.assign(document.head.appendChild(document.createElement('link')), { rel: 'icon' });
  if (key) { link.removeAttribute('type'); link.href = `/api/media/${key}`; } else { link.type = 'image/svg+xml'; link.href = '/favicon.svg'; }
}
export function SiteProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({}); const [ready, setReady] = useState(false); const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; api<{ settings: Record<string, string> }>('/settings/public').then(r => { if (live) setSettings(r.settings); }).catch(() => {}).finally(() => { if (live) setReady(true); }); return () => { live = false; }; }, [tick]);
  useEffect(() => { applyTheme(settings.theme_id, settings.heading_font); applyFavicon(settings.favicon_key); }, [settings]);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  return <SiteCtx.Provider value={{ settings, ready, refresh }}>{ready ? children : <Spinner full />}</SiteCtx.Provider>;
}
export const Logo = ({ light }: { light?: boolean }) => {
  const { settings: s } = useSite(); const img = imgUrl(s.logo_key); const p = (s.brand_primary || 'NOORIX').trim(); const sec = (s.brand_secondary ?? 'DIGITAL LAB').trim();
  return <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label={`${s.site_name || 'Noorix Digital Lab'} home`}>
    {img ? <img src={img} alt={s.site_name || 'Noorix Digital Lab'} className="h-10 w-auto max-w-[190px] object-contain sm:h-11" />
      : <><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-electric-400 to-electric-600 text-lg font-black text-white shadow-glow">{p.slice(0, 1)}</span>
        <span className={`font-heading leading-none ${light ? 'text-white' : 'text-navy'}`}><span className="block text-lg font-extrabold tracking-wide">{p}</span>{sec && <span className="block text-[10px] font-semibold tracking-[.3em] text-electric-400">{sec}</span>}</span></>}
  </Link>;
};
export function useTitle(t: string, desc?: string) {
  useEffect(() => {
    document.title = `${t} | Noorix Digital Lab`;
    const set = (sel: string, attr: string, v: string, create?: () => HTMLElement) => { let el = document.head.querySelector(sel) as HTMLElement | null; if (!el && create) { el = create(); document.head.appendChild(el); } el?.setAttribute(attr, v); };
    if (desc) set('meta[name="description"]', 'content', desc, () => Object.assign(document.createElement('meta'), { name: 'description' }));
    set('link[rel="canonical"]', 'href', `https://noorixdigitallab.online${location.pathname}`, () => Object.assign(document.createElement('link'), { rel: 'canonical' }));
    set('meta[property="og:title"]', 'content', t, () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:title'); return m; });
  }, [t, desc]);
}
export function Pager({ page, setPage, hasMore }: { page: number; setPage: (n: number) => void; hasMore: boolean }) {
  return <div className="mt-6 flex items-center justify-center gap-3"><button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span className="text-sm text-slate-500">Page {page}</span><button className="btn-ghost btn-sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>Next →</button></div>;
}
export function errMsg(e: unknown) { return e instanceof ApiError ? (e.data?.issues ? Object.values(e.data.issues as Record<string, string[]>).flat().join(' ') || e.message : e.message) : 'Something went wrong'; }
