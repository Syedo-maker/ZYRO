# ShopMind AI — Implementation Plan

**Companion to:** ShopMind_AI_Scope_Document.docx
**Purpose:** Translate the approved scope into a phase-by-phase build plan, mapping every module from Section 7 (Modules) to a concrete technical solution — data model, APIs, libraries, and sequencing — so development can proceed without re-deriving design decisions later.

This document is a working plan, not a submission deliverable. It intentionally does **not** follow the scope document's structure (no abstract, vision statement, or literature review) — it starts from the architecture and moves straight into build order.

---

## 0. Phase & Module Checklist

Tracks build progress. One item is completed per session, in order, only when explicitly assigned. Check an item off only once its phase's exit criteria (or, for Testing/Deployment, its own bullet) is fully met.

**Phase 0 — Analysis & Design**
- [x] Database schema design (Prisma schema + Mongoose schemas) — see `documentation/Phase0_Module1_Database_Schema_Design.md`
- [ ] UI/UX wireframes (Figma, full navigation flow + component inventory)
- [ ] API contract draft (per-module endpoint list)

**Phase 1 — Foundation**
- [ ] Module: Authentication & Multi-Tenancy
- [ ] Module 4: Store & Catalog Management (CRUD baseline)

**Phase 2 — Core Commerce**
- [ ] Module 2: Cart & Checkout
- [ ] Module 5: Order & Shipping Management

**Phase 3 — Commerce Completeness**
- [ ] Module 7 (partial): Discount Codes
- [ ] Module 1 (remaining): Search & Reviews
- [ ] Module 7 (partial): Analytics Dashboard (baseline)

**Phase 4 — AI Feature 1**
- [ ] AI Orchestrator (provider adapter + BullMQ job queue + quota system)
- [ ] Module 6: AI Content Tools

**Phase 5 — AI Feature 2**
- [ ] Module 3: AI Shopping Assistant
- [ ] Module 7 (remaining): Abandoned-Cart Recovery

**Phase 6 — Testing**
- [ ] Unit tests (Jest)
- [ ] Integration tests incl. tenant-isolation (Jest + Supertest)
- [ ] End-to-end golden-path test (Playwright)
- [ ] AI quota enforcement check (load/manual)

**Phase 7 — Deployment & Documentation**
- [ ] Docker Compose stack (postgres, mongo, redis, api, web)
- [ ] Environment/secrets setup (`.env.example`)
- [ ] Final documentation pass (README, exit-criteria updates, demo script)
- [ ] Gantt chart generated from Section 2

---

## 1. System Architecture Summary

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS | Storefront (customer) + Admin dashboard (merchant), single codebase, route-split by role |
| Backend API | Node.js 20 + Express + TypeScript | REST API, tenant-aware middleware, auth, business logic |
| Relational store | PostgreSQL 16 + Prisma | Tenants, users, orders, payments, discounts — anything needing transactional consistency |
| Document store | MongoDB 7 + Mongoose | Product catalog, AI-generated content, chat transcripts — flexible/variable schema data |
| Queue / cache | Redis + BullMQ | AI job queueing, rate limiting, cart/session cache, scheduled jobs (abandoned-cart recovery) |
| AI layer | OpenAI / Anthropic API (adapter pattern) | Content generation, shopping assistant, personalized messages |
| Payments | Stripe API | Checkout, payment confirmation via webhooks |
| Auth | JWT (access + refresh tokens) | Merchant, staff, and customer sessions |
| Infra | Docker + Docker Compose | Local dev parity; single-command spin-up of Postgres, Mongo, Redis, API, frontend |

**Multi-tenancy model:** shared database, shared schema, `tenant_id` (a.k.a. `store_id`) as a required column/field on every tenant-scoped table and collection. Enforced two ways:
- Prisma middleware auto-injects `WHERE tenant_id = :current` on every query.
- Mongoose plugin does the equivalent for collections (`pre('find')` hooks scoping by `storeId`).

This avoids schema-per-tenant complexity while still giving hard isolation guarantees, which is what Section 6 (Scope) and Section 8 (Constraints) call for.

---

## 2. Phase Roadmap

Phases mirror Section 13 (WBS) of the scope document. Each phase below lists its modules (from Section 7) and the specific technical solution for building them, not just the feature description already stated in scope.

```
Phase 0  Analysis & Design            (weeks 1–4)
Phase 1  Foundation                   (weeks 5–8)   — Auth, Multi-tenancy, Catalog CRUD
Phase 2  Core Commerce                (weeks 9–12)  — Cart, Checkout, Orders, Shipping
Phase 3  Commerce Completeness        (weeks 13–16) — Discounts, Reviews, Search
Phase 4  AI Feature 1                 (weeks 17–20) — Orchestrator, Quota, Content Tools
Phase 5  AI Feature 2                 (weeks 21–24) — Shopping Assistant, Cart Recovery
Phase 6  Testing                      (weeks 25–26)
Phase 7  Deployment & Docs            (weeks 27–28)
```

Module ownership stays as defined in Section 12 of the scope document:
- **Muhammad Ibrahim (BSAI-23F-0048):** Modules 1, 2, 4, 5 — Storefront, Cart/Checkout, Catalog Management, Order/Shipping Management
- **Syed Sikander Gillani (BSAI-23F-0062):** Modules 3, 6, 7 — AI Shopping Assistant, AI Content Tools, Marketing/Analytics

---

## Phase 0 — Analysis & Design (Weeks 1–4)

No module code yet; this phase produces the artifacts every later phase depends on.

1. **Database schema design**
   - PostgreSQL (Prisma schema): `Tenant`, `User`, `StaffMember`, `Order`, `OrderItem`, `Payment`, `Shipment`, `DiscountCode`, `AiUsageQuota`.
   - MongoDB (Mongoose schemas): `Product`, `ProductReview`, `AiGeneratedContent`, `ChatTranscript`.
   - Decide relational vs document split per entity **now**, since retrofitting later touches every module.
2. **UI/UX wireframes (Figma)** — already partially done for the scope document's mockups (Section 14); extend into full navigation flow and component inventory (design system: buttons, cards, forms) so frontend work in later phases doesn't block on design.
3. **API contract draft** — write OpenAPI-style endpoint list per module (see phase sections below) so both students can build frontend/backend for different modules in parallel without integration surprises.

**Exit criteria:** Prisma schema + Mongoose schemas committed; wireframes approved by supervisor; endpoint list agreed between both students.

---

## Phase 1 — Foundation (Weeks 5–8)

### Module: Authentication & Multi-Tenancy *(supporting infrastructure, not numbered in Section 7, but required before Modules 1–7 can function)*
- **Solution:** JWT access token (15 min expiry) + refresh token (7 days, httpOnly cookie). Token payload carries `userId`, `tenantId`, `role` (`owner` | `staff` | `customer`).
- Passwords hashed with `bcrypt` (cost factor 12).
- Prisma middleware scopes every tenant-owned query automatically by `tenantId` from the request context (set via Express middleware reading the JWT).
- Staff accounts (Section 7.2, role-based access from Section 6) get a `permissions` array (e.g. `['orders:write', 'products:write']`) checked by a per-route authorization middleware.
- **Endpoints:** `POST /auth/register` (merchant + store creation in one transaction), `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /stores/:id/staff` (owner-only).

### Module 4: Store & Catalog Management (CRUD baseline)
- **Solution:** Products live in MongoDB (`Product` collection: `storeId`, `title`, `description`, `aiDescriptionId` ref, `price`, `images[]`, `stock`, `category`).
- Image upload: multipart upload to object storage (S3-compatible bucket, or local disk volume for prototype) — store the resulting URL only, never the binary, in Mongo.
- Store branding (name, logo, theme colors) stored on the `Tenant` record in Postgres since it's low-volume, config-like data.
- **Endpoints:** `POST/GET/PUT/DELETE /stores/:storeId/products`, `PATCH /stores/:storeId/branding`.

**Exit criteria:** A merchant can register, log in, create a store, and CRUD products with images through the admin dashboard. This is the first vertical slice — do not proceed to Phase 2 until this works end-to-end.

---

## Phase 2 — Core Commerce (Weeks 9–12)

### Module 2: Cart & Checkout
- **Solution:** Cart state kept server-side in Redis, keyed by `sessionId` (guest) or `userId` (logged-in customer), TTL 7 days. Avoids a Postgres table for something this ephemeral.
- Checkout uses **Stripe Checkout Session** (hosted payment page) rather than raw PaymentIntents — less PCI surface area for a student project, still satisfies "secure checkout integrated with a payment gateway" from Section 6.
- Stripe webhook (`checkout.session.completed`) triggers order creation in Postgres — this is the single source of truth for "did payment succeed," not the client redirect.
- Discount code validation happens server-side at checkout initiation (Module 7 dependency — see Phase 3).
- **Endpoints:** `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `POST /checkout/session`, `POST /webhooks/stripe`.

### Module 5: Order & Shipping Management
- **Solution:** `Order` + `OrderItem` (Postgres, transactional integrity matters for financial records per Section 6). `Shipment` record holds carrier/status, updated manually by merchant for this scope (no live carrier API integration — out of scope per Section 8).
- Shipping rates: a `ShippingZone` table per store (flat-rate or per-region) referenced at checkout to compute shipping cost.
- Refunds/cancellations call the Stripe Refunds API and update `Order.status`.
- **Endpoints:** `GET /stores/:id/orders`, `PATCH /orders/:id/status`, `POST /orders/:id/refund`, `POST/GET/PUT /stores/:id/shipping-zones`.

**Exit criteria:** A customer can add items to cart, apply nothing yet (discounts land in Phase 3), pay via Stripe test mode, and the merchant sees the order appear with correct shipping cost.

---

## Phase 3 — Commerce Completeness (Weeks 13–16)

### Module 7 (partial): Discount Codes
- **Solution:** `DiscountCode` table in Postgres (`code`, `type: percentage|fixed`, `value`, `expiresAt`, `usageLimit`, `usageCount`). Validation is a pure function so it can be unit-tested in isolation (no partial discounts, no stacking — keeps it inside the timeline).

### Module 1 (remaining): Search & Reviews
- **Solution:** Product search uses MongoDB's text index (`db.products.createIndex({ title: "text", description: "text" })`) — sufficient for the scope, avoids standing up a separate search service (e.g. Elasticsearch) that the timeline doesn't allow for.
- Reviews: `ProductReview` collection (`productId`, `customerId`, `rating`, `comment`), average rating computed on read via aggregation pipeline (not stored redundantly, to avoid sync bugs).
- **Endpoints:** `GET /stores/:id/products/search?q=`, `POST /products/:id/reviews`, `GET /products/:id/reviews`.

### Module 7 (partial): Analytics Dashboard (baseline)
- **Solution:** No separate analytics service — compute sales/order-count/top-products via Postgres aggregate queries (`GROUP BY`, `SUM`) run on demand, cached in Redis for 5 minutes to keep the dashboard responsive without a data-warehouse layer.
- **Endpoints:** `GET /stores/:id/analytics/summary`.

**Exit criteria:** Discounts apply at checkout, customers can search/filter and leave reviews, merchant dashboard shows real sales numbers.

---

## Phase 4 — AI Feature 1: Orchestrator, Quota, Content Generation (Weeks 17–20)

This is the phase that differentiates ShopMind AI from a plain e-commerce clone — treat it as the most architecturally important phase.

### AI Orchestrator (supporting infrastructure for Modules 3 and 6)
- **Solution:** A single internal service (`ai-orchestrator`) wraps all LLM calls behind one interface (`generate(promptType, context)`), with a provider adapter (`OpenAIAdapter` / `AnthropicAdapter`) selected by config — satisfies "OpenAI / Anthropic API" being listed together in Section 10 without hardcoding to one vendor.
- All AI calls are enqueued as **BullMQ jobs**, not called synchronously in the request handler — protects the API from slow LLM latency and gives a single choke point for rate limiting.
- **Quota system:** `AiUsageQuota` table (Postgres): `tenantId`, `month`, `generationsUsed`, `chatMessagesUsed`, `limit`. Middleware checks remaining quota *before* enqueueing a job; job increments the counter only on success (a failed generation shouldn't cost the merchant their quota).

### Module 6: AI Content Tools
- **Solution:** `POST /stores/:id/products/:productId/generate-description` — takes the product's existing basic fields (title, category, price, key attributes) as the prompt context, returns a draft stored in Mongo (`AiGeneratedContent`, status: `draft`).
- Merchant can `PATCH` to edit the draft, or `POST /regenerate` to re-run generation, before `POST /publish` copies it into the live `Product.description`.
- Quota remaining surfaced via `GET /stores/:id/ai-usage`.

**Exit criteria:** A merchant can generate, edit, and publish an AI product description, and see their remaining monthly quota update accordingly. The orchestrator and quota system built here are reused as-is in Phase 5.

---

## Phase 5 — AI Feature 2: Shopping Assistant & Abandoned-Cart Recovery (Weeks 21–24)

### Module 3: AI Shopping Assistant
- **Solution:** `POST /stores/:id/assistant/chat` — request includes the customer's message + `conversationId`. Backend builds context from:
  1. Short conversation history (last ~6 messages, cached in Redis, not persisted long-term for the prototype).
  2. Relevant product data — for the prototype, keyword-matched against the Mongo text index (the same one built in Phase 3) rather than a full vector-embedding pipeline, which keeps scope realistic while still supporting "AI-suggested related products."
- Response returned through the same AI orchestrator (`generate('chat', context)`) built in Phase 4, so quota accounting applies uniformly to chat and content generation.
- Chat transcripts stored in Mongo (`ChatTranscript`) for later review/debugging, not shown to other merchants (tenant-scoped).

### Module 7 (remaining): Abandoned-Cart Recovery
- **Solution:** A BullMQ **repeatable job** scans Redis carts every N hours for carts inactive beyond a threshold (e.g. 2 hours) with no matching completed order.
- For each match, the AI orchestrator generates a short personalized message (product names + a discount nudge if one exists), sent via a transactional email provider (e.g. SendGrid free tier) rather than building an in-house email system.
- Message outcome (sent/opened/clicked/converted) logged to a Postgres `CartRecoveryEvent` table, feeding the "abandoned cart recovery performance" view in the Marketing & Analytics dashboard (Module 7, Section 7.2).

**Exit criteria:** A customer can chat with the assistant and get relevant product suggestions; an abandoned cart triggers a real recovery email within the configured window, and its outcome shows up in the dashboard.

---

## Phase 6 — Testing (Weeks 25–26)

| Test type | Tool | Focus |
|---|---|---|
| Unit | Jest | Business logic — discount validation, quota checks, price calculations |
| Integration | Jest + Supertest | API endpoints, especially tenant-isolation (assert tenant A's token cannot read/write tenant B's data — this is the single highest-priority test given Section 6's data-isolation requirement) |
| End-to-end | Playwright | Golden path: register → create store → add product → generate AI description → customer checkout → order appears in admin |
| Load/manual | — | Verify AI quota correctly blocks generation once a tenant's monthly limit is hit |

**Exit criteria:** Tenant-isolation tests pass with zero cross-tenant leakage; golden-path E2E test green; no P0/P1 bugs open.

---

## Phase 7 — Deployment & Documentation (Weeks 27–28)

- **Docker Compose** bundles: `postgres`, `mongo`, `redis`, `api`, `web` — one command (`docker compose up`) reproduces the full stack for evaluators/supervisor.
- Environment variables (`.env`) hold all secrets (Stripe keys, AI API keys, JWT secret) — never committed; `.env.example` committed instead.
- Final documentation pass: update this implementation plan's "Exit criteria" checkboxes, write a short `README.md` (setup steps, seed data script for demo stores/products), and prepare the demo script for evaluation day.
- Generate the Gantt chart (MS Project, per Section 13 of the scope document) from the phase table in Section 2 of this plan.

---

## 3. Cross-Cutting Concerns (apply across every phase, not phase-specific)

- **Tenant isolation** is a correctness requirement, not a feature — every new table/collection added in any phase must include `tenantId`/`storeId` and be covered by the isolation tests from Phase 6, added incrementally as each module lands (don't wait until Phase 6 to write the first isolation test).
- **AI cost control** — every LLM call, in any module, must go through the Phase 4 orchestrator so quota accounting has no bypass path.
- **Secrets** — Stripe and AI provider keys are test/sandbox keys throughout development; production keys are only ever added at Phase 7, and only in the deployment environment's secret store, never in the repo.

---

## 4. Open Decisions to Confirm With Supervisor Before Phase 1

1. Object storage choice for product images (S3-compatible bucket vs. local disk for the prototype) — affects Phase 1 setup.
2. Email provider for cart-recovery messages (Phase 5) — needs an account created in advance since free-tier signup can take time to verify.
3. Confirm AI provider (OpenAI vs. Anthropic) for the primary adapter — the orchestrator supports both, but one should be the default to avoid holding two paid API keys during development.
