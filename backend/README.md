# ZYRO backend

Node.js 20+ / Express / TypeScript / Prisma (PostgreSQL) / Mongoose (MongoDB).

## Prerequisites

- Node.js and npm
- A running PostgreSQL instance with a database + role matching `DATABASE_URL`
- A running MongoDB instance matching `MONGODB_URI`

## First-time setup

```bash
cp .env.example .env        # then edit DATABASE_URL / JWT_ACCESS_SECRET for your machine
npm install
npx prisma generate
npx prisma migrate dev
```

If your Postgres role has `CREATEDB` revoked, `prisma migrate dev` will fail trying to build
its shadow database (error `P3014`); grant it once: `ALTER ROLE <role> CREATEDB;`.

Row-Level Security is **not** managed by Prisma migrations; apply it once, manually, after
the first migration:

```bash
psql -h localhost -U <superuser> -d <database> -f prisma/manual-sql/001_enable_rls.sql
psql -h localhost -U <superuser> -d <database> -f prisma/manual-sql/002_enable_rls_commerce_core.sql
```

If you have products from before the Commerce Core Foundation module, move their legacy
`stock` values into inventory once with `npx tsx scripts/backfill-inventory.ts`. To check the
inventory, order and tenant-isolation logic against your local databases, run
`npx tsx scripts/verify-commerce-core.ts` (it creates and removes its own throwaway stores).

(This file deliberately lives outside `prisma/migrations/`, since Prisma's migrate engine treats
every subfolder in that directory as a real migration and errors on anything that isn't one.)

## Running

```bash
npm run dev      # tsx watch, hot reload on save
```

Then visit `http://localhost:5000/health` (or whatever `PORT` you set); you should see
`{"status":"ok"}`. The full API is under `http://localhost:5000/api/v1/...`, matching
`openapi.yaml`.

## Notes on what's implemented so far

**Phase 1, Module 1: Authentication & Multi-Tenancy**
- `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`
- `POST /api/v1/stores/:storeId/staff` (owner-only)
- Refresh tokens are **opaque random strings, not JWTs**, hashed and stored in the
  `RefreshToken` table, delivered via an httpOnly cookie, never in the JSON response body.
  This is a deliberate correction from the original plan sketch: a signed JWT refresh token
  still needs a DB lookup to be revocable on logout, so signing it adds nothing.
- The JWT access token payload is just `{ sub: userId }`, no `tenantId` baked in, since a
  merchant can own more than one store. Every tenant-scoped route instead takes `:storeId`
  in the URL, and authorization middleware checks per-request whether the caller has rights
  to that specific store.
- See `documentation/Phase1_Module1_Auth_MultiTenancy.md` for the full design writeup.

**Phase 1, Module 4: Store & Catalog Management**
- `GET/POST /api/v1/stores/:storeId/products`, `GET/PUT/DELETE /:productId`: Mongoose-backed,
  `GET`s are public, writes require the `PRODUCTS_WRITE` staff permission (or owner).
- `POST /api/v1/stores/:storeId/uploads/images`: multipart upload, saved to local disk
  (`UPLOADS_DIR`), served back at `/uploads/<filename>`; returns `{ url }`.
- `GET /api/v1/stores/:storeId` (public), `PATCH /api/v1/stores/:storeId/branding` (owner-only).
- See `documentation/Phase1_Module4_Store_Catalog_Management.md`, which includes two real bugs
  this module's implementation surfaced in the Phase 0 Mongoose schemas (ObjectId vs. string
  ID fields, and a gap in the tenant-scoping plugin's hook coverage).
