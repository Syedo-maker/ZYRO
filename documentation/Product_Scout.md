# Product Scout: trending products for owners

Status: built and tested on branch `feature/product-scout` (2026-10-22).

Product Scout shows a store's owner and Managers what is selling across ZYRO shops in their market, so they can decide what to stock. It is aimed especially at new owners, who also get a guided setup. It follows Trend Scout's pattern (`PartD_Trend_Scout.md`) and reuses its privacy checks and its line checker.

- **The figures** come from a deterministic daily calculation. There is no AI in it.
- **The AI** only puts those figures into words, and every number it writes is checked.
- **The platform pays** for that AI. No store's AI allowance is touched.

## What an owner sees

A **Trending products** panel on the right of the dashboard and of the Products page. On a small screen it sits at the top. It collapses to a slim tab and remembers that per page.

- **Top sellers**, **Fastest growing**, and **Rising in each category**. Each product shows:
  - the units sold, orders and number of shops;
  - the previous period's units, when they may be shown;
  - a growth badge: up, down, no change, or "New this period";
  - a "why it's trending" line written from those figures only.
- **Filters**: 7 or 30 days, and a category.
- **Market data**: for a category ZYRO has too little data on, the external Trend Scout report, badged **Market data** and labelled as not ZYRO sales, with its sources.
- **Not enough data yet**: the store's own categories that have neither ZYRO figures nor market data.
- **Add to my store** opens the Add Product form filled in:
  - **Name and description**: the product's name and a draft description.
  - **Category**: chosen when the store has it. When it doesn't, the form offers **Create "X"**, made only on a click.
  - **Price and stock** are left empty for the owner.

  Nothing is saved until the owner presses Save.
- **New-store onboarding**, for a store with no products or no categories:
  1. What does the shop sell? The owner chooses from what is trending, or types their own.
  2. The categories to create, through the categories module, only when the owner confirms.
  3. Starter products from the trends in those categories, each with "Add to my store".

  Any step can be skipped.
- **Who sees it**: the owner and Managers, through the Products permission. A Cashier sees no panel and the API refuses them.

## How the figures are made (`backend/src/modules/scout/`)

`scout.aggregate.ts` is pure functions, tested on their own.

- **Orders counted**: orders with status PAID, FULFILLED or COMPLETED. Pending, cancelled and refunded orders never count, and returned units are taken off.
- **Grouping**:
  - by **market** (the store currency), never mixing currencies;
  - then by normalized **category** ("Toys" and " toys" are one);
  - then by **product type**, which is a title's meaningful words: "Copper Kettle 1.5L" and "copper kettle" are both "copper kettle".
  - A product type is named from those words, never from any one store's title.
- **Figures**: units, distinct orders, distinct shops, and growth on the previous period of the same length (7 or 30 days).
- **Rankings**:
  - top sellers by units;
  - fastest growing, with at least 5 units;
  - rising, the top 3 per category.

### Privacy rules

1. **Minimum shops.** A figure is shown only if at least `SCOUT_MIN_STORES` (default 3) different shops sold it in that period.
2. **No dominant shop.** No single shop may have sold more than `SCOUT_MAX_STORE_SHARE` (default 0.6, so 60%) of its units.
3. **Both rules apply everywhere,** to every product type and every category, and separately to the current and the previous period. A previous period that fails them hides the growth, not the product.
4. **No subtraction.**
   - A category total is withheld when taking away the products shown in it would leave a part that fails rules 1 and 2.
   - A 30-day figure is withheld when the days before the 7-day figure (days 8 to 30, or 15 to 30 when the earlier week is shown too) would fail them.

   No figure can be taken away from another to reveal a few shops' sales.
5. **No identifiers.** The response never contains a shop id, name or slug, an order id, a product id, a customer, an email or a price.

The settings live in `backend/.env` and must stay within these bounds:

| Setting | Default | Range |
|---|---|---|
| `SCOUT_MIN_STORES` | 3 | 2 or more |
| `SCOUT_MAX_STORE_SHARE` | 0.6 | 0.3 to 0.95 |

## The daily run and the cache

`lib/productScoutQueue.ts` runs `scoutService.refresh()` every day at 04:30 UTC, and once at start-up when there is no snapshot yet. A platform administrator can also queue a run with `POST /platform/product-scout/refresh`.

For each scope, market and period, the run saves one `ProductScoutSnapshot` row: the anonymized figures, the AI's lines and the starter descriptions.

A store's page calls `GET /stores/{storeId}/product-scout?period=7|30&category=`. This only reads the saved row (plus a light read of market data), so **opening the panel never runs a heavy query or an AI call**. A test checks this.

## The AI layer

The AI runs in the daily job through the existing orchestrator, with `billedTo: "platform"`. It uses the fast model for two prompt types, `scout_explain` and `scout_starter`.

- **"Why it's trending"**:
  1. Each product becomes a numbered fact holding all its figures.
  2. The AI writes one line per fact, citing it, for example `[F1]`.
  3. Trend Scout's `checkLines` rejects a line with any number that isn't in the fact it cites.
  4. A rejected line is replaced by the fact itself.

  A test feeds it an invented number and confirms it is never saved.
- **Starter descriptions**:
  - The AI writes two general sentences per product type. Numbers aren't allowed.
  - Anything with a digit, too short or too long becomes a plain template instead.
  - They're a draft for the owner to edit, and never published by themselves.

## Demo stores

`npm run demo:scout:add` (in `backend/`) adds 6 demo stores in PKR with products and about 400 orders over 4 weeks, then builds the demo snapshot. `npm run demo:scout:remove` removes them all.

**Marking.** Every demo record is marked:
- store slugs start with `demo-scout-`, and nobody can register that prefix;
- store names start with `Demo: `;
- emails end in `@demo.zyro.local`;
- the stores are unlisted, with growth tips off.

**Kept apart from real figures.** Demo stores feed only the **demo** snapshot. They are left out of all of these:
- the **live** snapshot that real stores see;
- Trend Scout;
- the platform page's figures and store list;
- the Growth Advisor's weekly run;
- the shop directory.

Their orders are written straight to the database, so no usage counter moves. A demo store's own panel is marked **Demo data**.

**Safety checks.** The script refuses to run:
- when `NODE_ENV` is `production`;
- when either database isn't on this machine.

It counts real stores and users before and after each run, and stops if they change.

**The demo shows:**
- a product rising fast (Clay chai cup);
- a steady best seller (Lawn suit);
- a product new this week (Winter shawl);
- falling products;
- a kite sold by only 2 stores, which stays hidden;
- a brass lamp dominated by one store, which stays hidden too.

Sign in as `demo-scout-lahore-threads@demo.zyro.local` with the password `demo-pass-123`.

## The schema change

There is one new table, `ProductScoutSnapshot`, with a unique key on scope, market and period. It's platform data like `TrendReport`, so it has no `tenantId`.

- **Migration:** `20261022100000_product_scout_snapshot`.
- **Rollback:** `prisma/rollbacks/20261022100000_product_scout_snapshot.down.sql`. It drops the table and removes the migration from Prisma's history in one step, so `prisma migrate deploy` can apply it again. This round trip was checked on the dev database.

## Tests

| Suite | What it proves |
|---|---|
| `tests/unit/scout-aggregate.test.ts` (21) | Grouping, growth, new products, the 3-shop and 60% rules on products, categories and both periods, the subtraction checks, markets never mixed, the rankings, and no identifier or store title in the output. |
| `tests/integration/product-scout.test.ts` (21) | Seeded orders with a fake AI: the figures and growth; excluded statuses and returns; both privacy rules; no identifier anywhere in two stores' responses; an AI-invented number never saved; market data and empty categories; a page load makes no AI call and no recalculation; owner and Manager allowed, Cashier and other stores refused; the refresh is admin-only; demo stores kept out of the live figures, Trend Scout and the directory; the reserved prefix. |
| `frontend/e2e/product-scout.e2e.mjs` (21 checks) | The panel with real figures and no shop names; the hidden kite and lamp; both filters; collapsing; "Add to my store" prefilling, with nothing saved before Save; creating a missing category on click; onboarding a new store with confirmed steps; the Manager sees the panel and the Cashier doesn't. |

The integration tests use NPR, a currency no development store uses, so a test run never replaces a snapshot a real store reads. A dev backend running at the same time does its own daily or first run, which covers those test stores too.

## What it doesn't do

- **No opt-out.** Every store's paid orders count toward the totals. The Privacy Policy and the Terms say so, but there is no per-store switch.
- **Link previews.** Previews on WhatsApp and Facebook aren't affected, since the panel is inside the admin.
