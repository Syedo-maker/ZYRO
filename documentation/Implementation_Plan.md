# ShopMind AI: Implementation Plan

**Companion to:** ShopMind_AI_Scope_Document.docx
**Purpose:** Translate the approved scope into a phase-by-phase build plan, mapping every module from Section 7 (Modules) to a concrete technical solution (data model, APIs, libraries, and sequencing) so development can proceed without re-deriving design decisions later.

This document is a working plan, not a submission deliverable. It intentionally does **not** follow the scope document's structure (no abstract, vision statement, or literature review); it starts from the architecture and moves straight into build order.

> **Scope amendment (post-Phase 1):** the AI feature set was expanded beyond the original scope document during implementation: four AI capabilities (recommendations, review summarization, auto-tagging, SEO metadata) were promoted from "stretch goal"/absent to core scope, and a new Python microservice was added to the architecture, at the student team's request. Two items considered (an agentic-storefront/ChatGPT-commerce integration, and a general workflow-automation builder) were declined as unrealistic for the remaining timeline and are **not** part of scope. This amendment has not been reflected in the original submitted scope document (`ShopMind_AI_Scope_Document.docx`); get supervisor sign-off on it before final submission if that document needs to match.
>
> **Frontend scheduling amendment (also post-Phase 1):** this plan originally described backend work only in every phase; no phase scheduled turning the Phase 0 wireframes into actual React screens. Fixed by adding a Frontend module to every phase below, paired with that phase's backend module(s) against the wireframes in `design/wireframes/`, so each phase is demoable end-to-end (not just API-testable) once complete. Phase 1's frontend module is now owed retroactively, since that phase's backend was already built and marked done before this gap was caught, so it's listed as the next outstanding item, ahead of Phase 2.
>
> **Commerce + POS amendment (2026-09-19):** ZYRO is now defined as a real, multi-tenant Commerce + POS SaaS, not only an online store. The POS is a second sales channel over one shared commerce core (catalog, inventory, customers, pricing, discounts, orders, analytics). An architecture review found the original schema was online-only (stock on the MongoDB product, no order channel, Stripe-only payments, no tenant-scoped customers), so a Commerce Core Foundation module was added at the start of Phase 2 and a POS phase (2.5) after it. Phase 3 analytics and Phase 4/5 AI features become channel-aware, and the AI layer gains business insights (sales trends, low-stock alerts, demand forecasting). The timeline grows from 31 to about 35 weeks.

---

## 0. Phase & Module Checklist

Tracks build progress. One item is completed per session, in order, only when explicitly assigned. Check an item off only once its phase's exit criteria (or, for Testing/Deployment, its own bullet) is fully met.

**Phase 0: Analysis & Design**
- [x] Database schema design (Prisma schema + Mongoose schemas); see `documentation/Phase0_Module1_Database_Schema_Design.md`
- [x] UI/UX wireframes (full navigation flow + component inventory), built as a Claude Design canvas rather than Figma, see `design/wireframes/`
- [x] API contract draft (per-module endpoint list); see `backend/openapi.yaml` and `documentation/Phase0_Module3_API_Contract.md`

**Phase 1: Foundation**
- [x] Module: Authentication & Multi-Tenancy (backend), running end-to-end against local Postgres, see `documentation/Phase1_Module1_Auth_MultiTenancy.md`
- [x] Module 4: Store & Catalog Management (backend, CRUD baseline), running end-to-end against local Postgres + MongoDB, see `documentation/Phase1_Module4_Store_Catalog_Management.md`
- [x] **Frontend (owed retroactively):** React project scaffold (Vite + TS + Tailwind, wired to the backend API) + auth screens (register/login) + Admin Catalog Management UI (`AdminCatalog.dc.html`), verified with an automated headless-browser test against the real backend, see `documentation/Phase1_Frontend_Auth_And_Admin_Catalog.md`

**Phase 2: Core Commerce**
- [x] Module: Commerce Core Foundation (backend, *new, added by the Commerce + POS amendment*): inventory in Postgres, locations, customers, channel-aware orders and payments, shared pricing and `createOrder` services; see `documentation/Phase2_Commerce_Core_Foundation.md`
- [x] Module 2: Cart & Checkout (backend, online channel), verified against real Postgres, MongoDB and Redis with Stripe's network calls faked; see `documentation/Phase2_Module2_Cart_And_Checkout.md`
- [x] Module 5: Order & Shipping Management (backend, all channels), verified against real Postgres and MongoDB with Stripe's refund call faked; see `documentation/Phase2_Module5_Order_And_Shipping_Management.md`
- [x] Frontend: Storefront Cart, Checkout, Order Confirmation (`Cart.dc.html`, `Checkout.dc.html`, `OrderConfirmation.dc.html`) + Admin Orders & Shipping UI (`AdminOrders.dc.html`), verified in real Chromium with Stripe's hosted page stood in; includes a minimal placeholder product grid replaced in Phase 3; see `documentation/Phase2_Frontend_Storefront_And_Admin_Orders.md`

**Phase 2.5: Point of Sale (POS)** *(new phase, added by the Commerce + POS amendment; numbered 2.5 so existing phase numbers stay stable)*
- [x] Wireframes: POS screen, receipt, daily summary (design/wireframes/pos, 11 screens; see Phase2_5_POS_Wireframes.md)
- [x] Module 8: POS backend (cashier accounts, product/barcode lookup, POS checkout with split cash/card payments and change, shifts and cash drawer, discount limit, held sales, receipt data, transaction history, daily sales summary; see Phase2_5_Module8_POS_Backend.md)
- [x] Frontend: POS register screen, receipt view (printable), transaction history, daily summary, team page (see Phase2_5_POS_Frontend.md)
- [x] Returns/refunds for POS orders (item-level, stock returns to inventory, cash comes out of the drawer)

**Phase 3: Commerce Completeness**
- [ ] Module 7 (partial): Discount Codes (backend)
- [ ] Module 1 (remaining): Search & Reviews (backend)
- [ ] Module 7 (partial): Analytics Dashboard (backend, baseline; sales split by channel, ONLINE vs POS)
- [ ] Frontend: Storefront Home, Category/Search, Product Detail + reviews (`Main.dc.html`, `CategoryListing.dc.html`, `ProductDetail.dc.html`) + Admin Dashboard home + Marketing/Analytics UI (`AdminDashboard.dc.html`, `AdminMarketing.dc.html`)

**Phase 4: AI Feature 1**
- [ ] AI Orchestrator (provider adapter + BullMQ job queue + quota system)
- [ ] Module 6: AI Content Tools (product descriptions)
- [ ] Module 6 (added): AI review summarization
- [ ] Module 6 (added): AI auto-categorization/tagging
- [ ] Module 6 (added): AI SEO metadata generation
- [ ] Frontend: wire the AI generate/regenerate/publish flow + quota display into the Admin Catalog UI (scaffolded in Phase 1, made functional here) + UI touches for summarization/auto-tag/SEO metadata

**Phase 5: AI Feature 2**
- [ ] Module 3: AI Shopping Assistant (backend)
- [ ] Module 7 (remaining): Abandoned-Cart Recovery (backend)
- [ ] AI business insights (added by the Commerce + POS amendment): sales trend analysis, best sellers, low-stock alerts and simple demand forecasting from the `StockMovement` ledger, using the Phase 4 orchestrator
- [ ] Frontend: AI Assistant chat widget (`AIAssistant.dc.html`) wired to the real endpoint

**Phase 6: AI Recommendation Service (Python)** *(new phase, added post-Phase 1 scope amendment)*
- [ ] Python/FastAPI microservice scaffold + embedding pipeline
- [ ] `GET /stores/:storeId/products/:productId/recommendations` (Node-proxied)
- [ ] Wire into AI Shopping Assistant's "suggested related products" (upgrade from Phase 5's keyword matching)
- [ ] Frontend: display recommended products on Product Detail + Storefront Home

**Phase 7: Testing**
- [ ] Unit tests (Jest)
- [ ] Integration tests incl. tenant-isolation (Jest + Supertest)
- [ ] End-to-end golden-path test (Playwright)
- [ ] AI quota enforcement check (load/manual)
- [ ] Python recommendation service tests (pytest)

**Phase 8: Deployment & Documentation**
- [ ] Docker Compose stack (postgres, mongo, redis, api, web, recommendation-service)
- [ ] Environment/secrets setup (`.env.example`)
- [ ] Final documentation pass (README, exit-criteria updates, demo script)
- [ ] Gantt chart generated from Section 2

---

## 1. System Architecture Summary

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS | Storefront (customer) + Admin dashboard (merchant), single codebase, route-split by role |
| Backend API | Node.js 20 + Express + TypeScript | REST API, tenant-aware middleware, auth, business logic |
| Relational store | PostgreSQL 16 + Prisma | Tenants, users, orders, payments, discounts (anything needing transactional consistency) |
| Document store | MongoDB 7 + Mongoose | Product catalog, AI-generated content, chat transcripts (flexible/variable schema data) |
| Queue / cache | Redis + BullMQ | AI job queueing, rate limiting, cart/session cache, scheduled jobs (abandoned-cart recovery) |
| AI layer | OpenAI / Anthropic API (adapter pattern) | Content generation, shopping assistant, personalized messages, review summarization, auto-tagging, SEO metadata |
| Recommendation service | Python 3.11 + FastAPI | Product-embedding-based recommendations, a separate microservice, added post-Phase 1 scope amendment (see note above); the only Python component in the stack |
| Payments | Stripe API | Checkout, payment confirmation via webhooks |
| Auth | JWT (access + refresh tokens) | Merchant, staff, and customer sessions |
| Infra | Docker + Docker Compose | Local dev parity; single-command spin-up of Postgres, Mongo, Redis, API, frontend, recommendation-service |

**Multi-tenancy model:** shared database, shared schema, `tenant_id` (a.k.a. `store_id`) as a required column/field on every tenant-scoped table and collection. Enforced two ways:
- Prisma middleware auto-injects `WHERE tenant_id = :current` on every query.
- Mongoose plugin does the equivalent for collections (`pre('find')` hooks scoping by `storeId`).

This avoids schema-per-tenant complexity while still giving hard isolation guarantees, which is what Section 6 (Scope) and Section 8 (Constraints) call for.

---

## 2. Phase Roadmap

Phases mirror Section 13 (WBS) of the scope document. Each phase below lists its modules (from Section 7) and the specific technical solution for building them, not just the feature description already stated in scope.

```
Phase 0  Analysis & Design            (weeks 1-4)
Phase 1  Foundation                   (weeks 5-8)   : Auth, Multi-tenancy, Catalog CRUD
Phase 2  Core Commerce                (weeks 9-13)  : Commerce core foundation, Cart, Checkout, Orders, Shipping
Phase 2.5 Point of Sale               (weeks 14-16) : POS backend + frontend, returns (NEW, Commerce + POS amendment)
Phase 3  Commerce Completeness        (weeks 17-20) : Discounts, Reviews, Search, channel-aware Analytics
Phase 4  AI Feature 1                 (weeks 21-24) : Orchestrator, Content Tools, Summarization, Tagging, SEO
Phase 5  AI Feature 2                 (weeks 25-28) : Shopping Assistant, Cart Recovery, business insights
Phase 6  AI Recommendation Service    (weeks 29-31) : Python/FastAPI microservice (NEW, post-Phase 1 amendment)
Phase 7  Testing                      (weeks 32-33)
Phase 8  Deployment & Docs            (weeks 34-35)
```

Adding Phase 6 pushed the total timeline from the original 28 weeks to 31, and the Commerce + POS amendment (foundation module plus Phase 2.5) pushes it to about 35. These are real costs of the scope changes, not free additions. Flag both to your supervisor alongside the amendment notes above.

Module ownership stays as defined in Section 12 of the scope document, with the new Phase 6 assigned to Sikander as an extension of his existing AI-module ownership:
- **Muhammad Ibrahim (BSAI-23F-0048):** Modules 1, 2, 4, 5: Storefront, Cart/Checkout, Catalog Management, Order/Shipping Management
- **Syed Sikander Gillani (BSAI-23F-0062):** Modules 3, 6, 7: AI Shopping Assistant, AI Content Tools, Marketing/Analytics, plus the new Phase 6 AI Recommendation Service

---

## Phase 0: Analysis & Design (Weeks 1-4)

No module code yet; this phase produces the artifacts every later phase depends on.

1. **Database schema design**
   - PostgreSQL (Prisma schema): `Tenant`, `User`, `StaffMember`, `Order`, `OrderItem`, `Payment`, `Shipment`, `DiscountCode`, `AiUsageQuota`.
   - MongoDB (Mongoose schemas): `Product`, `ProductReview`, `AiGeneratedContent`, `ChatTranscript`.
   - Decide relational vs document split per entity **now**, since retrofitting later touches every module.
2. **UI/UX wireframes (Figma):** already partially done for the scope document's mockups (Section 14); extend into full navigation flow and component inventory (design system: buttons, cards, forms) so frontend work in later phases doesn't block on design.
3. **API contract draft:** write OpenAPI-style endpoint list per module (see phase sections below) so both students can build frontend/backend for different modules in parallel without integration surprises.

**Exit criteria:** Prisma schema + Mongoose schemas committed; wireframes approved by supervisor; endpoint list agreed between both students.

---

## Phase 1: Foundation (Weeks 5-8)

### Module: Authentication & Multi-Tenancy *(supporting infrastructure, not numbered in Section 7, but required before Modules 1-7 can function)*
- **Solution:** JWT access token (15 min expiry) + refresh token (7 days, httpOnly cookie). Token payload carries `userId`, `tenantId`, `role` (`owner` | `staff` | `customer`).
- Passwords hashed with `bcrypt` (cost factor 12).
- Prisma middleware scopes every tenant-owned query automatically by `tenantId` from the request context (set via Express middleware reading the JWT).
- Staff accounts (Section 7.2, role-based access from Section 6) get a `permissions` array (e.g. `['orders:write', 'products:write']`) checked by a per-route authorization middleware.
- **Endpoints:** `POST /auth/register` (merchant + store creation in one transaction), `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /stores/:id/staff` (owner-only).

### Module 4: Store & Catalog Management (CRUD baseline)
- **Solution:** Products live in MongoDB (`Product` collection: `storeId`, `title`, `description`, `aiDescriptionId` ref, `price`, `images[]`, `stock`, `category`).
- Image upload: multipart upload to object storage (S3-compatible bucket, or local disk volume for prototype); store the resulting URL only, never the binary, in Mongo.
- Store branding (name, logo, theme colors) stored on the `Tenant` record in Postgres since it's low-volume, config-like data.
- **Endpoints:** `POST/GET/PUT/DELETE /stores/:storeId/products`, `PATCH /stores/:storeId/branding`.

**Exit criteria:** A merchant can register, log in, create a store, and CRUD products with images through the admin dashboard. This is the first vertical slice; do not proceed to Phase 2 until this works end-to-end.

---

## Phase 2: Core Commerce (Weeks 9-12)

### Module: Commerce Core Foundation (added by the Commerce + POS amendment)
ZYRO is now defined as a multi-tenant Commerce + POS SaaS (see the amendment note at the top). The original schema was online-only, so this module lands first and gives both sales channels one shared base:
- **Inventory in Postgres:** `InventoryLevel` (per tenant, product and location) plus an append-only `StockMovement` ledger replace `Product.stock` in MongoDB. Deduction is a conditional `UPDATE ... WHERE quantity >= n` inside the same transaction that creates the order, so two channels cannot both sell the last unit.
- **`Location`:** one default location per store, created at registration; multiple stores, warehouses and terminals fit later without changing keys.
- **`Customer`:** tenant-scoped, optionally linked to a `User`, so POS walk-ins need no account.
- **Orders and payments serve both channels:** `Order.channel` (ONLINE or POS), per-tenant `orderNumber`, cashier, location, tax; `Payment.method` (CASH, CARD, STRIPE, OTHER) with a nullable Stripe id and several payments per order.
- **Shared services:** `pricing` (pure totals math in integer cents) and `createOrder` (the one transactional place orders, payments and stock changes are written). Online checkout and POS checkout are thin wrappers over these.
- **Also:** tenant tax rate, new staff permissions (`POS_SELL`, `INVENTORY_WRITE`, `REFUNDS`), `User.platformRole` for a future Super Admin, SKU/barcode/taxable/cost fields on products.

### Module 2: Cart & Checkout
- **Solution:** Cart state kept server-side in Redis, keyed by `sessionId` (guest) or `userId` (logged-in customer), TTL 7 days. Avoids a Postgres table for something this ephemeral.
- Checkout uses **Stripe Checkout Session** (hosted payment page) rather than raw PaymentIntents: less PCI surface area for a student project, still satisfies "secure checkout integrated with a payment gateway" from Section 6.
- Stripe webhook (`checkout.session.completed` and `async_payment_succeeded`, gated on `payment_status`) calls the shared `createOrder` service with channel ONLINE; this is the single source of truth for "did payment succeed," not the client redirect. The priced cart is frozen as a `CheckoutSession` snapshot before the Stripe call and the order is written from it. Stock is checked when checkout starts and deducted on payment confirmation; if it ran out in between, the payment is refunded automatically (timed reservation can be added later).
- Discount code validation happens server-side at checkout initiation (Module 7 dependency; see Phase 3).
- **Endpoints:** `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `POST /checkout/session`, `POST /webhooks/stripe`.

### Module 5: Order & Shipping Management
- **Solution:** `Order` + `OrderItem` (Postgres, transactional integrity matters for financial records per Section 6). `Shipment` record holds carrier/status, updated manually by merchant for this scope (no live carrier API integration, out of scope per Section 8).
- Shipping rates: a `ShippingZone` table per store (flat-rate or per-region) referenced at checkout to compute shipping cost.
- Refunds work for every payment method: Stripe payments call the Stripe Refunds API (idempotent), cash and card-terminal payments are recorded as returned, all through one `Refund` record per payment. Cancelling a paid order refunds it and restocks. Stock returns as `RETURN` movements.
- Order lists and detail views are channel-aware (filter by ONLINE or POS). Shipping applies to ONLINE orders; POS orders are fulfilled in store and have no `Shipment`.
- **Endpoints:** `GET /stores/:id/orders`, `GET /stores/:id/orders/:orderId`, `PATCH /stores/:id/orders/:orderId/status`, `POST /stores/:id/orders/:orderId/refund`, `PUT /stores/:id/orders/:orderId/shipment`, `GET/POST/PUT/DELETE /stores/:id/shipping-zones`.

**Exit criteria:** A customer can add items to cart, apply nothing yet (discounts land in Phase 3), pay via Stripe test mode, and the merchant sees the order appear with correct shipping cost.

---

## Phase 2.5: Point of Sale (POS)

Added by the Commerce + POS amendment. The POS is a second sales channel over the same catalog, inventory, customers, discounts and orders as the online store, not a separate system. It calls the shared `createOrder` service with channel POS.

- **Backend (Module 8):** cashier/staff login using the existing auth and the `POS_SELL` permission; product search and barcode lookup; POS checkout (cash and card-terminal payments recorded directly, split payments allowed); receipt data; transaction history; daily sales summary. Cashier sessions and cash-drawer reconciliation, multiple registers, receipt printers and barcode-scanner hardware are deferred but not blocked by the schema.
- **Returns/refunds:** a POS return restocks inventory through a `RETURN` stock movement.
- **Frontend:** POS register screen, receipt view, transaction history. Needs new wireframes first (Phase 0 covers only the online store).
- **Exit criteria:** a cashier can ring up a sale by search or barcode, take cash or card, print or view a receipt, and the stock shown on the online store drops by the same amount.

---

## Phase 3: Commerce Completeness (Weeks 13-16)

### Module 7 (partial): Discount Codes
- **Solution:** `DiscountCode` table in Postgres (`code`, `type: percentage|fixed`, `value`, `expiresAt`, `usageLimit`, `usageCount`). Validation is a pure function so it can be unit-tested in isolation (no partial discounts, no stacking, which keeps it inside the timeline).

### Module 1 (remaining): Search & Reviews
- **Solution:** Product search uses MongoDB's text index (`db.products.createIndex({ title: "text", description: "text" })`): sufficient for the scope, avoids standing up a separate search service (e.g. Elasticsearch) that the timeline doesn't allow for.
- Reviews: `ProductReview` collection (`productId`, `customerId`, `rating`, `comment`), average rating computed on read via aggregation pipeline (not stored redundantly, to avoid sync bugs).
- **Endpoints:** `GET /stores/:id/products/search?q=`, `POST /products/:id/reviews`, `GET /products/:id/reviews`.

### Module 7 (partial): Analytics Dashboard (baseline)
- **Solution:** No separate analytics service: compute sales/order-count/top-products via Postgres aggregate queries (`GROUP BY`, `SUM`) run on demand, cached in Redis for 5 minutes to keep the dashboard responsive without a data-warehouse layer.
- **Endpoints:** `GET /stores/:id/analytics/summary`.

**Exit criteria:** Discounts apply at checkout, customers can search/filter and leave reviews, merchant dashboard shows real sales numbers.

---

## Phase 4: AI Feature 1: Orchestrator, Quota, Content Generation (Weeks 17-20)

This is the phase that differentiates ShopMind AI from a plain e-commerce clone; treat it as the most architecturally important phase.

### AI Orchestrator (supporting infrastructure for Modules 3 and 6)
- **Solution:** A single internal service (`ai-orchestrator`) wraps all LLM calls behind one interface (`generate(promptType, context)`), with a provider adapter (`OpenAIAdapter` / `AnthropicAdapter`) selected by config: satisfies "OpenAI / Anthropic API" being listed together in Section 10 without hardcoding to one vendor.
- All AI calls are enqueued as **BullMQ jobs**, not called synchronously in the request handler; this protects the API from slow LLM latency and gives a single choke point for rate limiting.
- **Quota system:** `AiUsageQuota` table (Postgres): `tenantId`, `month`, `generationsUsed`, `chatMessagesUsed`, `limit`. Middleware checks remaining quota *before* enqueueing a job; job increments the counter only on success (a failed generation shouldn't cost the merchant their quota).

### Module 6: AI Content Tools
- **Solution:** `POST /stores/:id/products/:productId/generate-description`: takes the product's existing basic fields (title, category, price, key attributes) as the prompt context, returns a draft stored in Mongo (`AiGeneratedContent`, status: `draft`).
- Merchant can `PATCH` to edit the draft, or `POST /regenerate` to re-run generation, before `POST /publish` copies it into the live `Product.description`.
- Quota remaining surfaced via `GET /stores/:id/ai-usage`.

### Module 6 (added post-Phase 1): AI Review Summarization, Auto-Tagging, SEO Metadata
Added as part of the post-Phase 1 scope amendment (see the note near the top of this document). All three reuse the orchestrator and quota system above as new `promptType`s: no new infrastructure, just new prompt templates and thin endpoints, which is why these were accepted into core scope where heavier asks (agentic storefronts, a workflow-automation builder) were not.
- **Review summarization:** `POST /stores/:id/products/:productId/reviews/summarize`: pulls recent `ProductReview` documents, asks the orchestrator for a short merchant-facing summary (common praise/complaints), cached rather than recomputed on every request (invalidated when new reviews arrive past a small threshold, to control cost).
- **Auto-categorization/tagging:** `POST /stores/:id/products/:productId/auto-tag`: given title + description, suggests a `category` and a small tag list; merchant accepts/edits before it's saved, same pattern as AI descriptions (never silently overwrites merchant data).
- **SEO metadata generation:** `POST /stores/:id/products/:productId/seo-metadata/generate`: generates a meta title + meta description; requires adding `seoTitle`/`seoDescription` fields to the `Product` schema (a small addition when this module is actually built, not done yet).

**Exit criteria:** A merchant can generate, edit, and publish an AI product description, and see their remaining monthly quota update accordingly. The orchestrator and quota system built here are reused as-is in Phase 5 and by every capability added in this section.

---

## Phase 5: AI Feature 2: Shopping Assistant & Abandoned-Cart Recovery (Weeks 21-24)

### Module 3: AI Shopping Assistant
- **Solution:** `POST /stores/:id/assistant/chat`: request includes the customer's message + `conversationId`. Backend builds context from:
  1. Short conversation history (last ~6 messages, cached in Redis, not persisted long-term for the prototype).
  2. Relevant product data: for the prototype, keyword-matched against the Mongo text index (the same one built in Phase 3) rather than a full vector-embedding pipeline, which keeps scope realistic while still supporting "AI-suggested related products."
- Response returned through the same AI orchestrator (`generate('chat', context)`) built in Phase 4, so quota accounting applies uniformly to chat and content generation.
- Chat transcripts stored in Mongo (`ChatTranscript`) for later review/debugging, not shown to other merchants (tenant-scoped).

### Module 7 (remaining): Abandoned-Cart Recovery
- **Solution:** A BullMQ **repeatable job** scans Redis carts every N hours for carts inactive beyond a threshold (e.g. 2 hours) with no matching completed order.
- For each match, the AI orchestrator generates a short personalized message (product names + a discount nudge if one exists), sent via a transactional email provider (e.g. SendGrid free tier) rather than building an in-house email system.
- Message outcome (sent/opened/clicked/converted) logged to a Postgres `CartRecoveryEvent` table, feeding the "abandoned cart recovery performance" view in the Marketing & Analytics dashboard (Module 7, Section 7.2).

**Exit criteria:** A customer can chat with the assistant and get relevant product suggestions; an abandoned cart triggers a real recovery email within the configured window, and its outcome shows up in the dashboard.

---

## Phase 6: AI Recommendation Service: Python (Weeks 25-27)

*New phase, added in the post-Phase 1 scope amendment (see note near the top of this document); not in the original scope document. This is the one Python component in an otherwise all-TypeScript stack, added specifically to bring genuine applied-ML work into the project rather than only LLM-API orchestration.*

### AI Recommendation Service
- **Solution:** A standalone Python 3.11 + FastAPI microservice (`recommendation-service/`), sitting alongside `backend/` and `frontend/`, not a Node module. Node keeps owning the storefront/admin API and all writes; this service is read-mostly and called internally over HTTP.
- **Embeddings, not a trained model:** rather than training a collaborative-filtering model from scratch (which needs volumes of interaction data this prototype won't have), product embeddings are computed from each product's title + description. Consistent with the cross-cutting rule that every LLM/AI-provider call goes through the Phase 4 orchestrator with no bypass path, the **Python service does not call OpenAI/Anthropic directly**: it calls back into Node's orchestrator (a small internal `POST /internal/ai/embed` endpoint, not part of the public `openapi.yaml` contract) so embedding calls are quota-accounted the same way content generation and chat are. This is genuine applied-ML work (vector similarity, ranking) without requiring a training pipeline or GPU infrastructure a two-person FYP can't realistically stand up.
- **Storage:** the embedding vector is written back onto the `Product` document itself (a new `embedding: number[]` field) via the Python service connecting directly to the same MongoDB database Node uses (`motor`, the async Mongo driver for Python), one source of truth for product data, not a duplicated store.
- **Similarity search:** brute-force cosine similarity computed in Python at request time over a store's product set. A dedicated vector database (pgvector, Pinecone, etc.) is the correct answer at real-world scale, but is unjustified infrastructure for the catalog sizes this prototype will actually hold: a deliberate, defensible scope call, not an oversight.
- **Trigger:** Node's existing `products_create`/`products_update` endpoints (already built in Phase 1 Module 4) call the recommendation service after a successful write to (re)compute that product's embedding, fire-and-forget, not on the request's critical path.
- **Endpoints:** `GET /stores/:storeId/products/:productId/recommendations`: exposed from **Node** (not the Python service directly), which proxies to the Python service internally. This keeps one consistent public API surface/auth model rather than exposing two different API styles to the frontend.
- **Upgrade path for the shopping assistant:** Phase 5's "AI-suggested related products" used simple keyword matching against the Mongo text index. Once this service exists, that can be swapped for a real call to the recommendation endpoint; noted here as a follow-up, not required to re-open Phase 5's own exit criteria.

**Exit criteria:** Given a product, the recommendation endpoint returns a ranked list of similar products from the same store, computed from real embeddings rather than keyword matching; a new/updated product gets an embedding within a few seconds of being saved.

---

## Phase 7: Testing (Weeks 28-29)

| Test type | Tool | Focus |
|---|---|---|
| Unit | Jest | Business logic: discount validation, quota checks, price calculations |
| Integration | Jest + Supertest | API endpoints, especially tenant-isolation (assert tenant A's token cannot read/write tenant B's data; this is the single highest-priority test given Section 6's data-isolation requirement) |
| End-to-end | Playwright | Golden path: register → create store → add product → generate AI description → customer checkout → order appears in admin |
| Load/manual | n/a | Verify AI quota correctly blocks generation once a tenant's monthly limit is hit |
| Unit (Python) | pytest | Embedding pipeline and cosine-similarity ranking logic in the recommendation service |

**Exit criteria:** Tenant-isolation tests pass with zero cross-tenant leakage; golden-path E2E test green; no P0/P1 bugs open.

---

## Phase 8: Deployment & Documentation (Weeks 30-31)

- **Docker Compose** bundles: `postgres`, `mongo`, `redis`, `api`, `web`, `recommendation-service`: one command (`docker compose up`) reproduces the full stack for evaluators/supervisor.
- Environment variables (`.env`) hold all secrets (Stripe keys, AI API keys, JWT secret): never committed; `.env.example` committed instead.
- Final documentation pass: update this implementation plan's "Exit criteria" checkboxes, write a short `README.md` (setup steps, seed data script for demo stores/products), and prepare the demo script for evaluation day.
- Generate the Gantt chart (MS Project, per Section 13 of the scope document) from the phase table in Section 2 of this plan.

---

## 3. Cross-Cutting Concerns (apply across every phase, not phase-specific)

- **Tenant isolation** is a correctness requirement, not a feature: every new table/collection added in any phase must include `tenantId`/`storeId` and be covered by the isolation tests from Phase 7, added incrementally as each module lands (don't wait until Phase 7 to write the first isolation test).
- **AI cost control:** every LLM call, in any module, must go through the Phase 4 orchestrator so quota accounting has no bypass path. The Phase 6 recommendation service's embedding calls go through the same orchestrator/quota system for the same reason.
- **Secrets:** Stripe and AI provider keys are test/sandbox keys throughout development; production keys are only ever added at Phase 8, and only in the deployment environment's secret store, never in the repo.

---

## 4. Open Decisions to Confirm With Supervisor Before Phase 1

1. Object storage choice for product images (S3-compatible bucket vs. local disk for the prototype); affects Phase 1 setup.
2. Email provider for cart-recovery messages (Phase 5): needs an account created in advance since free-tier signup can take time to verify.
3. Confirm AI provider (OpenAI vs. Anthropic) for the primary adapter: the orchestrator supports both, but one should be the default to avoid holding two paid API keys during development.
4. **(Added post-Phase 1)** Get explicit supervisor sign-off on the AI scope amendment (Phase 4 additions + new Phase 6) and the resulting timeline shift from 28 to 31 weeks, and confirm whether the original scope document needs a formal addendum.
