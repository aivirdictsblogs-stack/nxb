import app from '../src/worker/index';
import { makeD1 } from './d1shim';

export const KEY = Buffer.alloc(32, 7).toString('base64');
export function makeEnv() { return { DB: makeD1(), APP_URL: 'https://t.test', ENVIRONMENT: 'test', DELIVERY_KEY: KEY, SETUP_TOKEN: 'setup-secret-123' } as any; }
export class Client {
  cookie = ''; csrf = '';
  constructor(public env: any) {}
  async req(method: string, path: string, body?: any, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }, this.env);
    const sc = res.headers.get('set-cookie');
    if (sc) { const m = sc.match(/noorix_session=([^;]*)/); if (m) this.cookie = m[1] ? `noorix_session=${m[1]}` : ''; }
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch {}
    if (json?.csrf) this.csrf = json.csrf;
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: any, h?: Record<string, string>) => this.req('POST', p, b ?? {}, h);
}
let n = 0;
export async function register(env: any, name = 'Test User') {
  const c = new Client(env); n++;
  const email = `user${n}@example.com`;
  const r = await c.post('/api/auth/register', { full_name: name, email, phone: '03001234567', password: 'Passw0rd!x', confirm_password: 'Passw0rd!x' });
  if (r.status !== 201) throw new Error('register failed ' + r.text);
  return { c, email, id: r.json.user.id as string };
}
export async function makeStaff(env: any, role: string) {
  const sa = new Client(env);
  if (!env.__sa) {
    const r = await sa.post('/api/setup/super-admin', { email: 'root@noorix.test', full_name: 'Root', password: 'SuperSecret#12345' }, { 'x-setup-token': 'setup-secret-123' });
    if (r.status !== 201) throw new Error('setup failed ' + r.text);
    env.__sa = true;
  }
  await sa.post('/api/auth/login', { email: 'root@noorix.test', password: 'SuperSecret#12345' });
  if (role === 'super_admin') return sa;
  n++;
  const email = `staff${n}@noorix.test`;
  const r = await sa.post('/api/admin/staff', { email, full_name: 'Staff', password: 'StaffPass#12345', role_id: role });
  if (r.status !== 201) throw new Error('staff failed ' + r.text);
  const c = new Client(env);
  await c.post('/api/auth/login', { email, password: 'StaffPass#12345' });
  return c;
}
export async function fund(env: any, finance: Client, userId: string, amount: number) {
  const r = await finance.post(`/api/admin/customers/${userId}/wallet-adjust`, { direction: 'credit', amount_minor: amount, reason: 'test funding' });
  if (r.status !== 200) throw new Error('fund failed ' + r.text);
}
