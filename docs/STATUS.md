# Verification status

Verified in this build environment: TypeScript (worker + web), Vite production build, Wrangler Worker bundle (dry-run), D1 migrations applied on the local workerd D1 engine, 53 automated tests (SQL-level backend tests on a SQLite D1 shim, supplier dispatch with mocked fetch, React flow tests in jsdom), and `scripts/e2e.mjs` (20 live checks against `wrangler dev`: setup, auth, deposit approval, parallel duplicate checkout, delivery, RBAC, audit).

NOT verified / not done:
* Not deployed to real Cloudflare (no account access here); deploy and run `scripts/e2e.mjs` against staging, including parallel-request checks on real D1.
* No real-browser or mobile-device visual testing (no browser available). Layout uses responsive Tailwind classes; review on phone/tablet before launch.
* Google Sign-In flow untested against Google. Email provider not connected. PayFast not integrated. No real supplier API is configured.
* Inventory delivery claims the item and then writes the delivery in a second step; if the Worker dies between them, an item could be marked sold without a delivery row (admin can see this in Inventory/Orders). A fully atomic variant is a recommended hardening.
* Cancelling/refunding does not restock limited-stock plans automatically.
* Default Terms/Privacy/Refund texts are placeholders and are not legal advice; replace them.
* Uploaded images are served as-is (no resizing); use small optimized images.
