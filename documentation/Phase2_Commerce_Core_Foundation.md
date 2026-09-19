# Phase 2: Commerce Core Foundation

**Status:** complete, verified against the real local PostgreSQL and MongoDB.
**Why this module exists:** ZYRO is now a Commerce + POS SaaS (see the amendment note in `Implementation_Plan.md`). Before building checkout, the existing schema was reviewed against that vision and found to be online-only. This module fixes that base so the online store and the POS share one catalog, one inventory, one order model.

## What the review found

| Area | Problem | Fix in this module |
|---|---|---|
| Inventory | `stock` was a number on the MongoDB product while orders live in Postgres, so "create order and deduct stock" could not be one transaction. No history either. | `InventoryLevel` + `StockMovement` ledger in Postgres. Product `stock` field removed from Mongo. |
| Orders | No channel, cashier, location, order number or tax. No status for an in-store sale. | `Order.channel`, `orderNumber`, `locationId`, `cashierUserId`, `taxAmount`; new `COMPLETED` status. |
| Payments | Required a Stripe id, so cash or card-terminal sales could not be recorded. | `Payment.method`, nullable Stripe id, several payments per order. |
| Customers | Global `User` accounts only; a walk-in had no record and a business could not list only its own customers. | Tenant-scoped `Customer`, optionally linked to a `User`. `Order.customerId` now points at it. |
| Permissions | Nothing for selling, stock or refunds. No platform admin. | `POS_SELL`, `INVENTORY_WRITE`, `REFUNDS`; `User.platformRole` (`USER` or `SUPER_ADMIN`). |
| Stores | One tenant meant one place. | `Location`, with a default created at registration. |

## What was built

- **Migration** `20260919000000_commerce_core_foundation`: new tables and enums, a `CHECK (quantity >= 0)` constraint on inventory, and a default location for every existing tenant. RLS for the four new tables is in `prisma/manual-sql/002_enable_rls_commerce_core.sql`, and the tables are also in the Prisma tenant-scoping list in `lib/prisma.ts`.
- **`modules/inventory/inventory.service.ts`**: the only code that changes stock. `setQuantity` (initial stock, edits) and `deduct` (sales). `deduct` uses one conditional `UPDATE ... WHERE quantity >= n`, so two sales racing for the last unit cannot both succeed, and processes items in product-id order so multi-item sales cannot deadlock.
- **`modules/commerce/pricing.service.ts`**: pure totals calculation in integer cents (subtotal, percentage or fixed discount, tax on the taxable share after discount, shipping). Prices are tax-exclusive.
- **`modules/commerce/order.service.ts`**: `createOrder`, the one transactional place orders are written for every channel. The caller sends product ids and quantities only; prices, tax and stock are decided server-side. Payments must equal the total. If anything fails, nothing is written and the order number is not consumed. POS orders finish as `COMPLETED`, online orders as `PAID`.
- **Product API**: `stock` in the request is now written to inventory (a different value records an `ADJUSTMENT` movement) and reads return the inventory total. New optional `sku`, `barcode`, `taxable`, `costPrice`; SKU and barcode are unique per store. Public product reads now run inside a tenant context because they read tenant-scoped inventory.
- **Registration** creates the default location in the same transaction as the store.
- **`scripts/backfill-inventory.ts`** moved legacy Mongo `stock` values into inventory (4 products locally). **`scripts/verify-commerce-core.ts`** is the verification below.
- **`openapi.yaml`** updated: product fields, staff permissions, `completed` status, `SalesChannel`, order fields.

## Verification (real databases, 24 checks, all passing)

`npx tsx scripts/verify-commerce-core.ts` covers:

- Pricing: rounding, discount allocation to the taxable base, fixed discount capped at the subtotal.
- Registration creates exactly one default location; product create stores stock in inventory and not on the Mongo document; duplicate SKU rejected.
- A POS sale and an online sale both draw from the same stock (10, then 7, then 5), with correct order numbers, statuses and tax.
- Oversell is rejected and leaves stock unchanged; a payment that does not match the total is rejected.
- **5 concurrent sales of the last unit: exactly 1 succeeds**, stock ends at exactly 0, failed attempts do not consume order numbers, and the stock ledger sums to the current quantity.
- Tenant B cannot sell tenant A's product, and cannot read tenant A's inventory even by explicitly asking for its tenant id.

A separate HTTP smoke test confirmed register, product create, update, public list and public read still work through the real API, and that a duplicate barcode returns a clean 400.

## Decisions and known limits

- **Catalog stays in MongoDB, inventory moves to Postgres.** The stack is unchanged; only the field that needed transactional integrity moved. Creating a product writes to two databases, so a failed inventory write deletes the just-created product rather than leaving one without a stock record.
- **Order numbers take a row lock on the tenant while an order is created.** This serializes order creation per store for a few milliseconds. That is fine for the MVP; a per-tenant sequence table is the upgrade path if a single store ever needs very high write rates.
- **Stock is deducted when payment is confirmed, not reserved at checkout.** An online shopper can therefore lose a race after paying; Module 2 must handle that (refund or backorder). Timed reservation is a later improvement.
- **Row-Level Security policies exist but the API does not yet connect as the restricted `app_user` role or set `app.current_tenant_id`.** Application-layer scoping is what is enforced today, as before this module; wiring the database layer is part of the Phase 7 tenant-isolation work.
- **Variants, stock transfers between locations, cashier shifts, returns and tax-inclusive pricing are deferred.** The schema leaves room for each.
- **Known contract drift, not introduced here:** `openapi.yaml` lists staff permissions in lowercase while the API accepts the uppercase enum values. To be reconciled when the staff endpoints are next touched.
- The product form in the admin UI needed no change; SKU, barcode, taxable and cost fields get UI in the POS phase.
