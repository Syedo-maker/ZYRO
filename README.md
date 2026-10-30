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
person. Each store is isolated from every other store. Stores start free and can move to Pro or
Business (billed through Stripe); AI is capped per plan so its cost is known in advance.

Everything the AI writes is shown to the merchant first, AI never handles money, and every price and
plan comes from the server.

## Running it

**On a developer's machine** (fast reloads). On Windows, once everything below is set up, one
command starts it all and prints the links:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1        # -Stop stops it all
```

- The script starts Redis, the API, the web app, the recommendation service and the Stripe
  forwarder; anything already running is left alone.
- It reads the keys from `backend/.env` without printing them.

Step by step instead. Needs PostgreSQL, MongoDB and Redis running:

- `backend/`: copy `.env.example` to `.env`, `npx prisma migrate deploy`, `npm run dev` (port 5000).
- `frontend/`: `npm run dev` (port 5173).
- `recommendation-service/` (optional): see its README. Without it the store works and
  recommendations are simply empty.
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
| Backend: 1,700+ tests on real PostgreSQL, MongoDB and Redis, with every response checked against `openapi.yaml` | `npm test` in `backend/` (add `AZURITE=1` with Azurite running for the Blob Storage suite) |
| Browser: each feature, accessibility | `node e2e/<suite>.e2e.mjs` in `frontend/`, with the e2e server and the frontend running |
| Smoke: the production images, assembled | `node frontend/e2e/smoke.e2e.mjs` with `docker compose up` |
| Python | `python -m pytest` in `recommendation-service/` |

CI (`.github/workflows/ci.yml`) runs the backend, frontend and Python suites and builds every image on
every push and pull request.

## Documentation

| | |
|---|---|
| `documentation/Architecture.md` | How the parts fit together |
| `documentation/adr/` | The decisions that shaped it, and why |
| `documentation/Production_Readiness.md` | The production-readiness programme, phase by phase, with each gate's evidence |
| `documentation/Deployment_Runbook.md` | Getting it onto Azure |
| `documentation/Operations_Runbook.md` | Running it: monitoring, alerts, incidents, rollback, secrets |
| `documentation/Privacy_Notes.md` | The detail behind the Privacy Policy |
| `documentation/Product_Scout.md` | Product Scout: trending products for owners, its privacy rules, and the demo stores |
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
