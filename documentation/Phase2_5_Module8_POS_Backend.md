# Phase 2.5, Module 8: POS Backend (with item returns)

Status: complete and verified (120 new backend checks, all earlier suites still pass).

The point of sale is a second front end on the commerce core that Phase 2 built. A POS sale is an ordinary `Order` with `channel = POS`, priced by the same pricing code, written by the same `createOrder`, and it takes stock off the same inventory ledger. Nothing about orders, stock or customers was duplicated. What the POS adds is the things a counter needs that an online checkout does not: who is at the till, the cash drawer, discounts a person gives by hand, change, parked carts, and taking items back.

## Decisions made for the open questions

These were the eight points from the wireframe module. All were accepted and built as follows.

| Question | What was built |
|---|---|
| Cash drawer open and close | Built. A shift starts with a counted float and ends with a blind count; expected cash, counted cash and the variance are stored. |
| Multiple registers | One register per store location, enforced by the database (a partial unique index allows one open shift per location, even for two requests at once). Several locations remain possible later. |
| Hardware | Card is recorded as a payment method, not processed through a terminal. A barcode scanner works because scanners type the code and press Enter. No printer or terminal drivers. |
| Offline mode | Not built. The register needs the API. A retried sale cannot be rung up twice (see idempotency below), and the cart survives a page reload. |
| Item-level returns | Built. Partial and full, with the refund worked out per unit. |
| Held sales | Built, stored in Postgres so they survive a reload and are visible on every till. |
| Manual discount rule | Built as a limit. Owners and staff with `discounts_write` are not limited; everyone else may give up to a percentage the owner sets (default 20%). Every manual discount can carry a reason, which is kept on the order and printed on the receipt. |
| Roles | Two presets: cashier (`pos_sell`) and manager (`pos_sell`, `refunds`, `discounts_write`, `analytics_read`, `orders_write`). The owner creates cashier accounts with a starting password (new). |

## Data model (migrations `20260919040000` and `20260919050000`)

- `PosShift`: location, opener, closer, opening float, expected cash, counted cash, variance, note, open and close times. Partial unique index `WHERE status = 'OPEN'` per tenant and location. `CHECK (openingFloat >= 0)`.
- `OrderReturn` and `OrderReturnItem`: one row per return event and per returned line (product title and amount snapshotted). Refund method, reason, whether stock was restocked, who, and the shift the cash came out of.
- `HeldSale`: cart as product ids and quantities plus an optional discount, customer and label. No prices and no reserved stock.
- `Order` gains `shiftId`, `discountReason`, `clientRequestId` (unique per tenant). `OrderItem` gains `returnedQuantity` with `CHECK (0 <= returnedQuantity <= quantity)`. `Payment` gains `tenderedAmount` (cash handed over). `Refund` gains `shiftId`. `Tenant` gains `posMaxDiscountPercent` (checked 0 to 100).
- Row-Level Security policies for the three new tenant tables are in `prisma/manual-sql/005_enable_rls_pos.sql`, and they are registered in the tenant-scoping layer like every other table.

## Endpoints (all under `/stores/{storeId}/pos`, documented in `openapi.yaml`)

| Route | Permission | Purpose |
|---|---|---|
| `GET /session` | pos_sell | Who is at the till and what they may do |
| `PUT /settings` | owner | Cashier discount limit |
| `GET /products` | pos_sell | Find by exact barcode or SKU, or by part of a name; includes stock |
| `GET`, `POST /customers` | pos_sell | Find or add customers |
| `GET /shift`, `POST /shift/open`, `POST /shift/close` | pos_sell | The drawer |
| `POST /quote` | pos_sell | Price a cart exactly as it would be charged |
| `POST /sales`, `GET /sales`, `GET /sales/{id}` | pos_sell | Ring up, list and read sales (with receipt data) |
| `POST /sales/{id}/returns` | refunds | Take items back |
| `GET`, `POST /held`, `POST /held/{id}/resume`, `DELETE /held/{id}` | pos_sell | Parked carts |
| `GET /reports/daily` | analytics_read | The end-of-day summary |

Two existing endpoints changed: `POST /staff` now accepts `name` and `password` so an owner can create a cashier who has no account yet (rejected if the email already has an account, so an owner can never set someone else's password), and orders now carry `returns`, `shiftId`, `discountReason`, and per-payment `tenderedAmount` and `changeGiven`.

## How the important parts behave

- **Prices are never trusted from the client.** The register sends product ids and quantities; the server prices from the catalog and the store's tax. `POST /quote` uses the same function as the sale, so the screen and the charge cannot disagree. A test sends a price of 0.01 and is still charged 20.00.
- **Split payments and change.** Cash, card and other, up to six payments, which must add up to the total exactly. For cash, `amount` is what pays for the sale and `tendered` is what was handed over; change is the difference and is stored.
- **Discount limit.** Checked in cents with the pricing code's own rounding, so a discount of exactly the limit is never refused by half a cent (found and fixed while testing).
- **A sale is all or nothing.** The order, items, payments, stock movements and customer are written in one transaction. Not enough stock, or a mismatch, and nothing is recorded.
- **Idempotency.** The register sends a `clientRequestId` per sale attempt. Sending it again, even four times at once, returns the one order (201 the first time, 200 after). Verified: exactly one order and one stock deduction.
- **The drawer is race-safe.** A sale takes a share lock on its shift; closing the shift updates the row first, so sales already running finish and are counted, and any sale that starts afterwards is refused (409). Tested with sales racing a close over four rounds: every completed sale is in the closed shift's expected cash and none slipped through.
- **Expected cash** is float plus cash sales minus cash paid back on refunds and returns during the shift. Cash paid back is attributed to the shift open at the time.
- **Returns.** The refund for a unit is its price, less its share of the sale's discount, plus its share of the tax. Returning the last units settles to the exact remainder, so all the parts add up to what was paid (a test returns a discounted sale one unit at a time: 21.23 + 21.23 + 21.25 = 63.71). The first statement locks the order row, so two returns of the same unit queue up and exactly one succeeds. Stock goes back on the shelf unless the manager says the goods are damaged. When every unit is back the sale becomes `refunded`. A whole-order refund after a partial return is refused (409) so nothing is refunded twice. The older whole-order refund still works for a sale nothing has been returned from.
- **Permissions.** Returns need `refunds`. The daily summary needs `analytics_read`. A cashier who tries either gets 403.
- **Daily summary.** The caller chooses the time window (the browser knows the store's local day), so no time zone is assumed. It reports gross, refunds, net, sales count and average, discounts, tax, a split by payment method and by cashier, top items, and every shift with its variance. Tested against totals computed straight from the database.
- **Tenant isolation.** Every new table is scoped by store in the application layer and has a Row-Level Security policy. Tests confirm another store cannot see, resume, return, or report on any of it.

## Verification

- `backend/scripts/verify-pos.ts`: 120 checks through the real HTTP API against real Postgres and MongoDB. Includes concurrency (simultaneous shift opens, duplicate sale submissions, racing returns, sales racing a close), the database-level guarantees (a second open shift and an over-returned item are rejected even by direct insert), and stock-ledger consistency.
- All earlier suites re-run: commerce core 21, checkout 62, orders 63, phase 1 80, security 27. Total backend checks: 373, all passing.
- `openapi.yaml` parses and validates; the only lint error left is the missing `license` field in `info`, which was already absent before this module (the linter also lists 15 style warnings about operations with no 4XX response).

## Not built (kept out on purpose)

Paid-in and paid-out cash movements, several registers or locations at once, hardware drivers and card-terminal integration, offline mode, email or SMS receipts, exchanges as one step (return, then ring up the new item), returns without the original sale, per-line discounts and price overrides, gift cards and store credit, tips, and a manager-PIN override at the till for an over-limit discount (today a manager signs in, or the owner raises the limit).

## Behaviour to know about

- Any cashier can resume or discard a held cart from any till; held carts are shared on purpose so a cart can move between tills.
- The product search is a case-insensitive contains match, fine for the catalog sizes this product targets. A large catalog would want a proper search index.
- Recording a card payment does not move money; the till assumes the card terminal already did.
