# Noorix Digital Lab — Cloudflare digital marketplace

React + TypeScript + Vite + Tailwind frontend and a Hono/Zod REST API on **one Cloudflare Worker** (static assets + API), with **D1** (SQLite) and **R2**. Money is stored as integer paisa (PKR × 100).

## Features
Customer site (home, catalog, categories, product/plan pages, search, deals, trending, track order, info pages, contact) · email/password auth (register, login, logout, forgot/reset, verify email, profile, password change) · dashboard (overview, wallet, orders, secure delivery, tickets, notifications, settings) · wallet ledger + manual deposits · checkout with idempotency · manual / inventory / supplier-API delivery (encrypted at rest) · refunds · coupons · full admin panel (`/admin`) with 5 roles, audit logs, reports/CSV, staff, suppliers, payment methods, banners and page content · sitemap.xml / robots.txt / meta tags.

## Local development
```bash
npm install
cp .dev.vars.example .dev.vars        # fill DELIVERY_KEY and SETUP_TOKEN (see file)
npm run build:web                      # builds ./dist (served by the Worker)
npm run db:migrate:local
npm run dev:worker                     # http://127.0.0.1:8787  (UI + API)
# optional hot-reload UI:  npm run dev  (Vite proxies /api to the Worker)
```

## Deploy to Cloudflare
```bash
npx wrangler login
npx wrangler d1 create noorix-db                 # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create noorix-uploads
npm run db:migrate:remote
openssl rand -base64 32 | npx wrangler secret put DELIVERY_KEY   # AES-256 key for delivery data. Back it up; losing it makes delivered data unreadable.
openssl rand -hex 24    | npx wrangler secret put SETUP_TOKEN
npm run build:web && npm run deploy
```
Add the custom domain `noorixdigitallab.online` to the Worker (Workers → Settings → Domains & Routes). Set `APP_URL` in `wrangler.jsonc` if the domain differs.

## First Super Admin (one time)
```bash
curl -X POST https://noorixdigitallab.online/api/setup/super-admin \
  -H "x-setup-token: <SETUP_TOKEN>" -H "content-type: application/json" \
  -d '{"email":"you@example.com","full_name":"Your Name","password":"at-least-12-characters"}'
```
Works only with the token and only until a Super Admin exists (then 410). Afterwards: `npx wrangler secret delete SETUP_TOKEN`. Then log in at `/login` and open `/admin`.

## First-run checklist (owner)
1. Admin → **Payment methods**: enter real Easypaisa/JazzCash/Bank details and activate (seeded methods are inactive; PayFast is a placeholder and not connected).
2. Admin → **Products**: edit/replace sample products, set prices, upload images, set delivery type.
3. Admin → **Content**: replace the default Terms/Privacy/Refund text with your own reviewed policies.
4. Admin → **Staff**: create staff accounts (Order Manager, Finance Manager, Support Agent, Product Manager).

## Delivery types
* **Manual** – staff open Admin → Orders → Manage → *Submit delivery* (encrypted, customer notified).
* **Inventory** – Admin → Inventory → paste items per plan; assigned atomically at checkout.
* **Supplier API** – Admin → Suppliers: HTTPS base URL, secret *name* (`wrangler secret put NAME`), JSON request template (`{{order_number}} {{sku}} {{email}} {{inputs.KEY}}`) and response map (`delivery_path`). Link a product (delivery type “Supplier API”) and set each plan's supplier SKU. No supplier is pre-configured. Failed dispatches stay *processing* and can be retried in the order dialog.

## Google Sign-In (prepared, inactive)
`oauth_accounts`/`oauth_states` tables and the provider flow (state + nonce + PKCE, safe linking by verified email) are implemented in `src/worker/lib/oauth.ts`. **It has not been tested against live Google.** The Login page shows the button only when `/api/auth/providers` reports it configured. To activate: Google Cloud Console → Credentials → OAuth client (Web) → redirect URI `https://noorixdigitallab.online/api/auth/oauth/google/callback` → `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## Email
`src/worker/lib/email.ts` is an adapter; no provider is connected, so verification/reset emails are only logged. Connect a real provider before relying on password reset in production.

## Security notes
PBKDF2-SHA256 hashes · HTTP-only Secure SameSite=Lax session cookies (hashed in DB) · per-session CSRF header · D1-backed rate limits · Zod validation · parameterised SQL · immutable ledger (DB triggers) + `CHECK(balance >= 0)` + unique references · AES-GCM delivery encryption · server-side RBAC · audit log on admin/financial actions · secure upload type/size checks · CSV formula-injection guard · security headers.

## Commands
`npm test` (backend + frontend, 53 tests) · `npm run typecheck` · `npm run build` (typecheck + Vite + Worker dry-run) · `node scripts/e2e.mjs` (live checks against a running `dev:worker`).

## Known limitations
See `docs/STATUS.md`.
