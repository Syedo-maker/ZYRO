# ZYRO

> **ZYRO** is a free-to-start, AI-native, multi-tenant commerce and point-of-sale platform for
> small businesses: an online store, a shop-floor register and the AI that runs alongside them, on
> one catalogue, one inventory and one set of orders.

## What it is

A merchant runs an online store and a shop-floor register from one catalogue, one inventory and one
set of orders, with AI built in: product descriptions, tags and SEO text, marketing copy, review
summaries, a shopping assistant, "products like this one", abandoned-cart emails, business insights,
a weekly growth tip, and title suggestions built on what shoppers really search for. Shoppers pay by
card, cash on delivery or bank transfer, and a receipt for a transfer is read by AI and accepted by a
person. Each store can have its own look, designed in the Theme Studio by hand or with an AI design
assistant, and published only when the owner is ready. Each store is isolated from every other store. Stores start free and can move to Pro or
Business (billed through Stripe); AI is capped per plan so its cost is known in advance.

Everything the AI writes is shown to the merchant first, AI never handles money, and every price and
plan comes from the server.

## Running it

**On a developer's machine** (fast reloads). Needs PostgreSQL, MongoDB and Redis running:

- `backend/`: copy `.env.example` to `.env`, `npx prisma migrate deploy`, `npm run dev` (port 5000).
- `frontend/`: `npm run dev` (port 5173).
- `recommendation-service/` (optional): see its README. Without it the store works and
  recommendations are simply empty.
- AI features (including the Theme Studio's design assistant) need `ANTHROPIC_API_KEY` in
  `backend/.env`; `npm run ai:check` in `backend/` says whether the key is accepted, without printing
  it. Without a key, everything else works and the AI features say they are unavailable.
- No Stripe or AI keys? `npx tsx scripts/e2e-server.ts` in `backend/` runs the API with fake
  payments and fake AI, so every screen can be tried.

**As it runs in production**, on one machine, with Docker:

```sh
docker compose up -d --build      # then open http://localhost:8080
node frontend/e2e/smoke.e2e.mjs   # the smoke test
docker compose down -v            # remove it, data included
```

The same four images, settings and topology as Azure (`compose.yaml`).

**On Azure**: nothing is deployed yet. `documentation/Deployment_Runbook.md` is the order of
operations, `.azure/deployment-plan.md` the decisions, `documentation/Azure_Cost_Estimate.md` the
cost.

## Repository layout

```
frontend/               React storefront, merchant dashboard and register; nginx config for production
backend/                Node/Express API and background worker: Prisma (PostgreSQL), Mongoose
                        (MongoDB), BullMQ; openapi.yaml is the API contract
recommendation-service/ Python/FastAPI: product embeddings, semantic search, speech to text
infra/                  Azure (Bicep): one environment per deployment; release scripts
.github/workflows/      CI on every push and pull request; releases to staging and production
documentation/          Architecture, decisions (adr/), runbooks, and a design document per module
design/                 Wireframes
```

## Tests

| What | How |
|---|---|
| Backend: 2,100+ tests on real PostgreSQL, MongoDB and Redis, with every response checked against `openapi.yaml` | `npm test` in `backend/` (add `AZURITE=1` with Azurite running for the Blob Storage suite) |
| Browser: each feature, accessibility | `node e2e/<suite>.e2e.mjs` in `frontend/`, with the e2e server and the frontend running |
| Smoke: the production images, assembled | `node frontend/e2e/smoke.e2e.mjs` with `docker compose up` |
| Python | `python -m pytest` in `recommendation-service/` |
| Load | `npx tsx scripts/load-test.ts` and `npx tsx scripts/load-ai.ts` in `backend/`, against `compose.loadtest.yaml` |

CI (`.github/workflows/ci.yml`) runs on every push and pull request: install, lint, type-check, build,
the backend suite with migration safety, schema drift and rollback checks, the frontend and Python
suites, the browser smoke tests (golden path, checkout, payments), `npm audit`, a gitleaks secret scan
over the whole history, and a build of every image. On `main`, `release.yml` builds and tags the
images with the commit, starts them and runs the smoke test; its deploy step is a commented template.

## Running it in production

Nothing is deployed yet. This is what the platform needs and gives an operator, whatever the host.

**Architecture.** Five processes, one image each except the worker:

| Process | Image | Job |
|---|---|---|
| web | `frontend/Dockerfile` (nginx, port 8080) | Serves the app; forwards `/api`, `/robots.txt` and `/sitemap.xml` to the API; sends link-preview apps on `/store/...` to the API's preview page |
| api | `backend/Dockerfile` (port 5000) | The HTTP API. Stateless: any number of copies behind the web container |
| worker | same image, `node dist/worker.js` (health on 5001) | Background jobs: AI, cart reminders, weekly tips, trends. Run one or more |
| recommendations | `recommendation-service/Dockerfile` (port 8001, internal) | Similar products, semantic search, speech to text. Optional |
| data | PostgreSQL 17, MongoDB 8, Redis 7 | Orders and accounts; catalogue and content; carts, queues, rate limits and caches |

Sessions, carts, rate limits and AI counters live in Redis and files in Blob Storage, so killing an API
copy loses nothing (tested with two copies, one killed under load).

**Settings.** Every variable is listed, with what it does and whether it is required, in each service's
`.env.example`; `config/environments/` has one example per environment. The API and the worker refuse
to start in production when a required one is missing, and say which. Never put a real value in a file
in the repository; a variable `NAME_FILE` reads the value from a mounted secret file instead.

| Service | Required in production | Optional (the feature is off without it) |
|---|---|---|
| api, worker | `DATABASE_URL`, `MONGODB_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET` (32+ characters), `CORS_ORIGIN`, `PUBLIC_URL`, `STORAGE_DRIVER=azure` with `AZURE_STORAGE_ACCOUNT_URL` or `AZURE_STORAGE_CONNECTION_STRING`. Strongly advised (a warning at start without it): `COD_PHONE_PEPPER` | `STOREFRONT_URL` (default `CORS_ORIGIN`). Card payments and plans: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. AI: `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`), `AI_DISABLED`, `AI_DAILY_STORE_LIMIT`, `AI_DAILY_GLOBAL_LIMIT`. Email: `EMAIL_PROVIDER` with SendGrid or Brevo settings. Recommendations: `RECOMMENDATION_SERVICE_URL`, `RECOMMENDATION_SERVICE_TOKEN`. Monitoring: `SENTRY_DSN`, `APP_RELEASE`, `METRICS_TOKEN`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `LOG_LEVEL` |
| web | `API_UPSTREAM` (for example `http://api:5000`) | `FILES_ORIGIN` (only when files are not served over HTTPS) |
| recommendations | `MONGODB_URI`, `RECOMMENDATION_SERVICE_TOKEN` | `RECO_MODEL`, `WHISPER_ENABLED` |

`npm run new-secret -- NAME` in `backend/` prints a fresh value for one of ZYRO's own secrets and what
changing it does.

**Docker.** `compose.yaml` runs the production images with their data services; `compose.dev.yaml`
the same stack with live reloading; `compose.loadtest.yaml` adds a second API copy for the load and
failover tests. Images are pinned to exact versions and run as non-root users.

**Migrations.** `npx prisma migrate deploy` in `backend/` (in production, as a one-off job before the
new API version starts). A migration that drops or changes data must say why (`-- destructive:`), and
every migration from November 2026 has a rollback in `backend/prisma/rollbacks/`. CI applies each
rollback and the migration again on a throwaway database.

**Backups.** `ops/backup.sh` dumps PostgreSQL and MongoDB with a checksummed manifest and keeps
`BACKUP_KEEP_DAYS` (default 14). `ops/restore.sh` checks the checksums and restores into the database
you name (`--yes-replace-target-data`); `ops/restore-check.sh` compares row and document counts with
the manifest. Run a restore drill into a scratch database every month. Uploaded files live in Blob
Storage; turn on its soft delete and versioning.

**Health.** `GET /health` (the process is up) and `GET /ready` (it can reach its databases; 503
while starting or shutting down) on the API, and the same on the worker's port 5001. The web
container answers `/healthz`. On shutdown the API stops taking requests, finishes those in flight,
and exits.

**Logs, errors and metrics.** Logs are JSON lines on stdout: one per request with its id, route,
status, time and store, never a password, token, query string or IP address. Errors go to a
Sentry-compatible service when `SENTRY_DSN` is set, without request bodies or personal data.
`GET /metrics` (Prometheus format, on the API and the worker's health port; production needs
`Authorization: Bearer $METRICS_TOKEN`) has `zyro_http_requests_total`,
`zyro_http_request_duration_seconds`, `zyro_external_calls_total`, `zyro_circuit_open`,
`zyro_queue_jobs`, `zyro_ai_requests_total` and `zyro_ai_daily_requests`.

**Alerts** to set up in the monitoring tool:

| Alert | Condition | Severity |
|---|---|---|
| Site down | `/ready` failing on every API copy for 2 minutes | page someone |
| Errors | 5xx above 2% of requests for 5 minutes | page someone |
| Slow | p95 of `zyro_http_request_duration_seconds` above 1.5 s for 10 minutes | warn |
| Outside service down | `zyro_circuit_open` is 1 for 5 minutes (Stripe, email, AI, storage, recommendations) | warn |
| Jobs stuck | `zyro_queue_jobs{state="waiting"}` growing for 15 minutes, or `{state="failed"}` rising | warn |
| AI spend | `zyro_ai_daily_requests` above 80% of the daily limit (also logged) | warn |
| Backups | no successful `ops/backup.sh` in 26 hours | page someone |
| Database | connections above 80% of the limit, or storage above 80% | warn |
| New error | a new issue in error tracking | warn |

**Day-to-day scripts** in `backend/` (each asks for confirmation before changing anything that cannot be undone):
`npm run super-admin`, `npm run queues` (list, retry or clean failed jobs), `npm run store-data`
(export, clear-cache or delete a store), `npm run customer-data` (export or erase one person's data),
`npm run retention` (removes expired sessions and reset links; run daily), `npm run new-secret`.

## Documentation

| | |
|---|---|
| `documentation/Architecture.md` | How the parts fit together |
| `documentation/adr/` | The decisions that shaped it, and why |
| `documentation/Production_Readiness.md` | The production-readiness programme, phase by phase, with each gate's evidence |
| `documentation/Production_Readiness_Report_2026-11.md` | The November 2026 readiness review: what was verified, what you must do, what needs a decision |
| `documentation/Deployment_Runbook.md` | Getting it onto Azure |
| `documentation/Operations_Runbook.md` | Running it: monitoring, alerts, incidents, rollback, secrets |
| `documentation/Privacy_Notes.md` | The detail behind the Privacy Policy |
| `documentation/Product_Scout.md` | Product Scout: trending products for owners, its privacy rules, and the demo stores |
| `documentation/Store_Themes.md` | Store Themes and the Theme Studio: the AI design assistant, the theme schema, contrast rules, endpoints, permissions, drafts and versions, tests |
| `scripts/demo-videos/README.md` | The walkthrough videos (Owner, Manager, Cashier, Customer): how to film them again from the running app |
| `documentation/Implementation_Plan.md` | The original plan, and the record of what was built |

The Terms of Service and the Privacy Policy are pages in the app (`/terms`, `/privacy`).

## Tech stack

React · TypeScript · Tailwind CSS · Node.js/Express · PostgreSQL (Prisma) · MongoDB (Mongoose) ·
Redis + BullMQ · Stripe (Checkout and Billing) · Anthropic Claude API · Python + FastAPI · Docker ·
Azure Container Apps · Bicep · GitHub Actions

## Project

Built as a Final Year Project at Shifa Tameer-e-Millat University, where it is registered under the
academic title **ShopMind AI**.

- **Muhammad Ibrahim**, BSAI-23F-0048
- **Syed Sikander Gillani**, BSAI-23F-0062
- **Supervisor:** Mr. Saad Ilyas
- Bachelor of Science in Artificial Intelligence
