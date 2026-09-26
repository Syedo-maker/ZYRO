# Phase Gates: A Phased Checklist With a Mandatory Test Before Every Next Phase

Written 2026-09-26. **The rule: no phase begins until the previous phase has been fully tested and approved.** A phase is finished only when its gate is passed and you have signed it off. "Almost passing" is not passing.

This replaces the earlier idea of leaving most testing to a final Phase 7. Testing now happens at the end of every phase. Phase 7 keeps only the work that needs the whole system built (see the end).

## How a gate works

1. Build the phase.
2. Run the **gate**: the common checks below, plus the phase's own tests.
3. If anything fails, fix it and **run the whole gate again**. A partial pass does not count.
4. Show the results and do a short walkthrough. You approve, or send it back.
5. Only then does the next phase start. Approval is recorded in the phase's sign-off line.

### The common gate (every phase, no exceptions)

| # | Check | How it is checked |
|---|---|---|
| G1 | **It builds** | Backend `npx tsc --noEmit`, frontend `npx tsc -b` and `npm run build`, and `npx prisma migrate deploy` on an empty database, all with no errors |
| G2 | **Nothing older broke** | Every earlier phase's tests are run again and all pass |
| G3 | **The phase's own tests pass** | The list under each phase below |
| G4 | **Tenant isolation** | For every new table or endpoint: a test that store B cannot read, change or even detect store A's data (a 404 or 403, never the data) |
| G5 | **Permissions and input** | For every new endpoint: no token gives 401, the wrong role gives 403, bad input gives 400, and the right person can do it |
| G6 | **A human walkthrough** | Someone clicks through the phase's screens in a real browser, at desktop width and at 375 px phone width, with no console errors |
| G7 | **Documents match the code** | The phase document exists, the plan checklist is ticked, `openapi.yaml` lints with no errors, `.env.example` lists any new setting, `SCOPE_UPDATES.md` is updated, no em dash anywhere |
| G8 | **No secrets, no leftovers** | Nothing secret in the commit, no throwaway test data left in the database, no temporary files committed |
| G9 | **Sign-off** | The approval line at the end of the phase is filled in |

Extra rules for AI phases: no customer personal data in any prompt; AI output is never trusted for a price, amount or plan; a failed AI call costs no quota; the feature still works (or fails politely) with no AI key.

Extra rules for payment phases: an amount or plan changes only from a verified webhook; the same event delivered twice changes nothing more; a wrong amount is refused.

**Test commands** (see `backend/tests/README.md`):
- backend = `npm test` in `backend/` (Jest and Supertest against the real Postgres, MongoDB and Redis; `npm test -- <name>` runs one suite, for example `npm test -- billing`);
- real services = `npm run test:real` in `backend/` (the real Anthropic API and Stripe test mode; needs the keys in `backend/.env`);
- browser = `node e2e/<suite>.e2e.mjs` in `frontend/` (needs `npx tsx scripts/e2e-server.ts` in `backend/` and `npm run dev` in `frontend/`);
- python = `.\.venv\Scripts\python.exe -m pytest` in `recommendation-service/`.
A suite name like `phase1` below means `backend/tests/integration/phase1.test.ts`.

---

## Where things stand today (2026-09-26)

Phases 0 to 6 and Part A are built and their tests pass. On 2026-09-26 the gaps first listed here were closed, on your instruction that there be none:

| Gap | Now |
|---|---|
| Backend tests were scripts, not Jest | All 16 suites moved to Jest and Supertest (every check kept, one Jest test each); 36 more unit tests; 1,002 backend tests in all |
| Part A's tests were throwaway | Committed: `billing` (50) and `partA-billing` in the browser (17) |
| No phone or tablet walkthrough | `responsive` browser suite: every storefront, admin and register screen at 375 px and 768 px. It found and fixed real faults (Products and Marketing pages scrolled sideways on a phone) |
| No screen to endpoint table | `documentation/Phase0_Traceability.md`, checked by `contract` and `contract-routes`. They found a promised endpoint the server never had (removed from the contract) and a wireframe card never built (cart-recovery performance, now built, with sales by category) |
| Migrations on an empty database, tenant scoping of every table | Now automated: `migrations`, `tenant-scope` |
| Real Stripe never run | Suite written (`npm run test:real -- stripe-billing`). **Blocked:** the sandbox key expired on 2026-09-26. Needs a new test key |
| Real Anthropic API never run | Suite written (`npm run test:real -- anthropic`). **Blocked:** no key yet |

The last two need something only you can provide. Every other gap is closed. After that, the gates wait for your sign-off.

---

## Phase 0: Analysis and design

**Build:** database schema (Prisma and Mongoose), wireframes for every screen, the API contract.

**Tests that must pass**
- `prisma validate` passes, and `prisma migrate deploy` on an empty database creates every table.
- `openapi.yaml` lints with 0 errors.
- Every wireframe screen maps to at least one endpoint in the contract (a written traceability table).
- Every table with a store's data has a `tenantId` and is in the tenant-scoped list.

**Done when:** all four pass, and the schema was reviewed against the multi-tenancy rule.

**Tests:** `migrations` (a fresh schema gets every table), `tenant-scope` (every table with a `tenantId` is scoped), `contract` and `contract-routes` (the table, the contract and the server agree), `openapi.yaml` lint 0 errors.
**Status today:** all pass. No gaps.
**Sign-off:** approved by ______ on ______

## Phase 1: Foundation (authentication, multi-tenancy, catalog)

**Build:** register and log in, refresh and log out, store and staff, permissions, product create and edit, image upload, admin UI.

**Tests that must pass**
- `phase1` (80 checks), `security` (34 checks), browser `phase1-auth-catalog` (24 checks), and the phase's screens in `responsive`.
- Specifically: wrong password refused; expired and revoked tokens refused; login and registration rate limits; a staff member without a permission gets 403; store B cannot read or edit store A's products (404); only JPEG, PNG or WebP under 5 MB accepted; no password or token ever returned.

**Done when:** all pass, and a person can register, add a product with a picture and see it, with no console errors.

**Status today:** all pass. No gaps.
**Sign-off:** approved by ______ on ______

## Phase 2: Commerce core, cart and checkout, orders and shipping

**Build:** inventory in Postgres, customers, cart (Redis), Stripe checkout, orders, shipping zones, cancellations and refunds, storefront and admin orders UI.

**Tests that must pass**
- `commerce-core` (21), `checkout` (62), `orders` (63), `customers` (30), browser `phase2-checkout` (49), and the storefront screens in `responsive`.
- Specifically: two shoppers cannot buy the last unit; the same webhook twice makes one order; a wrong charged amount is refused; an out-of-stock payment is refunded automatically; a refund returns stock and money; the cart never shows a stale price.

**Done when:** all pass, and a shopper can buy, the merchant can ship and refund.

**Status today:** all pass with Stripe faked. **Blocked:** the real-Stripe runs (browser `stripe-real`, 22 checks, and `npm run test:real -- stripe-billing`) need a new Stripe test key; the old sandbox expired on 2026-09-26.
**Sign-off:** approved by ______ on ______

## Phase 2.5: Point of sale

**Build:** register screen, barcode and search, split cash and card payments, shifts and cash drawer, held sales, receipts, returns, daily summary, team page.

**Tests that must pass**
- `pos` (119 tests covering 120 checks), browser `phase2_5-pos` (70), and the register screens in `responsive` at phone and tablet width.
- Specifically: a cashier cannot exceed the discount limit; change is exact; a return puts stock back and takes cash from the drawer; a cashier with no register permission is turned away; POS and online sales share one inventory.

**Done when:** all pass, and a shift can be opened, sales made, and the shift closed with a correct drawer count.

**Status today:** all pass. No gaps.
**Sign-off:** approved by ______ on ______

## Phase 3: Commerce completeness (discounts, search, reviews, analytics, staff, storefront)

**Build:** discount codes, search and reviews, analytics dashboard, staff accounts, customer accounts, storefront and admin dashboard.

**Tests that must pass**
- `discounts` (108), `search-reviews` (86), `analytics` (49), `customers` (30), browser `phase3-storefront-admin` (93).
- Specifically: a code with a usage limit cannot be over-used by simultaneous checkouts; a verified-purchase review needs a real order; analytics equals hand-computed figures; refunds count in the period they are paid.

**Done when:** all pass, and the dashboard figures match the orders.

**Status today:** all pass. No gaps. (The Marketing page now also shows cart-recovery performance and sales by category, as its wireframe does.)
**Sign-off:** approved by ______ on ______

## Phase 4: AI orchestrator and content tools

**Build:** orchestrator (queue, quota), descriptions, review summary, tags, SEO text, marketing copy, quota meter.

**Tests that must pass**
- `ai` (16), `ai-content` (52), unit `aiModels` (12), browser `phase4-ai-content` (27).
- Specifically: quota is reserved atomically (no two calls slip past the limit); a failed call gives the quota back; an unparsable AI reply is a clean error; a suggestion is never saved without the merchant; with no key the feature answers 503, not a crash.

**Done when:** all pass.

**Status today:** all pass with a fake AI. **Blocked:** the real Anthropic API has never been called; `npm run test:real -- anthropic` is written and waits for a key.
**Sign-off:** approved by ______ on ______

## Phase 5: Assistant, cart recovery, insights

**Build:** shopping assistant, abandoned-cart recovery, business insights, chat widget.

**Tests that must pass**
- `assistant` (20), `cart-recovery` (17), `insights` (16), browser `phase5-assistant` (10).
- Specifically: the assistant never suggests another store's product; chat has its own quota; a recovery email is sent once per cooldown; insights never show a number the database did not produce.

**Done when:** all pass.

**Status today:** all pass with a fake AI and fake email. **Blocked:** real AI (same key as Phase 4). Real email needs a SendGrid key; until then the recovery job logs what it would have sent, as designed.
**Sign-off:** approved by ______ on ______

## Phase 6: Recommendation service (Python)

**Build:** FastAPI service, embeddings, similar-product endpoint, assistant upgrade, storefront rows.

**Tests that must pass**
- python `pytest` (14), `recommendations` (31), browser `phase6-recommendations` (14).
- Specifically: recommendations never include the product itself, sold-out products or another store's products; the service down means an empty list, not an error; a wrong token is refused.

**Done when:** all pass, and the real model has been tried once by hand.

**Status today:** passing; the real model was tried. **Open item:** AI product photo editing (stretch) is not built.
**Sign-off:** approved by ______ on ______

## Part A: Revenue model (plans, billing, AI top-ups, cost controls, platform view)

**Build:** Free, Pro, Business; billing through Stripe; limits; top-up packs; cost controls; platform view.

**Tests that must pass**
- The whole earlier regression, plus these new checks (they exist as throwaway scripts today and must become committed tests): plan limits refuse with an upgrade hint; the price sent to Stripe is the server's; a wrong amount changes nothing; the same event twice credits once; an old subscription's late event is ignored; a lapsed plan falls to Free with no webhook; credits are spent after the allowance and returned on failure; an ordinary owner gets 403 on the platform routes and the platform view shows no emails.

**Done when:** all pass, **and** billing has run once against a real Stripe sandbox.

**Status today:** all pass; committed as `billing` (50), unit `plans` (14) and browser `partA-billing` (17). **Blocked:** real Stripe and real AI, as above.
**Sign-off:** approved by ______ on ______

---

## Parts still to build (each has its gate written now, before it starts)

*From Part B on, every part's tests are written in Jest and Supertest as it is built, and committed with it.*

### Part B: Usage counters
- **Build:** order and sales counters updated when an order completes; AI usage per store per month; the platform view reads them.
- **Tests:** an order (online or POS) increments exactly once; a refund is handled as decided; two simultaneous orders count as two; a cancelled or unpaid order does not count; counters equal a fresh recount from the orders table; store B's counters never change from store A's sales.
- **Done when:** counters match a full recount on a database with mixed orders, and the platform view matches.

### Part C: AI Growth Advisor
- **Build:** weekly job with cheap rules, then one AI message only when a rule fires; dashboard card; merchants can turn it off.
- **Tests:** each rule fires on hand-made data and not on data that misses it; no AI call when no rule fires; the message is built from totals only (a test that no order, customer or product text is in the prompt); at most one per store per week; off means none; a store's tip never uses another store's numbers; the platform pays (its quota is not used).
- **Done when:** a week of fake time produces the expected messages, and the AI is never handed personal data.

### Part D: AI Trend Scout
- **Build:** weekly per-category reports from platform data and a trends source, shown as a dashboard card.
- **Tests:** platform data is anonymised (no single store can be identified, and a category with too few stores is suppressed); every claim in a report carries a source and a date; the prompt forbids inventing trends and a test feeds it empty data and gets "no data", not invented trends; one report per category per week is shared; the data source can be swapped without touching the rest.
- **Done when:** a report can be traced line by line to its input data.

### Part E: AI Payment and Trust
- **Build:** Cash on Delivery, payment adapter for local gateways, manual transfer with a screenshot, COD risk score, screenshot verifier, courier reconciliation, payment nudge, payment error helper.
- **Tests:** COD orders follow the same stock and order rules; the risk score is explainable and uses only the allowed inputs; only a risk level (never a store or an order) is shared across stores; the AI flags but never approves, refunds or changes an amount; a reused transaction id is caught; a wrong amount in a screenshot is flagged; a reconciliation run matches hand-made courier files exactly; a card number never reaches our server or an AI prompt; each gateway adapter passes the same contract test.
- **Done when:** the money paths are tested end to end with the real provider's test mode, not only fakes.

### Part F: Search
- **Build:** keep keyword search independent of AI; optional semantic search.
- **Tests:** keyword search works with no AI key and no quota; results never cross stores; semantic search (if built) returns nothing outside the store and degrades to keyword search when the service is down.

### Part G (stretch): voice-note manager, bargaining assistant, festival planner
- **Tests (if built):** the bargaining assistant can never quote below the merchant's minimum, whatever the customer types (prompt-injection attempts included) and the final price is created on the server; a voice note only ever makes a draft the merchant must confirm.

Each of B to G also has to pass G1 to G9.

---

## Phase 7: Consolidation testing (what needs the whole system)

Per-phase tests are done by now. This phase adds what only makes sense on the finished product:
- A **coverage report** for the Jest suites (the move to Jest and Supertest was done on 2026-09-26).
- **One golden-path test** in Playwright: sign up, add a product, sell online, sell at the register, refund, buy a plan.
- **AI quota load test**: many simultaneous calls never exceed the limit.
- **Mobile responsiveness** of any screen added after 2026-09-26 (every earlier screen is covered by the `responsive` browser suite).
- **Security review** of the whole system, and a dependency audit.
- Performance check on a store with thousands of products.

**Done when:** all pass and the numbers are written into the report.
**Sign-off:** approved by ______ on ______

## Phase 8: Deployment and documentation

- **Build:** Docker Compose for the whole stack, environment and secrets setup, final documentation, Gantt chart, Turnitin report.
- **Tests:** on a clean machine, `docker compose up` brings up the full stack with no manual fixes; a fresh database migrates; a smoke test (register, add product, buy) passes; backup and restore works; no secret in the repository history; every document is current.
- **Done when:** someone who did not build it can start it from the README alone.
**Sign-off:** approved by ______ on ______

---

## Decisions

1. **Baseline sign-off.** Your answer (2026-09-26): no gaps. Every gap is closed except real Stripe and real AI, which wait for keys only you can provide. Once those two pass, Phases 0 to 6 and Part A are ready for your sign-off.
2. **Test style from Part B on.** Your answer: as recommended, Jest and Supertest from the start, committed with each part.
3. **Who approves.** Not answered; taken as you, until you say otherwise.
