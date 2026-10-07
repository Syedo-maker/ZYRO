# ZYRO

> **ZYRO is the product name for ShopMind AI**, a free-to-start, AI-native, multi-tenant
> Commerce and point-of-sale platform for small businesses, developed as a Final Year Project at
> Shifa Tameer-e-Millat University. This repository is where all implementation work for the
> project lives.

## Project

- **Muhammad Ibrahim**, BSAI-23F-0048
- **Syed Sikander Gillani**, BSAI-23F-0062
- **Supervisor:** Mr. Saad Ilyas
- Bachelor of Science in Artificial Intelligence

## What this is

ZYRO lets a merchant run an online store and a shop-floor register from one catalog, one
inventory and one set of orders, with AI built in: product descriptions, tags and SEO text,
marketing copy, review summaries, a shopping assistant, "products like this one", abandoned-cart
emails, business insights, and title and description suggestions built around what shoppers really
search for. Each store is isolated from every other store. Stores start on a
free plan and can move to Pro or Business (billed through Stripe); AI is capped per plan so its
cost is known in advance.

The front door is a homepage explaining the product, with a working demonstration of the trending
suggestions in its hero: type a product and see what the AI would write for it. The demo is capped
so a visitor can never spend a merchant's AI allowance.

From there a visitor chooses to shop or to open a store, and sees only that
side: shoppers get a public shop directory, storefronts, baskets and order tracking, while owners get
the dashboard, catalogue and AI tools. Nobody is a "shopper" or an "owner" in their login token,
because one person can own one shop and buy from another; the server works out what they may do per
request and per shop, so hiding a menu is never what protects a shop's data.

Everything the AI writes is shown to the merchant first, AI never handles money, and every price
and plan comes from the server. See `documentation/` for the scope, the plan and a design
document for each module.

## Repository layout

```
documentation/          Implementation plan, scope updates, and a design document per module
backend/                Node.js/Express API: Prisma (PostgreSQL) and Mongoose (MongoDB),
                        AI orchestrator, billing, POS; openapi.yaml is the API contract
frontend/               React storefront, admin dashboard and POS register
recommendation-service/ Python/FastAPI service: product embeddings and similar-product search
design/                 Wireframes
```

## Development process

Work follows `documentation/Implementation_Plan.md` (its checklist is the record of what is
built). Phases 0 to 6 and Part A of the 2026-09-26 roadmap are complete; testing (Phase 7) and
deployment (Phase 8) come last. Parts of the roadmap are built on their own branch and merged
by pull request; nothing is committed that holds a secret (`.env` files are ignored).
`documentation/SCOPE_UPDATES.md` tracks what has changed from the original scope document.

## Running it locally

Needs PostgreSQL, MongoDB and Redis running; then:

- `backend/`: copy `.env.example` to `.env`, `npx prisma migrate deploy`, `npm run dev` (port 5000).
- `frontend/`: `npm run dev` (port 5173).
- `recommendation-service/` (optional): see its README. Without it the store works and
  recommendations are simply empty.
- No Stripe or AI keys? `npx tsx scripts/e2e-server.ts` in `backend/` runs the API with fake
  payments and fake AI, so every screen can be tried.

AI features answer 503 until `ANTHROPIC_API_KEY` is set; payments and plans answer 503 until the
Stripe keys are set (`documentation/Stripe_Setup_And_Verification.md`).

## Tests

Every phase ends with a test gate and a sign-off before the next begins
(`documentation/Phase_Gates_Checklist.md`).

- Backend: `npm test` in `backend/` (Jest and Supertest; see `backend/tests/README.md`).
- Browser: `node e2e/<suite>.e2e.mjs` in `frontend/`, with the e2e server and the frontend running.
- Python: `.\.venv\Scripts\python.exe -m pytest` in `recommendation-service/`.

## Tech stack

React · TypeScript · Node.js/Express · PostgreSQL (Prisma) · MongoDB (Mongoose) ·
Redis + BullMQ · Stripe (Checkout and Billing) · Anthropic Claude API · Python + FastAPI ·
JWT · Tailwind CSS · Docker (planned, Phase 8)

See `documentation/Implementation_Plan.md` for the full architecture and per-module
technical decisions.
