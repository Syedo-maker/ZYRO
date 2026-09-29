# Part B: Usage Counters

Status: built and tested. 16 new backend tests in `backend/tests/integration/usage-counters.test.ts`; the full gate is listed at the end.

`find-skill`: nothing to install. The installed `database-schema-designer` skill covers the one new table; the rest is code in this project's own order, refund and return paths.

## What it does

Each store now has one row per calendar month (UTC) in a new table, `TenantMonthlyUsage`:

| Column | Meaning |
|---|---|
| `onlineOrders`, `posOrders` | Orders taken, by channel |
| `grossSales` | Their totals (tax and shipping included, before refunds) |
| `refundCount`, `refundTotal` | Money paid back: each whole-order refund per payment, and each item return |

It is written **at the moment of the sale, refund or return, inside the same database transaction** as the row it counts:

- `createOrder` (both channels, the one place orders are made) adds the order.
- A whole-order refund or cancellation adds each refund.
- An item return at the register adds the return.

Because it is the same transaction, the counters cannot drift from the orders: if the order is rolled back (for example, the last unit sold out a moment earlier), its count is rolled back with it. Each update is a single `INSERT ... ON CONFLICT DO UPDATE` increment, which Postgres runs atomically, so 20 orders arriving at once count as exactly 20.

The definitions are the same as analytics (Phase 3), so the two never disagree: an order counts once, in the month it was created; a refund counts in the month it was paid back.

## AI usage per store per month

This existed since Phase 4 (`AiUsageQuota`, one row per store per month, a failed call gives its quota back). Part B adds what a call actually cost:

- `inputTokens` and `outputTokens`, added only after a **successful** call. A failed call adds nothing.
- `cachedAnswers`: requests answered from the AI cache (Part A), which cost no quota, tokens or money.

## Who reads it

- The **platform view** (Part A) now reads the counters instead of adding up every order on the platform: per store, all-time and this-month orders and sales, refunds, and AI tokens; platform-wide, orders this month and tokens used. This is what keeps that page fast as the platform grows.
- The **Growth Advisor** (Part C) will read `usageService.history()` for trends such as "sales up more than 30 percent on last month" without scanning orders.

## Existing data

The migration backfills the counters from every order, refund and return already recorded, with the same definitions. On this database that was one store's three register sales (the "Bazuka" store, $3,600), matching the figures the platform view showed before.

## Keeping them honest

`usageService.recount(store, month)` computes what the counters should say from scratch. The tests check that after a mix of online orders, register sales, a retried sale, a failed order, 20 simultaneous orders, a refund and a return, the counters equal the recount exactly. `recount(..., { repair: true })` rebuilds a month if one were ever damaged (by a manual database edit, for example).

## Tests (`usage-counters`, 16)

An online order and a register sale each count once at their total; a retried register sale counts once; a failed order counts nothing; 20 simultaneous orders all count; a refund and a return count the money paid back; counters equal the recount; repair rebuilds a damaged month; another store's counters are untouched; history returns empty months as zeros; a successful AI call records its tokens, a failed one records nothing, a cached answer counts as cached with no quota or tokens; and the platform view's figures are the counters'.

## Deliberate limits

- Months are UTC. A store in Pakistan (UTC+5) sees a sale made after 7 pm on the last day of a month counted in the next month. Analytics, which takes the viewer's time zone, is the place for exact local-day figures; the counters are for trends and totals.
- Sales are in the store's own currency and are never summed across stores.
- Product and staff counts are not counters: they are counted live, which is cheap and always exact.
