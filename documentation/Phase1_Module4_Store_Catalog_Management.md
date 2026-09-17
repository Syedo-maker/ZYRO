# Phase 1, Module 4: Store & Catalog Management

**Status:** Complete and running, tested end-to-end against real local Postgres + MongoDB instances.
**Deliverable:** Product CRUD (Mongoose/MongoDB), store profile + branding update (Prisma/Postgres), and an image upload endpoint, all live in the running backend.
**Skill search:** `find-skill` was run first; all three candidates found were rejected: one locked to the wrong ORM/database (Sequelize+MySQL, explicitly "not adaptable to Mongoose"), one pointed at a GitHub repo that doesn't exist (404, an unreliable aggregator listing), and a direct search for a Multer/upload-specific skill turned up nothing beyond Multer's own docs. Built directly.

## What's implemented

- `GET /stores/:storeId/products`: public, supports `q` (MongoDB text search), `category` filter, pagination.
- `POST /stores/:storeId/products`: requires `PRODUCTS_WRITE` (owner or staff).
- `GET /stores/:storeId/products/:productId`: public.
- `PUT /stores/:storeId/products/:productId`, `DELETE /stores/:storeId/products/:productId`: requires `PRODUCTS_WRITE`.
- `POST /stores/:storeId/uploads/images`: multipart upload, returns a served URL; requires `PRODUCTS_WRITE`.
- `GET /stores/:storeId`: public store profile.
- `PATCH /stores/:storeId/branding`: owner-only.

## Corrections made during implementation

Two real bugs and one contract gap surfaced only once Postgres and MongoDB data actually had to reference each other for the first time:

1. **`storeId`/`customerId` fields across all four Mongoose models (`Product`, `ProductReview`, `AiGeneratedContent`, `ChatTranscript`) were typed as Mongo `ObjectId`, but they hold `Tenant.id`/`User.id` values, which are Prisma `cuid()` strings, not Mongo ObjectIds.** This was a genuine bug from the Phase 0 Module 1 schema design that would have broken (or silently miscast) the moment real cross-database data flowed through it. Fixed: all four now type these fields as plain `string`. `productId` fields (which reference a real Mongo-native `Product._id`) were correctly left as `ObjectId`; only the fields pointing back to Postgres needed fixing.
2. **The `tenantScopePlugin` from Module 1 only hooked `find`/`findOne`/`countDocuments`/`updateMany`/`deleteMany`.** Mongoose's `findOneAndUpdate`, `findOneAndDelete`, `updateOne`, and `deleteOne` are *separate* hook names, not variants of the ones already covered, so this module's `product.service.ts` (which needs `findOneAndUpdate`/`deleteOne` to scope updates/deletes by `storeId` correctly) would have silently bypassed the guard entirely. Fixed by registering the guard against all ten relevant hook names individually (Mongoose's array-of-hook-names `pre()` overload didn't type-check against the full set, so each is registered separately in a loop).
3. **The API contract never specified how an image URL comes to exist.** `ProductInput.images` and `store_branding_update`'s `logoUrl` both take pre-hosted URLs, but Module 3's contract draft never defined an upload endpoint to produce one. Added `POST /stores/:storeId/uploads/images` (multipart, returns `{ url }`) to `openapi.yaml`, under a new `uploads` tag.

## Design decisions

- **Local disk storage for uploaded images** (via Multer, served through `express.static`), per the "local disk volume for prototype" option Implementation_Plan.md named as an alternative to S3-compatible object storage. Only the resulting URL is ever written to MongoDB; the binary never touches a database.
- **Multer 2.x, not the 1.x LTS line**: `npm install` surfaced a deprecation warning that 1.x has known vulnerabilities patched in 2.x. Since this package directly handles untrusted user-uploaded files (unlike the earlier dev-only Prisma CLI advisory, which was accepted as low-risk), upgrading was the right call rather than accepting the risk.
- **Search folded into the list endpoint, not a separate path** (`GET /products?q=...`), consistent with the convention decided in Module 3.
- **`requirePermission` requires `withTenantContext` even on routes whose actual data queries don't need it**: the permission-check middleware itself looks up the caller's `StaffMember` row via the active tenant context, so it's a dependency of the *authorization* layer, not the Mongoose queries underneath it.

## Verification

Tested against real local Postgres + MongoDB instances:
- Public store profile fetch, owner-only branding update.
- Product create → list (with text search matching) → get → update → delete → post-delete 404.
- Cross-tenant isolation: fetching a real product ID under a different (nonexistent) `storeId` correctly returns 404 rather than leaking the product.
- Image upload → returns a URL → the URL is independently fetchable and serves the correct content type.
- A staff member with only `PRODUCTS_WRITE` can create products; a fully unrelated registered user (no owner/staff relationship to the store at all) is correctly blocked with 403.
