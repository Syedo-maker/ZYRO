# Part A: Revenue Model (Freemium Plans, Billing, AI Top-Ups)

Status: built and checked against the real Postgres, MongoDB and Redis with a fake Stripe and a fake AI provider. **Not yet run against real Stripe or the real Anthropic API** (see "What has not been verified"). Part B (usage counters) has not been started.

This is the first part of the roadmap of 2026-09-26. It adds what the plan's Part A asks for: Free, Pro and Business plans with limits, plan changes only from Stripe's verified webhook, a fall back to Free when a renewal fails, limits that show an upgrade prompt instead of an error, one-off AI top-up packs, cost controls in the AI orchestrator, and a platform view of per-store totals.

A `find-skill` check found nothing to install: `stripe-best-practices` (Billing, webhooks), `database-schema-designer`, `bullmq-specialist` and `claude-api` (model ids and prices) were already installed.

## The plans

| | Free | Pro | Business |
|---|---|---|---|
| Price per month | $0 | $12 | $39 |
| Products | 50 | 1,000 | 5,000 |
| Staff accounts (besides the owner) | 2 | 5 | 20 |
| AI generations per month | 15 | 200 | 800 |
| Assistant chat replies per month | 40 | 700 | 2,500 |
| Longest sales report | 30 days | 90 days | 366 days |
| Own domain name | no | no | yes |

All of it lives in one file, `backend/src/lib/plans.ts`, so a limit or a price is one reviewed edit. Prices are in US dollars (`BILLING_CURRENCY`); Pakistani rupee pricing would be a change to that file and to the Stripe account, not to the design. Business's 5,000 products equals the recommendation service's per-store cap on purpose.

**Why these numbers are a starting point, not a decision:** they are my proposal. The economics below show they are safe, not that they are the right prices for Pakistani merchants; that is a business decision for the team.

## Prices stay above cost (the plan's own rule)

`plans.ts` holds a ceiling on what one AI call can cost, and `assertPlanEconomics()` runs when the server starts: a paid plan or pack priced at or below its worst-case monthly cost stops the server from starting.

- Ceilings: an AI generation on the standard model is at most about $0.02 and a chat reply on the fast model about $0.006. They assume every call fills the prompt-size cap (16,000 characters, about 4,000 tokens) and the output cap, so they are ceilings, not averages. The prompt cap is real: the orchestrator cuts anything longer.
- Worst-case monthly cost = every AI call at its ceiling + hosting share (Free $0.10, Pro $1.50, Business $4) + Stripe's card fee (2.9% + 30 cents).

| | Price | Worst-case cost | Margin in the worst case |
|---|---|---|---|
| Free | $0 | $0.64 | costs the platform, by design |
| Pro | $12.00 | $10.35 | $1.65 |
| Business | $39.00 | $36.43 | $2.57 |
| Small AI pack (100 generations, 300 replies) | $5.00 | $4.25 | $0.75 |
| Large AI pack (400 generations, 1,200 replies) | $19.00 | $16.05 | $2.95 |

Real usage is far below the ceilings, so real margins are much larger. The same table is shown to platform operators (Platform page) so an edit that breaks it is visible. The Free plan's AI allowance can be changed with environment variables; raising it past a $1 budget logs a warning instead of stopping the server.

## How a plan changes (and how it cannot)

- **Only Stripe's verified webhook changes a plan or adds credits.** `POST .../billing/subscribe` and `.../top-up` only create a Stripe Checkout page and hand back its address. The request names a plan or a pack by id; the price is the server's. Coming back from Stripe changes nothing: the Billing page polls until the webhook has landed.
- **The amount is checked.** A checkout whose charged amount or currency differs from the catalog price is refused and logged, and the plan or credits are not applied.
- **Subscription events are not trusted for their contents.** On any `customer.subscription.*` event the server reads the subscription from Stripe again and applies that. Stripe does not promise event order, so a late "updated" cannot undo a later "cancelled". An event about an older subscription than the store's current one is ignored (a store that cancelled and resubscribed).
- **Top-ups are credited exactly once.** The purchase row has a unique Stripe session id, inserted in the same transaction as the credit, so a second delivery of the same event fails and does nothing.
- **Renewal fails, so the store falls back to Free.** Stripe retries a failed renewal, then ends the subscription, which arrives as `unpaid` or `canceled` and sets the plan to Free. Independently of any webhook, the plan the store can *use* is computed on every request: a paid plan whose paid period plus a 24 hour grace (`PLAN_GRACE_HOURS`) has passed counts as Free. So it is correct even if a webhook never arrives, and the grace stops a renewal webhook that is a little late from flickering a store down to Free.
- **A lapsed store loses nothing.** Products, staff and history stay; the store just cannot add more than Free allows. The Billing page says which plan lapsed.
- **Only a Free store can start a subscription.** Changing between paid plans means cancelling in Stripe's portal and choosing again when the period ends. Upgrading Pro to Business mid-period with proration is not built; doing it by starting a second subscription would double-bill, so it is refused (`409`).

Events handled: `checkout.session.completed` and `.async_payment_succeeded` (subscription checkout and top-up, told apart from shoppers' order payments by the session metadata's `purpose`), and `customer.subscription.created`, `.updated`, `.deleted`.

## Limits, enforced on the server

Each is checked at the moment of the action from the plan stored on the tenant, and refused with **402** plus an `upgrade` member (`{ feature, currentPlan, requiredPlan, limit }`) so the admin can offer "Upgrade to Pro" instead of a bare error:

- **Products:** creating one past the limit. A burst of simultaneous creates can overshoot by a few (check then insert); that costs nothing and the next attempt is refused.
- **Staff accounts:** adding one past the limit. The check runs *before* anything is created: an early version created the user account first and then refused, leaving an orphan account. That bug was found while checking this work and fixed.
- **Sales report window:** a report longer than the plan allows (with three hours of slack for daylight saving). The dashboard falls back to 30 days and explains.
- **Custom domain (Business):** `PATCH /stores/:id/domain`. Only the name is stored; serving the storefront on it is not built. Clearing a domain is always allowed, even after a lapse.
- **AI allowance:** the quota row follows the plan. An upgrade takes effect at once, and a lapse lowers it again, without waiting for next month; usage already counted is never reset.

## AI top-up packs

Two packs, on any plan. Credits are spent **after** the plan's monthly allowance runs out, never before, and do not expire at month end. The reservation is atomic (a single conditional `UPDATE`, like the monthly counter), and a failed AI call gives the credit back to where it came from. When the allowance and the credits are both gone, the 402 carries an upgrade hint and `topUpAvailable: true`.

## Orchestrator cost controls

- **Model per task (`lib/aiModels.ts`).** Short structured tasks (auto-tag, SEO text, chat replies) use `claude-haiku-4-5` ($1 in / $5 out per million tokens). Writing a merchant publishes or sends (descriptions, review summaries, marketing copy, insights, recovery emails) uses `claude-sonnet-5` ($2 / $10). The largest model (`claude-opus-5`, $5 / $25) is no longer the default for anything; it can be chosen with `AI_MODEL_STANDARD`, after which the plan prices must be re-checked. An unknown task type gets the standard model.
- **Direct answers.** These are short answers, so requests ask for no reasoning (thinking off on Haiku and Sonnet, low effort on Opus). Reasoning tokens count toward `max_tokens` and are billed as output, and would have left small budgets (100 tokens for tags) with no room for the answer.
- **Prompt size cap** (`AI_MAX_PROMPT_CHARS`, 16,000). The caller's text is cut, never the instructions. Reviews are fed newest first, so the oldest go.
- **Per-store cache** (`AI_CACHE_SECONDS`, 24 hours), opt-in per task, used for auto-tag, SEO text, review summaries and insights: an identical request from the same store is answered from Redis with no AI call and no quota. It is never used for regenerate, "write another version" or chat, where a different answer is the point. The key includes the store id, so nothing crosses stores.

## Platform view

`GET /platform/summary` and `/platform/tenants`, and a Platform page in the admin, for super administrators only. It shows counts and sums per store (plan, paid-until, products, orders, sales in the store's own currency, this month's AI use) and the plan-economics table. It shows **no customer data and not even store owners' emails**. Orders are counted platform-wide but sales are not summed, because stores sell in different currencies.

The role is `User.platformRole = SUPER_ADMIN`, read from the database on every request (removing it takes effect at once) and granted only by `npx tsx scripts/make-super-admin.ts <email>`; nothing in the API can grant it. Until Part B, order counts and sales come from aggregate queries over orders; Part B's counters will replace them.

## The screens

- **Plan and billing** (owner only, in the sidebar): the current plan and status, usage bars for products, staff and both AI allowances, the three plans with Choose buttons, manage-subscription (Stripe's portal), and the AI packs.
- **Upgrade prompts** in place of errors: adding a product, adding staff, a report window, and a used-up AI allowance. Staff who hit a limit are told to ask the owner.
- **Dashboard AI meter** now names the plan, shows bought credits, and links the owner to buy more.

## Trying it without Stripe

`scripts/e2e-server.ts` fakes Stripe's side: Choose Pro goes to a stand-in payment page, and `POST /__e2e/billing` plays the webhook through the real handler (see the end of `Stripe_Setup_And_Verification.md`).

## What has not been verified

- **Real Stripe.** Everything above ran against a fake gateway. The sandbox key in `.env` is restricted and was made for checkout, so it may lack permission for subscriptions and the billing portal; and the sandbox itself was due to expire on 2026-09-26. Before relying on billing, run it once against a claimed sandbox.
- **Real Anthropic API.** There is no key yet. The request shape for Haiku and Sonnet (thinking switched off) follows the model documentation but has not been sent to the real API.
- **Stripe in Pakistan.** Stripe does not currently onboard businesses based in Pakistan, so real card billing for this platform's own subscriptions may need a different provider or a foreign entity. The gateway is an interface (`StripeGateway`), so a local provider would be a second implementation, but that is a Part E design question, not something this part solved.

## Existing checks changed

The four older backend check scripts that the new limits touched were adjusted, not weakened: two put their test store on the Business plan the way a paid checkout would (they need a 31-day report and several staff), and two switch the AI cache off (they repeat identical requests and count quota for each). No check was removed. The full backend regression (16 scripts) and all seven browser suites pass.

## Deliberate limits

- One currency (US dollars) for plan prices.
- No mid-period plan change or proration; no refunds of plans or packs (a refund or dispute is handled in Stripe and does not yet reverse credits).
- No invoices or receipts inside ZYRO: Stripe's portal shows them.
- No trial period, no annual billing, no coupons on plans.
- Serving a storefront on a custom domain is not built.
- The platform view reads live aggregates, so it is fine for a small platform and will want Part B's counters as it grows.
