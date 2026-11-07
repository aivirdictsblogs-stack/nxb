import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Field, Logo, Spinner, api, errMsg, useApi, useAuth, useTitle } from '../lib';

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <div className="grid min-h-screen lg:grid-cols-2"><div className="flex items-center justify-center bg-white p-6"><div className="w-full max-w-md"><div className="mb-8 lg:hidden"><Logo /></div><h1 className="text-3xl font-extrabold">{title}</h1>{sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}<div className="mt-6">{children}</div></div></div>
    <div className="hero-bg hidden flex-col justify-between p-12 text-white lg:flex"><Logo light /><div><h2 className="text-4xl font-black leading-tight">All-in-One Digital Solutions <span className="text-electric-400">Under One Roof.</span></h2><p className="mt-3 max-w-md text-slate-300">Wallet checkout, instant delivery and 24/7 support.</p></div><p className="text-xs text-slate-400">© Noorix Digital Lab</p></div></div>;
}
const Err = ({ m }: { m: string }) => m ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{m}</p> : null;

export function Login() {
  useTitle('Login'); const { refresh } = useAuth(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [f, setF] = useState({ email: '', password: '', remember: false }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const prov = useApi<{ google: boolean }>('/auth/providers');
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await api('/auth/login', { body: f }); await refresh(); const next = sp.get('next'); nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'); } catch (x) { setErr(errMsg(x)); } setBusy(false); };
  return <Shell title="Welcome back" sub="Sign in to your Noorix account"><form onSubmit={go} className="space-y-4">
    <Field label="Email"><input className="input" type="email" autoComplete="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
    <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
    <div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.remember} onChange={e => setF({ ...f, remember: e.target.checked })} /> Remember me</label><Link className="font-semibold text-electric" to="/forgot-password">Forgot password?</Link></div>
    <Err m={err} /><button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button></form>
    {prov.data?.google && <><div className="my-5 text-center text-xs text-slate-400">or continue with</div><a className="btn-ghost w-full" href="/api/auth/oauth/google/start">Sign in with Google</a></>}
    <p className="mt-6 text-center text-sm text-slate-500">Don't have an account? <Link className="font-semibold text-electric" to="/register">Register now</Link></p></Shell>;
}
export function Register() {
  useTitle('Create account'); const { refresh } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', confirm_password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setErr('');
    if (f.password.length < 8) return setErr('Password must be at least 8 characters'); if (f.password !== f.confirm_password) return setErr('Passwords do not match');
    setBusy(true); try { await api('/auth/register', { body: f }); await refresh(); nav('/dashboard'); } catch (x) { setErr(errMsg(x)); } setBusy(false); };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return <Shell title="Create your account" sub="Start buying digital products in minutes"><form onSubmit={go} className="space-y-4">
    <Field label="Full name"><input className="input" required minLength={2} autoComplete="name" value={f.full_name} onChange={set('full_name')} /></Field>
    <Field label="Email"><input className="input" type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></Field>
    <Field label="Phone / WhatsApp"><input className="input" type="tel" required minLength={7} autoComplete="tel" placeholder="03XXXXXXXXX" value={f.phone} onChange={set('phone')} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Password"><input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field><Field label="Confirm password"><input className="input" type="password" required autoComplete="new-password" value={f.confirm_password} onChange={set('confirm_password')} /></Field></div>
    <Err m={err} /><button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></form>
    <p className="mt-6 text-center text-sm text-slate-500">Already registered? <Link className="font-semibold text-electric" to="/login">Login</Link></p></Shell>;
}
export function Forgot() {
  useTitle('Forgot password'); const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { await api('/auth/forgot-password', { body: { email } }); setDone(true); } catch (x) { setErr(errMsg(x)); } setBusy(false); };
  return <Shell title="Forgot password" sub="We will email you a reset link">{done ? <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">If that email is registered, a reset link has been sent. The link expires in 1 hour.</p> : <form onSubmit={go} className="space-y-4"><Field label="Email"><input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field><Err m={err} /><button className="btn-primary w-full" disabled={busy}>Send reset link</button></form>}<p className="mt-6 text-center text-sm"><Link className="font-semibold text-electric" to="/login">← Back to login</Link></p></Shell>;
}
export function Reset() {
  useTitle('Reset password'); const [sp] = useSearchParams(); const nav = useNavigate(); const token = sp.get('token') ?? '';
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setErr(''); if (pw !== pw2) return setErr('Passwords do not match'); try { await api('/auth/reset-password', { body: { token, password: pw } }); setOk(true); setTimeout(() => nav('/login'), 1500); } catch (x) { setErr(errMsg(x)); } };
  return <Shell title="Set a new password">{!token ? <Err m="Missing reset token. Use the link from your email." /> : ok ? <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Password updated. Redirecting to login…</p> : <form onSubmit={go} className="space-y-4"><Field label="New password"><input className="input" type="password" minLength={8} required value={pw} onChange={e => setPw(e.target.value)} /></Field><Field label="Confirm password"><input className="input" type="password" required value={pw2} onChange={e => setPw2(e.target.value)} /></Field><Err m={err} /><button className="btn-primary w-full">Reset password</button></form>}</Shell>;
}
export function VerifyEmail() {
  useTitle('Verify email'); const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle'); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api('/auth/verify-email', { body: { token } }); setState('ok'); } catch { setState('err'); } setBusy(false); };
  return <Shell title="Verify your email">{busy ? <Spinner /> : state === 'ok' ? <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Email verified. <Link className="font-semibold underline" to="/dashboard">Go to dashboard</Link></p> : <><Err m={state === 'err' ? 'This link is invalid or expired.' : ''} /><button className="btn-primary w-full" onClick={go} disabled={!token}>Confirm email address</button></>}</Shell>;
}
