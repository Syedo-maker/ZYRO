# Part D: AI Trend Scout

Status: built and tested. 34 unit tests (`trends`), 23 end-to-end tests (`trends`) and 15 browser checks (`partD-trends`); the full gate is listed at the end.

`find-skill`: nothing to install. `bullmq-specialist` (weekly job), `database-schema-designer` (the two tables), `claude-api` (the report) and `frontend-ui-engineering` (the card and panel) were already installed. The search found an "anti-hallucinate" skill (about stopping Claude itself from guessing while coding, and it edits the global settings file) and a "privacy checker" (for synthetic datasets, 0 stars); neither fits a product feature that must ground reports in data and anonymise sales across stores.

## What it does

Once a week, every store gets a short market report for its main categories, shared by every store selling in them:

> In the PKR market, home and kitchen products sold 184 units in the week 21 Sept to 27 Sept 2026 across 10 to 24 stores, up 32% on the weekly average of the 4 weeks before (139). [1]
> Products with "clay" or "handi" in the title sold 41 units that week, up 64% on their weekly average (25). [2]
> Google Trends (Pakistan): search interest in "chai cup" averaged 62 out of 100 from 31 Aug to 21 Sept 2026, up 35% on the 12 readings before. [3]

Every line carries the number of the source it rests on, and the sources are listed under the report with their dates.

## The approach, and why

**Numbers are computed and anonymised by code; the AI only rewords numbered facts; its answer is checked line by line.**

1. **Platform data** (the main source). A weekly job (Mondays 05:00 UTC, an hour before the Growth Advisor) adds up, across all stores, the units sold last week and in the 4 weeks before, per **market and category**.
2. **External data**, behind a swappable adapter (`trends.sources.ts`). The first source is **Google Trends files imported by the platform administrator**.
3. **The report.** The facts are numbered (F1, F2...), each with its source and date. The AI must write 2 to 4 lines, each ending with the ids of the facts it used. The server then checks every line.

### Why the market is the currency

Since the store-currency change, stores sell in different currencies. Adding rupee and pound sales is meaningless, and a trend in the UK says little about Pakistan. So a report is per currency (PKR, GBP...) and category, and it reports **units and percentage changes, never money summed across stores**.

### Why Google Trends is imported, not fetched

Google Trends has no self-serve API: the official one is an invite-only alpha with no published pricing (checked 2026-09-30). The paid "Google Trends APIs" are scraping services, and the plan rules out scraping (no Daraz, no TikTok). So the administrator uses Google's own download button on trends.google.com ("Interest over time", CSV) and imports the file. If API access is granted later, a new source slots into the same adapter; nothing else changes (a test proves the swap).

## Privacy: anonymised, or not published

Platform figures come from every store's sales, so they must never reveal one store:

| Rule | Why |
|---|---|
| A figure needs **at least 5 stores** with sales, in the week reported **and** in the 4 weeks before | A number from 1 or 2 stores is just those stores' sales. Both periods, because the change is computed from both |
| **No store may make up more than 60%** of a figure, in either period | "5 stores" where one sold 95% of the units still describes that one store (the dominance rule used in official statistics) |
| Title keywords follow **the same two rules, per keyword** | A word only one store uses would point straight at its product |
| Merchants see a **band** ("5 or more stores", "10 to 24", "25 or more"), never the exact count | An exact count, week after week, could hint at who joined or left |
| No store id, name, product id or customer ever leaves the aggregation or reaches the AI | Tested: the AI prompt and the merchant's response are checked for other stores' ids, names and emails |

When a category fails a rule, its store figures are **withheld** (zeroed in code, so nothing downstream can show them) and the merchant sees "Not enough stores sell in this category yet for a report that keeps every store anonymous." Both thresholds can be tuned (`TREND_MIN_STORES`, `TREND_MAX_STORE_SHARE`) but not below 2 stores or above 95%.

## No invented trends

| Guard | How |
|---|---|
| The AI never sees raw data | Only the numbered fact sentences the server wrote |
| The prompt forbids adding anything | No trend, cause, prediction, advice, product, place or number that is not in the facts; "NO_DATA" if there are none |
| Every line must cite facts that exist | A line with no `[F..]`, or citing an id that does not exist, fails the check |
| Every number must come from the facts it cites | "up 90%" citing a fact that says 50% fails; so does a number taken from a fact the line does not cite |
| One failed line throws the whole answer away | The report is then the facts themselves, one per line (`source: template`); the AI provider being down gives the same |
| No facts, no AI call | Status `no_data` or `suppressed`, written by code |

What the check cannot catch: invented wording without a number (for example "because of Eid"). The prompt forbids it, and the numbered sources let a reader see that no fact says so. This is stated honestly rather than claimed away.

**Traceability:** each stored report keeps its facts and, for every line, the ids it cites, so any line can be traced back to its source and date (the part's "done when").

## One report per category per week, shared

A unique key on (market, category, week) keeps exactly one report; running the week again, or two runs at once, changes nothing and costs nothing (tested). Every store in the category reads the same report. The AI is called at most once per market and category per week, on the better model (the strict format needs it), and the **platform pays**, never the store's allowance.

## What the merchant sees

A "Market trends" card on the dashboard, for the owner and staff with the analytics permission: up to 3 of the store's categories (those it has most products in), each with the latest report, source numbers on every line and a "Sources" list with dates and a link to Google Trends where there is one. Before the first Monday run it says "The first report arrives on Monday."

## What the administrator sees

A "Trend Scout" panel on the platform page: import a Google Trends file (market, category, CSV), "Run this week now", the week's reports for every market with status and exact store count, and the recent imports. The file reader refuses anything that is not a Google Trends export, with the reason.

## API

- `GET /stores/{storeId}/trends` (owner, or staff with `analytics_read`)
- `GET /platform/trends`, `GET /platform/trends/imports`, `POST /platform/trends/imports`, `POST /platform/trends/run` (super administrators)

Tables: `TrendReport` (unique market, category, week; facts and lines as JSON) and `TrendSignalImport`. Migration `20260930000000_trend_scout`. Neither has a `tenantId`: they hold platform data, never one store's.

## Tests

- `trends` (unit, 34): category names and keywords; the 5-store and 60% rules; both periods; markets never mixed; no store ids in the output; the store band; the Google Trends reader (both export styles, monthly data, "<1", and five kinds of bad file); the end-of-series movement; numbered facts with source and date; a withheld category giving no platform facts; keywords merged when they move together; the line check accepting good lines and rejecting six kinds of bad answer; the template always passing.
- `trends` (end to end, 23): six stores typing the category three ways become one; 18 units, up 50%; every line cites real facts; the AI gets totals only and the withheld category costs no call; one report per week, even with two runs at once; an invented number and the AI being down both give the template; no facts gives "no data" with no AI call; a swapped source and a failing source; imports by the administrator (and refused for merchants, bad files and unknown markets); a report from Google Trends alone with its URL; the administrator's list with store counts; what merchants see (shared report, no store count, no other store's name, 401 and 403).
- `partD-trends` (browser, 15): the card on a kitchen store's dashboard with the 15-unit, +200% report, the store band, source numbers on every line and the sources list; the garden store told its category is withheld; a cashier never sees the card; the administrator's panel listing the week and importing a Google Trends file, and refusing a wrong file; phone width.

The test stores sell in **XTS**, the currency code reserved for testing, so tests never touch real stores' reports, and every test run is limited to the test's own stores.

## Deliberate limits

- **No live web search.** The plan allows an optional web search with sources; it is left out because search results cannot be checked number by number the way the facts are. It can be added as another source behind the adapter.
- **One outside source today** (imported Google Trends files). The Python service is not used: the aggregation is a few SQL sums, and keeping it in the backend reuses the orchestrator, the queue and the tests.
- **Categories are free text**, normalised (case, spacing, "&") but not mapped: "kitchen" and "home and kitchen" stay two categories. A shared category list would fix it and is a product decision.
- **Not merged with the Growth Advisor.** They share the weekly pattern and the platform-paid AI; merging them into "Merchant Intelligence" is possible later without changing either.

## Full gate (2026-09-30)

| Suite | Result |
|---|---|
| Backend (Jest and Supertest, `npm test`) | 31 suites, 1,171 tests pass (1,109 before Part D) |
| Python recommendation service (pytest) | 14 pass |
| Browser suites with the test server | 13 of 13 pass, including `partD-trends` (15) and `phase1-security` with rate limiting on |
| API contract | valid (`redocly lint`), and every new operation is in `Phase0_Traceability.md` (checked by `contract`) |
| Leftovers | none: test data cleaned, no trend reports written for real stores |
