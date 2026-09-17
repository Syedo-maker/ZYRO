# Phase 1, Frontend Module: Auth Screens & Admin Catalog UI

**Status:** Complete, tested with an automated headless-browser smoke test against the real running backend (not mocked).
**Deliverable:** `frontend/`, a React 18 + TypeScript + Vite + Tailwind v4 app: register/login screens and a working Admin Catalog Management UI, matching `design/wireframes/AdminCatalog.dc.html`.
**Skill search:** `find-skill` was run first; four candidates were evaluated and all rejected (wrong purpose, a code-review guide rather than a scaffolding guide, an unfocused repo that didn't actually contain what it advertised, and a 255-skill bulk-conversion farm too shallow to add value). Built directly against the existing wireframes, `openapi.yaml`, and the working backend.

This is the first frontend code in the project. It's also the first module verified with a real browser rather than `curl`/PowerShell `Invoke-WebRequest`, and that testing caught three genuine bugs that API-only testing could never have surfaced (below).

## What's implemented

- Vite + React 18 + TypeScript scaffold, Tailwind v4 (CSS-first `@theme` config, not the old `tailwind.config.js`, since v4 changed this), design tokens copied exactly from `ComponentInventory.dc.html` so the built app matches the approved wireframes rather than drifting.
- `AuthContext`: in-memory access token (never `localStorage`, matching the backend's own httpOnly-cookie choice for the refresh token), silent session restore on page load via `auth_refresh`.
- Register and Login pages, wired to `auth_register`/`auth_login`.
- Admin shell (`AdminLayout`) matching the wireframe's sidebar: only "Products" is enabled; Dashboard/Orders/Marketing/Settings render visibly but disabled, since their backends don't exist yet (Phases 2/3).
- Products page: list, create, edit, delete, with a working image-upload flow (drag-in-a-file → `uploads_image_create` → preview), full CRUD against the Phase 1 Module 4 backend.

## A real backend gap this module surfaced

**There was no way for the frontend to find out which store a logged-in user manages.** `auth_register`/`auth_login` return the `User` but never a `Tenant`, a gap invisible from the backend side alone, since nothing there needed that information. Fixed by adding a new `users` resource:
- `GET /users/me`: the caller's own profile (needed because `auth_refresh`, used on every page reload, returns only a new access token, not user data).
- `GET /users/me/stores`: the stores the caller owns or is staff at.

Both are inherently cross-tenant queries (a user's own memberships span stores by definition), which conflicts with the Phase 1 Module 1 Prisma extension's assumption that every `StaffMember`/`Tenant`-adjacent query is scoped to one tenant. Resolved with a deliberate, narrowly-documented escape hatch: `lib/prisma.ts` now also exports `prismaUnscoped` (the raw, unwrapped client), used only for this class of "look up my own data across tenants" query, never for browsing another tenant's business data.

## Three real bugs found only by browser testing

Every earlier module was verified with `curl`-equivalent API calls, which is sufficient for a stateless request/response contract. A session-persistence bug is fundamentally different: it only exists across multiple requests with real browser cookie/storage behavior, which no API-only test can exercise. Running an actual headless browser against the actual running app found:

1. **Sessions didn't survive a page reload at all**, initially suspected as a cross-origin cookie issue. Fixed by adding a Vite dev-server proxy (`vite.config.ts`, `/api` → `http://localhost:5000`) so the browser sees the API as same-origin, the standard, more production-realistic pattern for a separately-deployed SPA + API, and it removes an entire class of cross-origin cookie/CORS edge cases rather than working around one instance of it.
2. **The real root cause, found after the proxy didn't fully fix it**: React 18/19 StrictMode double-invokes effects in development, so `AuthProvider`'s silent-restore-on-mount fired the refresh call **twice, concurrently**. Since refresh *rotates* the token (deletes the old row, issues a new one), the second concurrent call hit an already-deleted row and crashed with an unhandled Prisma error (500) instead of failing gracefully, a genuine concurrency bug in `auth.service.ts`, not a frontend issue. Fixed two ways: the backend now uses `deleteMany` (reports a count) instead of `delete` (throws if the row is gone) and returns a clean 401 for the losing request; the frontend also guards the mount effect with a ref so it doesn't fire the non-idempotent refresh twice per mount in the first place.
3. **The store-slug input's `pattern` attribute was invalid** under newer browsers' stricter "v-mode" character-class regex rules: `[a-z0-9-]` needs its hyphen escaped (`[a-z0-9\-]`) now. A one-character fix, but not something any amount of API testing would ever catch.

## Verification

Two automated headless-browser (Playwright) test runs against the real backend and a real Postgres/MongoDB instance, not mocked:
- Register → session persists across a full page reload → edit → delete → logout.
- Log out then log back in via the Login page (a separate, previously-untested code path from register).
- Wrong password shows an inline error and does not navigate away from `/login`.
- Image upload: select a file → preview appears → save → product persists with the image.

No console/page errors other than the two expected 401s from the very first silent-refresh attempt before any session exists (normal, harmless, and unavoidable: any fetch returning a non-2xx status logs to the browser console regardless of how the app handles it).
