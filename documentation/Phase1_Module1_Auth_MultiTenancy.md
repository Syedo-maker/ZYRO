# Phase 1, Module 1: Authentication & Multi-Tenancy

**Status:** Complete and running.
**Deliverable:** A working Express + TypeScript + Prisma backend at `backend/`, tested end-to-end against a real local PostgreSQL database, the first module in this project to actually run, not just document.
**Skill search:** `find-skill` was run first, per the established workflow; three candidates were evaluated and all rejected (wrong domain, wrong architecture, or low-trust/no added value over what was already specified in this project's own docs); see the conversation for the evaluation. Built directly against `Implementation_Plan.md` and `backend/openapi.yaml`.

## What's implemented

- `POST /auth/register`: creates a `User` + their first `Tenant` in one Prisma transaction.
- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`.
- `POST /stores/:storeId/staff`: owner-only, adds an existing `User` as staff with a permissions array.
- The Prisma tenant-scoping middleware from Module 1's design (Section 1 of the implementation plan) is now actually built and enforced, not just described.

## Corrections made during implementation

Writing the real code surfaced three gaps in the original design that weren't visible from planning docs alone:

1. **Refresh tokens are opaque random strings, not JWTs, and never appear in the JSON response body.** The plan said "refresh token (7 days, httpOnly cookie)" but didn't specify the token format. A signed JWT refresh token still needs a server-side lookup to be revocable on logout (a JWT alone can't be un-issued before it expires), so signing it adds cryptographic overhead for no real benefit. Implemented instead: `crypto.randomBytes(48)`, SHA-256 hashed and stored in a new `RefreshToken` table, delivered exclusively via an httpOnly `Set-Cookie` (path `/api/v1/auth`). `openapi.yaml`'s `AuthSession` schema, and the `auth_refresh`/`auth_logout` operations, were updated to match; they originally modeled the refresh token as a JSON body field, which was wrong.
2. **The `RefreshToken` Prisma model didn't exist.** Without server-side storage of *something* representing the refresh token, `auth_logout` cannot actually revoke a session early. This was a genuine gap in the Module 1 (Phase 0) schema pass, added now: `id`, `userId`, `tokenHash` (unique), `expiresAt`.
3. **JWT access tokens don't carry `tenantId`.** The original plan sketch said the token payload would include `userId, tenantId, role`. But nothing in the schema stops a merchant from owning more than one store (`Tenant.ownerId` has no uniqueness constraint), so baking a single tenantId into the token at login time would force a re-login every time they switched stores. Instead, the payload is just `{ sub: userId }`, and every tenant-scoped route carries `:storeId` in the URL; `requireOwner`/`requirePermission` middleware check per-request whether that user has rights to that specific store (owner match, or a `StaffMember` row with the needed permission).

## Infrastructure built (used by every future module, not just this one)

- **`lib/prisma.ts`**: a Prisma Client Extension (the modern replacement for the deprecated `$use` middleware) that auto-merges `tenantId` into `where`/`data` for every tenant-scoped model (`StaffMember`, `Order`, `Payment`, `Shipment`, `ShippingZone`, `DiscountCode`, `AiUsageQuota`, `CartRecoveryEvent`) on every query, using `lib/tenantContext.ts` (`AsyncLocalStorage`) to know which tenant is active. `findUnique`/`update`/`delete`/`upsert` on these models are deliberately **disallowed** and throw: Prisma can't safely merge a tenantId into a unique-key lookup, so call sites must use `findFirst`/`updateMany`/`deleteMany` instead, which this middleware does scope correctly.
- **`middleware/tenantContext.middleware.ts`**: reads `:storeId` from the route and opens the `AsyncLocalStorage` context for the rest of the request.
- **`middleware/requireAuth.middleware.ts`**: verifies the bearer access token.
- **`middleware/requireOwner.middleware.ts`** / **`requirePermission.middleware.ts`**: the authorization primitives every future module's protected routes (`products_write`, `orders_write`, `discounts_write`, `analytics_read`) will use. Only `requireOwner` has a live caller so far (staff creation); `requirePermission` is built now because it's this module's own "per-route authorization middleware" deliverable, ready for Module 4 onward.
- **RFC 7807 error handling** (`errors/AppError.ts` + the error-handling middleware in `app.ts`): matches the `Error` schema in `openapi.yaml` exactly, so every module from here on returns the same error shape.

## Fixed along the way (environment/tooling, not design)

- `prisma/migrations/manual/` (holding the Row-Level Security SQL from Phase 0 Module 1) had to be relocated to `prisma/manual-sql/`, since Prisma's migrate engine scans every subfolder under `prisma/migrations/` expecting a real migration and errored on it.
- Installed PostgreSQL 17 natively (not Docker, to avoid the heavier WSL2/virtualization requirement for local dev; Docker Compose remains the Phase 7 deployment target) and Node.js LTS.
- `staff.service.ts`'s `create()` call passes `tenantId` explicitly (read from `tenantContext`) in addition to relying on the Prisma extension to inject it. Prisma's generated types have no way to know the runtime middleware will supply it, so passing it explicitly satisfies the type checker while the middleware remains a harmless, defense-in-depth backstop.

## Verification

Tested against a real local Postgres database, not mocked:
- Register → 201, `Set-Cookie` refresh token present, correct `AuthSession` shape.
- Duplicate email on register → 409 with the exact `Error` schema shape.
- Login → 200.
- Refresh → 200, new access token issued, refresh token rotated (old one deleted).
- Logout → 204; a subsequent refresh with the same (now-cleared) cookie → 401.
- Owner adds a second user as staff → 201, `tenantId` correctly present on the created row.
- That staff member (non-owner) attempting to add *another* staff member → 403 (owner-only enforced correctly).

No automated test suite yet; Phase 6 is where the plan schedules Jest/Supertest integration tests, including the tenant-isolation test this middleware is specifically built to pass.
