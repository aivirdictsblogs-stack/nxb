// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ToastProvider, Protected, fmt, parseMoney } from '../../src/web/lib';
import { Login } from '../../src/web/pages/auth';
import { Checkout, OrderDetail } from '../../src/web/pages/account';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
let calls: { url: string; init?: RequestInit }[] = [];
function mockApi(h: Handler) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init }); const r = h(url, init) ?? { status: 404, body: { error: 'nf' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }));
}
const wrap = (path: string, el: React.ReactNode, route = '*') => render(<MemoryRouter initialEntries={[path]}><ToastProvider><AuthProvider><Routes><Route path={route} element={el} /><Route path="/login" element={<div>LOGIN PAGE</div>} /></Routes></AuthProvider></ToastProvider></MemoryRouter>);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn() } }); });

describe('money helpers', () => {
  it('formats minor units and parses PKR input strictly', () => {
    expect(fmt(29900)).toBe('PKR 299'); expect(fmt(150050)).toBe('PKR 1,500.5');
    expect(parseMoney('1,000')).toBe(100000); expect(parseMoney('12.34')).toBe(1234);
    expect(parseMoney('12.345')).toBeNull(); expect(parseMoney('-5')).toBeNull(); expect(parseMoney('abc')).toBeNull(); expect(parseMoney('0')).toBeNull();
  });
});
describe('route protection', () => {
  it('redirects anonymous users to login', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: { user: null } } : undefined);
    wrap('/dashboard', <Protected><div>SECRET</div></Protected>);
    await waitFor(() => expect(screen.getByText('LOGIN PAGE')).toBeTruthy()); expect(screen.queryByText('SECRET')).toBeNull();
  });
  it('blocks non-staff from admin-only content', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: { user: { id: '1', email: 'a@b.c', full_name: 'A', phone: null, roles: [], perms: [] }, csrf: 'x' } } : undefined);
    wrap('/admin', <Protected staff><div>ADMIN AREA</div></Protected>, '/admin');
    await waitFor(() => expect(screen.queryByText('ADMIN AREA')).toBeNull());
  });
  it('shows a forbidden message when the role lacks the permission', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: { user: { id: '1', email: 'a@b.c', full_name: 'A', phone: null, roles: ['support_agent'], perms: ['tickets.manage'] }, csrf: 'x' } } : undefined);
    wrap('/admin/deposits', <Protected staff perm="deposits.review"><div>DEPOSITS</div></Protected>, '/admin/deposits');
    await waitFor(() => expect(screen.getByText('Access denied')).toBeTruthy()); expect(screen.queryByText('DEPOSITS')).toBeNull();
  });
});
describe('login', () => {
  it('shows the server error and does not navigate on bad credentials', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: { user: null } } : u.endsWith('/auth/providers') ? { body: { google: false } } : u.endsWith('/auth/login') ? { status: 401, body: { error: 'Invalid email or password' } } : undefined);
    wrap('/login', <Login />, '/login-form');
    // Login route is the fallback "*"; render it directly
    cleanup(); render(<MemoryRouter><ToastProvider><AuthProvider><Login /></AuthProvider></ToastProvider></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com'); await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass'); await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid email or password'));
  });
  it('does not render a Google button unless the backend reports it configured', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: { user: null } } : u.endsWith('/auth/providers') ? { body: { google: false } } : undefined);
    render(<MemoryRouter><ToastProvider><AuthProvider><Login /></AuthProvider></ToastProvider></MemoryRouter>);
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/auth/providers'))).toBe(true)); expect(screen.queryByText(/Google/)).toBeNull();
  });
  it('shows the Google button when the backend says it is configured', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: { user: null } } : u.endsWith('/auth/providers') ? { body: { google: true } } : undefined);
    render(<MemoryRouter><ToastProvider><AuthProvider><Login /></AuthProvider></ToastProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Sign in with Google')).toBeTruthy());
  });
});
const product = { id: 'p1', name: 'Netflix Premium', slug: 'netflix-premium', delivery_type: 'manual', input_fields: [{ key: 'email', label: 'Your email', required: true }], plans: [{ id: 'pl1', name: '1 Month', duration: '30 days', price_minor: 29900, compare_at_minor: null, in_stock: true }] };
const me = { user: { id: 'u1', email: 'u@x.com', full_name: 'U Ser', phone: '0300123456', roles: [], perms: [] }, csrf: 'tok' };
describe('checkout', () => {
  it('shows required amount + Add Funds when balance is insufficient, and sends an idempotency key', async () => {
    mockApi((u, init) => u.endsWith('/auth/me') ? { body: me } : u.includes('/products/netflix-premium') ? { body: { product } } : u.endsWith('/me/wallet') ? { body: { balance_minor: 10000 } }
      : u.endsWith('/me/checkout') ? { status: 402, body: { error: 'Insufficient wallet balance', required_minor: 19900, add_funds: true } } : undefined);
    wrap('/checkout?plan=pl1&product=netflix-premium', <Protected><Checkout /></Protected>, '/checkout');
    await screen.findByText('Confirm your order');
    expect(screen.getByText(/You need/).textContent).toContain('PKR 199'); expect(screen.getByRole('link', { name: 'Add funds' }).getAttribute('href')).toBe('/dashboard/wallet');
    await userEvent.type(screen.getByLabelText(/Your email/), 'me@x.com'); await userEvent.click(screen.getByRole('button', { name: 'Confirm order' }));
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/me/checkout'))).toBe(true));
    const c = calls.find(x => x.url.endsWith('/me/checkout'))!; const h = c.init!.headers as Record<string, string>;
    expect(h['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/); expect(h['x-csrf-token']).toBe('tok');
    const body = JSON.parse(c.init!.body as string); expect(body).not.toHaveProperty('price_minor'); expect(body.plan_id).toBe('pl1'); expect(body.inputs.email).toBe('me@x.com');
  });
});
describe('secure delivery', () => {
  const order = (delivery: unknown) => ({ order: { id: 'o1', order_number: 'NDL-1', status: 'completed', payment_status: 'paid', total_minor: 29900, created_at: 1, timeline: [{ at: 1, status: 'completed', note: 'Delivered' }] }, items: [{ product_name: 'Netflix', plan_name: '1 Month' }], delivery });
  it('keeps delivery credentials hidden until the customer reveals them', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: me } : u.includes('/me/orders/o1') ? { body: order({ method: 'manual', details: 'user: x / pass: y', note: null, delivered_at: 1 }) } : undefined);
    wrap('/dashboard/orders/o1', <OrderDetail />, '/dashboard/orders/:id');
    await screen.findByText('Reveal delivery details'); expect(screen.queryByText(/pass: y/)).toBeNull();
    await userEvent.click(screen.getByText('Reveal delivery details')); expect(screen.getByTestId('delivery').textContent).toBe('user: x / pass: y');
  });
  it('explains pending delivery for processing orders', async () => {
    const o = order(null); (o.order as any).status = 'processing';
    mockApi(u => u.endsWith('/auth/me') ? { body: me } : u.includes('/me/orders/o1') ? { body: o } : undefined);
    wrap('/dashboard/orders/o1', <OrderDetail />, '/dashboard/orders/:id');
    await screen.findByText(/being processed/);
  });
  it('shows an error state when the order cannot be loaded', async () => {
    mockApi(u => u.endsWith('/auth/me') ? { body: me } : u.includes('/me/orders/o1') ? { status: 404, body: { error: 'Not found' } } : undefined);
    wrap('/dashboard/orders/o1', <OrderDetail />, '/dashboard/orders/:id');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Not found'));
  });
});
