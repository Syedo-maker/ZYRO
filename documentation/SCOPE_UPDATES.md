# Scope Document Updates

Written to be copied into `ShopMind_AI_Scope_Document.docx`, which was submitted before most of this existed. Each item says whether it is **built** (in the repository, with the document that describes it) or **planned** (agreed in the roadmap of 2026-09-26, not written yet), so the scope document does not claim more than the project has. Last updated 2026-09-26, after Part A.

This file grows as each part is finished. Nothing in it has been approved by the supervisor yet: the original scope document does not reflect any of these changes, and the team chose to proceed before checking. That should be raised with the supervisor before final submission.

## 1. Product definition (changed)

The original scope described an online store builder. The product is now **ZYRO**, a multi-tenant Commerce + POS + AI platform for small businesses, with one shared core (catalog, inventory, customers, pricing, discounts, orders, analytics) behind two sales channels (online store and point of sale) and an AI layer over both. Target market: small merchants in Pakistan. It is intended to be used and sold after the project, not only demonstrated.

## 2. Revenue model (built: Part A)

Freemium: Free, Pro ($12 per month) and Business ($39 per month), with limits on products, staff accounts, monthly AI use, the length of sales reports, and a custom domain. One-off AI top-up packs on any plan. Plans are bought through Stripe Billing; **a plan changes only after Stripe's verified webhook confirms payment**; a failed renewal falls back to Free. Every price is checked against a worst-case cost (AI calls at their size ceilings, servers, Stripe fees) when the server starts, so a plan can never be priced below its cost. A platform view shows per-store totals to operators without any customer data. Details, prices and the economics table: `documentation/PartA_Revenue_Model.md`.

Open point for the write-up: prices are proposals, not researched against Pakistani merchants; and Stripe does not currently onboard Pakistan-based businesses, so real card billing may need another provider (the payment gateway is an interface, so a local provider is a second implementation).

## 3. AI features added beyond the original scope

Every AI call goes through one orchestrator (provider adapter, job queue, monthly quota per store, per-task model choice, prompt size cap, per-store cache). AI never handles money and never invents numbers: figures are computed by the server and the model only writes them up.

| Feature | Status | Document |
|---|---|---|
| Product descriptions with edit, regenerate and publish | built | `Phase4_Module6_AI_Content_Tools.md` |
| Review summarization | built | same |
| Auto-categorization and tagging | built | same |
| SEO metadata generation | built | same |
| Marketing copy (social post, email, ad headlines) | built | `Phase4_Marketing_Copy_And_Quota_Meter.md` |
| AI usage meter on the merchant dashboard | built | same |
| AI shopping assistant | built | `Phase5_Module3_AI_Shopping_Assistant.md` |
| Abandoned-cart recovery emails | built | `Phase5_Module7_Abandoned_Cart_Recovery.md` |
| Business insights (sales trend, best sellers, low stock, demand forecast) | built | `Phase5_AI_Business_Insights.md` |
| Recommendation service: Python/FastAPI microservice, product embeddings, similar products, semantic search for the assistant | built | `Phase6_AI_Recommendation_Service.md` |
| AI Growth Advisor (weekly tips from store totals) | planned | Part C |
| AI Trend Scout (trending products in Pakistan and worldwide, with sources) | planned | Part D |
| AI Payment and Trust module (COD risk, payment screenshot check, courier reconciliation, payment nudge, payment error helper) | planned | Part E |
| Semantic search in the search bar; voice-note store manager; bargaining assistant; festival planner | planned, stretch | Parts F and G |
| AI product photo editing | planned, stretch | Phase 6 |

Two deliberate deviations to state honestly: the recommendation service computes embeddings locally (a small ONNX model) instead of through the orchestrator, because Anthropic has no embeddings API and no key was available (the model sits behind an interface so the orchestrator route can replace it); and platform-run AI features (Growth Advisor, Trend Scout, Payment and Trust) are to be paid by the platform, not taken from a merchant's AI quota.

## 4. Point of sale (was out of scope, now built)

The original scope listed POS as out of scope. It is built as a second sales channel over the same catalog, inventory, customers, discounts and orders: cashier and manager accounts with permissions, product search and barcode lookup, split cash and card payments with change, shifts and cash-drawer counts, a cashier discount limit, held sales, printable receipts, item-level returns (stock goes back, cash comes out of the drawer), transaction history and a daily summary. Documents: `Phase2_5_Module8_POS_Backend.md`, `Phase2_5_POS_Frontend.md`, `Phase2_Commerce_Core_Foundation.md`.

## 5. Payments: COD and local methods (planned: Part E)

Cash on Delivery as an online method, a payment adapter so local gateways (JazzCash, Easypaisa, Safepay, XPay) can be added, and manual bank or wallet transfer with a screenshot. Not built. Card payments through Stripe are built for shoppers' orders.

## 6. New technologies

- **Python 3.11 and FastAPI** (recommendation service), with `motor` (async MongoDB), NumPy (cosine similarity) and `fastembed` with the ONNX model `BAAI/bge-small-en-v1.5` (text embeddings, no PyTorch).
- **Stripe Billing** (subscriptions, Checkout, customer portal) alongside the existing Stripe Checkout for orders.
- **Redis** for carts, rate limits, the AI job queue (BullMQ) and, new in Part A, a per-store AI answer cache.
- **Two Claude model tiers** (`claude-haiku-4-5` for short tasks and chat, `claude-sonnet-5` for writing) chosen per task to control cost.

## 7. Work breakdown and timeline

| Phase | Content | Status on 2026-09-26 |
|---|---|---|
| 0 | Schema, wireframes, API contract | done |
| 1 | Auth, multi-tenancy, store and catalog | done |
| 2 and 2.5 | Commerce core, cart, checkout, orders, shipping, refunds; POS | done |
| 3 | Discounts, search and reviews, analytics, staff, storefront and admin | done |
| 4 and 5 | AI orchestrator and content tools; assistant, cart recovery, insights | done |
| 6 | Recommendation service (Python) | done (photo editing stretch open) |
| Part A | Revenue model | done |
| Parts B to G | Usage counters, Growth Advisor, Trend Scout, Payment and Trust, search, voice and bargaining assistants | planned, effort estimates pending the approved plan |
| 7 | Testing (Jest, Supertest, Playwright, pytest, mobile) | last, not started |
| 8 | Docker Compose, environment setup, final documentation, Gantt chart, Turnitin report | last, not started |

The Gantt chart and the week estimates for Parts B to G are written after the team approves the detailed roadmap plan, so they are deliberately not filled in here.
