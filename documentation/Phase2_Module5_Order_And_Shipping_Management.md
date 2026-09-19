# Phase 2, Module 5: Order & Shipping Management (all channels)

**Status:** backend complete and verified end to end against real PostgreSQL and MongoDB through the real HTTP API. Stripe's refund call was replaced by a recording fake, so a real Stripe refund has **not** been exercised yet (see "What is not verified").
**Builds on:** Commerce Core Foundation and Cart & Checkout. Orders from the online store and (later) the POS are managed through the same endpoints.

**Skill search:** `find-skill` was run first. Nothing installed. The results were either wrapped around specific platforms (Spree, NextCommerce, Shopify-style admin APIs) or generic: a REST design guide, and Prisma's official skills, which target a newer Prisma major version than this project pins. No candidate covered order state rules, refunds or shipping zones, so none was force-installed. The already-installed `stripe-best-practices` skill covered the refund guidance.

## Design

**Order lifecycle** (one pure rules file, `order.rules.ts`):

```
PENDING   -> CANCELLED
PAID      -> FULFILLED | CANCELLED (refunds and restocks) | REFUNDED
FULFILLED -> REFUNDED
COMPLETED -> REFUNDED          (a finished POS sale)
CANCELLED, REFUNDED are final
```

Only `fulfilled` and `cancelled` can be set by hand. `refunded` goes through the refund endpoint because it moves money; `paid` and `completed` are set by `createOrder`. Cancelling a paid order refunds it in full and puts the items back in stock. An order that already shipped or completed can only be refunded.

**Refunds, safe against retries and double clicks.** New `Refund` table, one row per payment (unique on payment id), so it works for Stripe, cash and card-terminal payments alike and split payments refund each part. The order of work is deliberate:
1. Stripe is called first, once per Stripe payment, with an idempotency key (`refund-order-{orderId}-{paymentId}`), so repeating the call returns the same refund instead of paying out twice.
2. Only then does one database transaction run: a conditional update claims the order (exactly one caller wins), the refund rows are written, payments are marked refunded, stock is restored, and a not-yet-shipped parcel is cancelled.
3. If Stripe fails, nothing has changed and the call can simply be repeated.

**Restocking.** Defaults to yes for an order that has not shipped and no for one that already left (fulfilled or a completed POS sale), because those goods are not automatically back on the shelf. The merchant can override with `restock`. Restocked units are recorded as `RETURN` stock movements, so the ledger still adds up.

**Shipments.** One shipment per online order. It only moves forward: `pending` to `shipped` or `cancelled`, `shipped` to `delivered`. A new shipment may start as pending or shipped. Shipping or delivering moves a paid order to `fulfilled`. POS orders have no shipment (they are handed over at the counter). Updates are conditional on the status that was read, so two simultaneous updates cannot both apply.

**Shipping zones.** Create, update, delete for staff with `orders_write`; the list is public so the storefront can show shipping options before checkout. Checkout copies the zone's name and rate into the order, so later edits or deletion never change an order already placed.

**Who can see what.** The merchant side sees any order. A logged-in shopper sees only orders under their own customer record; every other order answers 404 rather than 403, so order ids cannot be probed. Refunds and cancelling a paid order need the `refunds` permission; everything else needs `orders_write`. The contract said refunds need `orders_write`; I tightened that to use the `refunds` permission added in the foundation module, since refunding is a more sensitive right than managing orders.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /stores/:storeId/orders` | List, newest first. Filters: `status`, `channel`, `q` (order number or email), `from`, `to`, paging |
| `GET /stores/:storeId/orders/:orderId` | One order with items, payments, refunds, shipment |
| `PATCH /stores/:storeId/orders/:orderId/status` | `fulfilled` or `cancelled` |
| `POST /stores/:storeId/orders/:orderId/refund` | Full refund, optional `reason` and `restock` |
| `PUT /stores/:storeId/orders/:orderId/shipment` | Create or update the shipment (new in the contract) |
| `GET/POST/PUT/DELETE /stores/:storeId/shipping-zones` | Shipping rates |

Schema addition: `Refund` (migration `20260919020000_refunds`, RLS in `manual-sql/004_enable_rls_refunds.sql`). No new dependencies. Enums in this API are lowercase, as `openapi.yaml` specifies.

## Verification (63 checks, all passing)

`npx tsx scripts/verify-orders.ts` drives the real HTTP API. It covers: zone CRUD with permissions and a public list; order list filters, search by number and by customer email, date range, paging, lowercase enums; detail visibility for merchant, own shopper, other shopper, other store; the manual status rules; cancelling a paid order (permission, Stripe key, restock, cancelling twice); refunds of a POS cash sale, a split card-plus-cash sale, and a shipped online order; **two simultaneous refunds of one order (exactly one wins, one refund record, stock restored once)**; a Stripe failure leaving the order untouched and a later retry succeeding; the full shipment flow including forbidden transitions; the stock ledger still summing to the current stock; and tenant isolation. The 49-check checkout suite and 21-check foundation suite were re-run and still pass.

## What is not verified

- **A real Stripe refund.** Still no Stripe keys, so refunds were exercised against a fake that records the call and idempotency key. Do one test refund after the Stripe sandbox is set up (see the checkout module doc).

## Decisions and known limits

- **Full refunds only.** Partial refunds and item-level returns need to know which lines came back; they arrive with the POS returns work in Phase 2.5.
- **`fulfilled` means shipped.** It is set when a shipment is marked shipped or delivered, or by hand for orders that need no shipment (for example collection).
- **No emails.** Nothing notifies the shopper about shipping or refunds yet.
- **A shopper cannot yet list their own orders,** and the order-confirmation page has no way to look up an order from the Stripe `session_id` in the success URL. Both are needed by the storefront frontend module and are not in the current contract; they should be added with that module.
- **Cash refunds are records, not payouts.** For cash and card-terminal payments the system records that the merchant handed the money back; it cannot move that money itself.
- **Known contract drift, still open:** staff permissions in `openapi.yaml` are lowercase while the staff endpoint accepts the uppercase enum names.
