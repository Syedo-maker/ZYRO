# Phase 5: AI Business Insights

Status: complete and verified (16 new backend checks in `verify-insights.ts`; all other backend suites still pass, 758 backend checks in total). This closes out Phase 5, which is now fully complete. Backend only, matching the checklist item's own scope; there is no separate frontend item for this one, unlike Module 3's chat widget.

A `find-skill` search found nothing to install: `claude-api` (already installed) covers the orchestrator call, and the actual analysis - the SQL over this schema's own tables - is business logic specific to this codebase, not something a packaged skill would provide.

## What it computes, and what it doesn't invent

Every number in an insight comes from real data, computed the same way the rest of this codebase always has (raw SQL/Prisma aggregates); the AI orchestrator is only ever handed the finished facts and asked to write them up in plain language, never asked to produce or guess a number itself:

- **Sales trend.** This week's net sales vs. the preceding week, reusing the analytics module built in Phase 3 (`analyticsService.summary()`) for two different 7-day windows rather than duplicating its SQL. `changePercent` is `null` when there is nothing to compare against yet (no sales at all the week before), instead of a misleading 0% or a divide-by-zero.
- **Best sellers.** The same `topProducts` the analytics dashboard already shows, for the current week.
- **Low stock and a simple demand forecast**, from two things that already existed but were never wired together:
  - `InventoryLevel.lowStockThreshold` - a Phase 0 schema field with no code anywhere reading or writing it until this module. When a merchant has set one (per product, per location; the smallest one across a product's locations is used, so a store with several is never less cautious than its strictest), it wins over the fallback (`LOW_STOCK_FALLBACK_THRESHOLD`, default 5).
  - The `StockMovement` ledger's `SALE` rows (already recorded by every sale, online or POS, since Phase 2) give a daily sell-through rate over the trailing `INSIGHTS_VELOCITY_WINDOW_DAYS` (default 14). Dividing current stock by that rate is the "simple demand forecasting" the plan asks for: a product forecast to run out within `INSIGHTS_FORECAST_DAYS_THRESHOLD` days (default 7) is flagged even if its stock is still above its threshold.

## Cached like a review summary, not recomputed on every read

`GET /stores/:id/insights` never calls the AI: it returns whatever was last generated (or `null`), plus whether it is old enough (`INSIGHTS_STALE_AFTER_HOURS`, default 24) to offer regenerating - the same "cache the result, report staleness, let the merchant ask for a fresh one" shape Module 6 built for review summaries, reused here because it fits the same problem (a summary of frequently-changing figures, worth having between merchant visits without regenerating it, and re-costing AI quota, on every dashboard load). `POST /stores/:id/insights/generate` recomputes the underlying facts and replaces the one cached row per store (a new `AiBusinessInsight` table, `tenantId` unique) - not a history log, since nothing in the plan asks this to be one.

A generation that hits the monthly quota limit (402) never touches the previously cached write-up: the merchant keeps seeing the last real insight rather than losing it to a refused regeneration attempt, verified directly (generate to the limit, generate once more, confirm the 402, confirm `GET` still returns the earlier text unchanged).

## What the plan's "outcome" language does not cover here

Unlike cart-recovery performance (which has real send/convert data to report), this item is the write-up itself; there is no separate "did the merchant read it" tracking to build, and the plan does not ask for any.

## Verification

`backend/scripts/verify-insights.ts` (16 checks, fake AI provider, real Postgres/MongoDB/Redis/BullMQ): a fresh store has nothing cached; a generated insight carries a real trend percentage from two real weeks of orders, a real best seller, a product low on stock from the plain fallback threshold *and* a separate one from its own merchant-set `lowStockThreshold` despite ample stock; the prompt handed to the model names real products and real figures; quota is spent on generate but not on a cached read; staleness flips correctly once old enough; a quota-exhausted regeneration attempt is refused without disturbing the last good write-up; permissions; and tenant isolation.

## Deliberate limits

- No admin UI (a data endpoint only, matching this item's backend-only scope in the plan).
- No history of past insights - generating replaces the one cached row per store.
- The forecast is a plain daily-average sell-through rate, not seasonality-aware or otherwise statistically modeled - "simple demand forecasting", as the plan itself calls for.
