# Phase 7: Consolidation Testing

Carried out 2026-10-07, on branch `feature/phase-7-testing`.

Per-phase testing was done as each phase was built. This phase adds the checks that only make sense
on the finished product: how it behaves under load, end to end, at scale, and under examination.

Everything below is a measurement taken on this machine (Windows 11, development laptop running
PostgreSQL 17, MongoDB 8.3.11, Redis and the application together), not an estimate.

---

## 1. Coverage report

Measured with `npx jest --coverage` over the whole suite.

| Metric | Covered | Total | Percentage |
|---|---|---|---|
| Statements | 5667 | 6133 | **92.40%** |
| Branches | 1905 | 2461 | **77.40%** |
| Functions | 1085 | 1152 | **94.18%** |
| Lines | 4977 | 5246 | **94.87%** |

Thresholds are now enforced in `jest.config.js` at 90 / 75 / 92 / 92. They are floors a little below
what the suite reaches, so that a change which quietly stops testing something fails the run, while
ordinary refactoring does not trip over an exact number. Coverage is collected from `src/` only; the
test helpers are not the product and counting them would flatter the figure.

### Where the uncovered code is, and why

| File | Statements | Why |
|---|---|---|
| `lib/stripe.ts` | 27.0% | The real Stripe gateway. Every test replaces it with a fake, deliberately: a suite that charged real cards would be unusable. Covered for real by `tests/real/`, run with `npm run test:real`. |
| `lib/aiProvider.ts` | 37.5% | The real Anthropic client, same reasoning. Also covered by `tests/real/`. |
| `lib/cartRecoveryQueue.ts` | 58.3% | Scheduling wrappers around BullMQ; the behaviour they schedule is tested, the scheduling glue is not. |
| `lib/recommendationClient.ts` | 64.8% | The HTTP client for the Python service. Its failure paths (service down, timeout) are partly exercised; the service itself has its own 20 pytest tests. |
| `modules/ideas/keywords.sources.ts` | 70.2% | The three keyword providers. The blending and the privacy rule are tested; some per-provider parsing branches are not. **The largest genuine gap, and the one worth closing first.** |

Branch coverage is the lowest of the four on purpose. Much of what is uncovered is defensive: the
`catch` that treats a Redis failure as a cache miss, a provider faked in every test. Those paths are
real and deliberate, and writing artificial tests to reach them would make the suite worse.

---

## 2. Golden path, end to end

`frontend/e2e/golden-path.e2e.mjs`, **26 checks, all passing.** One merchant, one run, entirely
through the real interface:

1. Sign up from the landing page.
2. Add a product, with the AI writing the listing and the merchant editing it.
3. A guest shopper buys it online, pays, and the order appears only after Stripe's signed webhook.
4. The sale reaches the merchant's order list.
5. The register opens a shift and sells one across the counter.
6. The online order is refunded, with the items put back in stock.
7. The merchant buys the Pro plan, and the larger AI allowance reaches the dashboard.

Each area has its own suite already. This one exists for what only breaks where the areas meet, and
the clearest evidence of that is the stock figure, read from the merchant's own screen at each step:

**10 to begin with, 9 after the website sold one, 8 after the counter sold one, 9 again after the
refund put one back.** One catalogue, one stock figure, two sales channels and a refund all agreeing.

Two other things the run proves rather than assumes: the amount charged is the server's figure (the
Pay button carries it), and the plan does not change when the shopper merely returns from the
payment page, only when the signed webhook arrives.

---

## 3. AI quota under load

`backend/tests/integration/quota-concurrency.test.ts`, **18 checks, all passing.**

A quota checked and then incremented as two statements is a textbook time-of-check to time-of-use
race. `reserveQuota` closes it with a single conditional `UPDATE ... WHERE used < limit`, relying on
Postgres holding the row lock for the statement.

**60 callers were fired at one quota row with `Promise.all`**, no staggering, against a Free plan's
allowance of 15 generations:

| Check | Result |
|---|---|
| Granted | exactly **15** |
| Refused | exactly **45** |
| Stored counter afterwards | exactly **15**, never 16 |
| A second stampede against the spent allowance | **0** granted |
| 5 bought top-up credits under 60 concurrent callers | exactly **5** spent, balance lands on **0**, never negative |
| Chat messages | exactly the chat limit, with the generation counter untouched |
| A neighbouring store | completely unaffected |
| The same race over real HTTP, through the queue and orchestrator | never more than the allowance; every success paid for; every non-success a 402 or a 503 |

### What the HTTP pass revealed about burst load

Running the same race through the whole stack (HTTP, the orchestrator, the BullMQ queue) found
something worth recording. When every request is fired at once, some AI jobs wait longer than the
orchestrator's patience and come back **503** rather than being served or refused on quota. On an
idle machine all of them are served; under load, some are shed.

That is the system shedding load rather than failing, and it is the honest behaviour to expect from a
queue. The quota invariant is untouched by it: the counter always equals the number of successes, and
never passes the allowance. So the HTTP pass asserts those two things, and the exact count is
asserted where the guard actually lives, against `reserveQuota` directly.

It is worth knowing for deployment: a burst of simultaneous AI requests degrades into queue waits and
eventual 503s rather than into overspending or data loss. A merchant sees "try again", not a wrong
bill.

### The test was verified to have teeth

A passing test proves nothing unless it fails when the thing it guards is broken. The guard was
temporarily replaced with the naive check-then-increment it exists to prevent, and the suite was
re-run:

> **41 of 60 callers were granted against a limit of 15.**

A store would have received 41 AI generations on a 15-generation plan. Ten checks failed. The real
implementation was then restored (verified byte-identical with `git diff`) and all 17 pass again.

That number, 41, is the measure of what this guard is worth.

---

## 4. Performance with a large catalogue

`backend/scripts/perf-large-catalogue.ts`, run with **5,000 products** (the Business plan's ceiling,
and the recommendation service's per-store cap). Each operation timed 12 times after a warm-up, in
process through the real Express app.

| Operation | Median | p95 | Worst | Budget |
|---|---|---|---|---|
| Storefront: first page of the catalogue | 23 ms | 29 | 29 | 800 |
| Storefront: page 50 of the catalogue | 27 ms | 44 | 44 | 800 |
| Storefront: search for a common word | 17 ms | 22 | 22 | 1500 |
| Storefront: search for a word in exactly one product | 12 ms | 14 | 14 | 1500 |
| Storefront: category list with counts | 11 ms | 12 | 12 | 1200 |
| Storefront: one product's page | 7 ms | 8 | 8 | 500 |
| Storefront: search suggestions as you type | 58 ms | 73 | 73 | 800 |
| Merchant: first page of the product list | 22 ms | 29 | 29 | 800 |
| Merchant: search the product list | 19 ms | 23 | 23 | 1200 |
| Merchant: the dashboard's analytics summary | 6 ms | 7 | 7 | 2000 |

**10 of 10 within budget.** The worst single measurement across the whole run was 73 ms.

Deep paging (page 50) costs no more than page 1, and a search for a word appearing in exactly one of
5,000 products is faster than a search for a common one, which is what a working text index should
look like. Inserting the 5,000 products took 726 ms.

The budgets are deliberately generous. They exist to catch something going badly wrong, such as an
index being dropped and a page becoming a collection scan, not to measure a production server.

---

## 5. Mobile responsiveness

The existing `responsive` sweep was extended with every screen built after 2026-09-26, which it
predated: the landing page (and its collapsed menu), the shop directory, the payments screen, voice
notes, the settings page with its new directory panel, and the Add product form both before and
after the AI suggestions panel is opened.

**65 checks across 32 screens at 375 px and 768 px, all passing, with no console errors.**

A page fails if the document is wider than the viewport, and when it fails the offending elements are
named so the fix is findable. Wide tables are allowed to scroll inside their own box; the page itself
is not.

Each part built since September also carries its own phone checks inside its own suite, so these
screens are covered twice.

---

## 6. Security review

### Dependency audit

| Component | Findings | Root advisories | Reachable by the running server |
|---|---|---|---|
| Backend | 37 | **3** | **None** |
| Frontend | 1 | 1 | **None** (`npm audit --omit=dev` reports zero) |
| Python service | 8 | 1 | **Fixed** |

The three backend advisories are `braces`, `deepmerge-ts` and `sprintf-js`, all stack-exhaustion or
unbounded-input denial of service, and all transitive through Jest, nyc and the Prisma CLI.

The decisive question is whether any of them ships. **`@prisma/client`, the only Prisma package in
`dependencies`, has no dependencies at all**; the vulnerable `deepmerge-ts` arrives through the
`prisma` CLI, which is a devDependency used for migrations. Nothing the running server loads is
affected.

**No fix was applied, deliberately.** The only upgrade path for the Prisma advisory is 6.19.3 to an
8.x *release candidate*, two major versions, for a denial of service in a command-line tool run by
the developer against their own schema. Breaking migrations before a demonstration to avoid a
theoretical stack overflow in a tool nobody attacks is the wrong trade. It is recorded here instead,
and should be revisited when Prisma 8 is stable.

The Python service's eight findings were all `setuptools` 65.5.0, the virtual environment's bundled
build tool rather than a declared dependency. **Upgraded to 84.0.0; `pip-audit` now reports no known
vulnerabilities and all 20 tests still pass.**

### Authorization, checked across the whole API

`role-enforcement` (108 tests) calls **every** operation the contract declares with no credentials
at all, and requires each to turn the caller away: the ~96 that need a token must answer 401 or 403,
and the 8 a guest session can satisfy must return nothing. It passes.

This replaced spot-checking, and it found a real documentation defect when first written: six of Part
E's shopper-facing endpoints were declared as needing a bearer token when they deliberately do not.
The contract was overstating its own protection, which is worse than understating it.

### Tenant isolation

Enforced in the data layer rather than per query. The Prisma extension refuses `findUnique`,
`update`, `delete` and `upsert` on tenant-scoped models outright, because a tenantId cannot be safely
merged into a unique-key lookup, and refuses any scoped query with no tenant context. A unit test
fails if a model with a `tenantId` column is not registered. MongoDB has a parallel plugin that
rejects a query with no `storeId` filter.

### Checked explicitly during this review

| Area | Finding |
|---|---|
| Cross-site scripting | No `dangerouslySetInnerHTML` or `innerHTML` anywhere in the frontend. React escapes by default. |
| SQL injection | No `$queryRawUnsafe` or `$executeRawUnsafe` in `src/`. Every raw query uses Prisma's tagged template, which parameterises. |
| Secrets in source | None. No key-shaped literals outside `process.env`; the three `.env.example` files contain only placeholders. |
| Secrets in git history | `git log -S` finds no live key. |
| Password storage | bcrypt, with the 72-byte truncation documented and the input length capped so it cannot be hit silently. |
| Session tokens | Refresh tokens are stored hashed, never raw. The cookie is `httpOnly`, `sameSite: lax`, and `secure` in production. |
| Transport and headers | `helmet` is applied, CORS is restricted to a configured origin with credentials. |
| Rate limiting | Applied to everything under `/api/v1`, with tighter limits on registration, login and refresh. Browser-verified in `phase1-security`. |
| File uploads | Restricted by MIME type and a 5 MB size limit, enforced before anything is written. |
| Logging | No password, token, key or email is written to a log. |
| AI cost exposure | The one public AI endpoint (the landing page demo) is capped per visitor and globally per day, pays from the platform rather than any store, and fails closed if Redis is unreachable. |
| AI authority | The bargaining assistant is never given the floor price and cannot write a number at all: it emits one word from six, and the server computes and clamps every price. Prompt injection cannot reach a price below the floor. |

### Findings worth fixing

1. ~~**The admin product list has no table semantics.**~~ **Fixed 2026-10-07.** It was a grid of
   `<div>` elements with a header row of `<div>`s: visually a table, but to a screen reader a flat
   run of text with no association between a cell and its column. Noticed here because the golden
   path could not select a row by role. It now carries `role="table"` and the matching row, header
   and cell roles, the layout is unchanged, and the golden path selects rows by role. See
   `Accessibility_Audit.md`.
2. **`keywords.sources.ts` is the thinnest-covered module that matters** (70.2%). It is new, it feeds
   the AI, and its per-provider parsing deserves direct tests.
3. **The Prisma CLI advisory stands**, as recorded above, pending a stable Prisma 8.

Neither of the first two blocks the gate. They are recorded so they are not quietly forgotten.

---

## 7. What this phase added to the repository

| Thing | Where |
|---|---|
| Coverage thresholds | `backend/jest.config.js` |
| AI quota concurrency suite | `backend/tests/integration/quota-concurrency.test.ts` |
| Golden path | `frontend/e2e/golden-path.e2e.mjs` |
| Large-catalogue performance check | `backend/scripts/perf-large-catalogue.ts` |
| Mobile sweep, extended | `frontend/e2e/responsive.e2e.mjs` |
| This report | `documentation/Phase7_Consolidation_Testing.md` |

## 8. Totals

| Suite | Result |
|---|---|
| Backend (Jest and Supertest) | **45 suites, 1725 tests, all passing** |
| Browser (Playwright) | 13 suites; golden path 26 checks, responsive sweep 65 checks, all passing |
| Python service (pytest) | 20 tests, all passing |
| Coverage | 92.40% statements, 94.87% lines, 94.18% functions, 77.40% branches |
| Dependency audit | 0 vulnerabilities reachable by the running server; Python service brought to 0 outright |
| Performance at 5,000 products | 10 of 10 operations within budget, worst case 73 ms |
