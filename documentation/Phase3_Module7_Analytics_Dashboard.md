# Phase 3, Module 7 (part): Analytics Dashboard (backend, baseline)

Status: complete and verified (48 new backend checks; all earlier suites still pass, 528 in total). With Discount Codes already done, this finishes the backend of Module 7. The dashboard screens themselves belong to the Phase 3 frontend item and are not built here.

## What it does

`GET /stores/{storeId}/analytics/summary` answers, for one store and one period: how much was sold, how much was paid back, what is left, split between the online store and the register, how it moved day by day, and which products sold best. It needs the `analytics_read` permission (the owner always has it).

The plan's design was kept: no separate analytics service, on-demand Postgres aggregate queries, and a five-minute Redis cache instead of a data warehouse. Both channels come from the same orders, so nothing is stitched together from two sources.

| Part of the answer | What it holds |
|---|---|
| `range` | The period, how many local days it covers, the time zone offset used |
| `totals` | Orders, gross sales, discounts given, tax, shipping, refunds (count and total), net sales, average order value, units sold, product margin and how much of it is backed by recorded costs, new customers |
| `byChannel` | Online and in-store side by side (always both, even when one is zero): orders, gross, refunds, net, average order value, share of net sales |
| `daily` | One entry per local day including quiet days, each split by channel, so a chart never has gaps |
| `topProducts` | Up to 10 by units kept, with revenue, units by channel and margin |
| `cached`, `generatedAt` | Whether it came from the 5-minute cache, and when it was computed |

## The definitions (fixed, and identical to the POS daily report)

The same money must never have two answers, so these are the rules, and a test compares the in-store half with the POS daily report for the same window and requires them to be equal.

- **A sale** is an order that has a payment which was taken (succeeded, or later refunded). Unpaid orders and cancelled-unpaid orders are not sales.
- **Gross sales** is the sum of those orders' totals: after discounts, with tax and shipping.
- **Refunds** count in the period they are paid back, not the period of the sale. A refund in August of a July sale reduces August. (This is why a single day's net can be negative.) The count is refund records: a whole-order refund of a split payment is one record per payment, and each item return is one record.
- **Net sales** is gross sales minus refunds.
- **Product figures** cover units still kept: sales refunded or cancelled in full, and units returned item by item, are left out. Revenue is the line total before any order-level discount. **Margin** is price minus the cost recorded when the sale was made, only for items that had a cost, so it is also before order-level discounts. Because some products have no cost recorded, `costCoveragePercent` says how much of the margin figure is real, and a product with no recorded cost shows a margin of `null` rather than a misleading zero.

## Time zones and the period

The caller chooses the period (`from` inclusive, `to` exclusive, at most 366 days) and, for the daily series, `tzOffsetMinutes` (minutes east of UTC, for example 300 for Pakistan). No time zone is guessed on the server. Totals do not depend on the zone; only which day an order falls on does (tested: an order at 23:30 UTC lands on the next day at +05:00). With no dates, the last 30 days are reported, ending on the next five-minute mark, so requests in the same five minutes share one cache entry.

## Speed and the cache

- Four aggregate queries plus a count, run in parallel, each filtered by the store itself (raw SQL bypasses the tenant-scoping layer, so every query carries its own tenant condition; isolation is tested).
- A refund date index was added (`Refund` by store and date); orders already had an index by store, channel and date.
- The result is cached in Redis for five minutes per store, period and zone. A sale made a moment ago may not show until the entry expires; the response says so through `cached` and `generatedAt`. If Redis is unreachable the figures are computed fresh and the failure is only logged (tested): the cache costs speed, never correctness.
- Measured: a 364-day report over 3,000 orders answers in about 140 ms, and every figure still adds up at that size.

## The contract changed

The earlier draft in `openapi.yaml` returned only `salesLast30Days`, `orderCount` and top products by units. That could not express refunds, channels or a chosen period, so it was replaced by the response above. Nothing consumed the old shape yet. `salesLast30Days` is gone; use `totals.netSales` for the default window. The cart-recovery funnel endpoint in the same section belongs to Phase 5 and is untouched.

## Verification

`backend/scripts/verify-analytics.ts` (48 checks against real Postgres, MongoDB and Redis, through the real HTTP API):

- A scenario with online and in-store orders across known days, a discount, a whole-order refund, an item return, an unpaid and a cancelled order, and orders one second before and exactly at the end of the window, checked against every figure worked out by hand (gross 285.40, refunds 32.00, net 253.40, 11 units, margin 100.00, and so on), and against an independent recomputation straight from the database rows.
- The daily series: one entry per day, refunds on the day paid back, days adding up to the totals.
- Parity with the POS daily report.
- Time zones (+05:00 and -05:00), an empty period, tenant isolation (another store sees nothing and cannot read this store's figures).
- Permissions (401, cashier 403, analyst 200, outsider 403) and validation (only one date, reversed, over 366 days, bad date, bad zone).
- The cache: stored for at most 5 minutes, served on the second request, deliberately stale for a sale made in between, refreshed when the entry goes, shared by everyone with access to the store, separate per store, and a Redis outage.
- Speed and correctness with 3,000 orders.

## Not built

Anything that needs history the system does not keep yet: sales by hour, customer lifetime value and repeat rate, conversion and abandoned-cart figures (Phase 5), stock and low-stock insights and forecasting (the Phase 5 AI insights, which will read the stock ledger), profit after order-level discounts, per-cashier and per-payment-method views for the whole store (the POS daily report already has these for the register), and comparing a period with the previous one. Each can be added as another field without changing the ones here.

## Notes for the frontend item

The dashboard should send the browser's own `tzOffsetMinutes` (the negative of `Date.getTimezoneOffset()`), show a "last updated" time from `generatedAt`, and treat a negative daily net as a real thing (refunds landing on a quiet day), not an error. Use the `dataviz` skill for the charts.
