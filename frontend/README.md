# ZYRO frontend

React 18 + TypeScript + Vite + Tailwind CSS v4.

## First-time setup

```bash
npm install
npm run dev
```

Requires the backend running at `http://localhost:5000` (see `backend/README.md`). The
Vite dev server proxies `/api` and `/uploads` to it (`vite.config.ts`), so requests from
the browser stay same-origin. This isn't just convenience: the backend's refresh token is
an httpOnly cookie, and same-origin is what makes that work reliably in development
without cross-origin cookie edge cases.

Then visit `http://localhost:5173`.

## Notes on what's implemented so far (Phase 1 and Phase 2 frontend modules)

- Register / Login, wired to `auth_register` / `auth_login`.
- Admin shell with a sidebar matching `design/wireframes/AdminDashboard.dc.html`.
  **Products** and **Orders** are enabled; the rest render visibly but disabled until their
  backends exist (Dashboard and Marketing: Phase 3).
- Storefront under `/store/:storeId`: cart, checkout (shipping method, then Stripe's hosted
  payment page), and order confirmation. The product grid on the storefront home is a
  deliberately minimal placeholder, replaced in Phase 3 by the real storefront pages.
- Orders page (`/admin/orders`): status tabs with counts, search, channel filter, order
  detail with shipment, cancel and refund, and shipping zones.
- Products page: full CRUD + image upload, matching `design/wireframes/AdminCatalog.dc.html`.
- Design tokens (`src/index.css`, the `@theme` block) are copied exactly from
  `design/wireframes/ComponentInventory.dc.html`, since Tailwind v4 uses CSS-based theme
  config, not `tailwind.config.js`.

Browser test for Phase 2: see the header of `e2e/phase2-checkout.e2e.mjs` for how to run it.
Write-up: `documentation/Phase2_Frontend_Storefront_And_Admin_Orders.md`.

See `documentation/Phase1_Frontend_Auth_And_Admin_Catalog.md` for the full write-up,
including three real bugs (a session-persistence race condition, a cross-origin cookie
issue, and an invalid regex) that only browser testing, not API-only testing, could
have caught.
