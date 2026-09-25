# Phase 5, Module 7 (remaining): Abandoned-Cart Recovery

Status: complete and verified (17 new backend checks in `verify-cart-recovery.ts`; all other backend suites still pass, 742 backend checks in total). Backend only, per the plan's own checklist (there is no separate frontend item for this module, unlike Module 3's chat widget); the "abandoned cart recovery performance" view the plan names is exposed as a data endpoint, not wired into an admin page yet.

A `find-skill` search found nothing to install: the already-installed `bullmq-specialist` (the repeatable job) and `claude-api` (the orchestrator call) cover this module's infrastructure, and no packaged skill exists for SendGrid specifically, just its own marketing pages. The SendGrid integration is a single documented REST call, implemented directly behind the same fakeable-gateway interface already used for Stripe and the AI provider (`lib/email.ts`).

## How a cart gets recovered

1. **A repeatable BullMQ job** (`lib/cartRecoveryQueue.ts`, `CART_RECOVERY_SCAN_INTERVAL_HOURS`, default 1 hour) calls `cartRecoveryService.scan()`, which walks every Redis cart key shaped `cart:{storeId}:u:{userId}` via `SCAN` (never `KEYS`, which blocks Redis on a large keyspace).
2. **Only signed-in shoppers' carts are ever recovered.** A guest cart (`cart:{storeId}:g:{id}`) has no email address anywhere in the system - nothing about a guest is known until they reach checkout - so scanning only matches the `:u:` pattern. This is a deliberate scope boundary, not an oversight, and is exactly what the module's tests check first.
3. **"Abandoned" is read from the cart's own Redis TTL, with no extra field to store or keep in sync.** `cart.service.ts` always resets a cart's TTL to the same fixed `CART_TTL_SECONDS` on every touch, so the remaining TTL is a perfectly reliable proxy for time since the last touch: `inactiveSeconds = CART_TTL_SECONDS - ttl(key)`. A cart inactive for less than `CART_RECOVERY_ABANDONED_AFTER_HOURS` (default 2, the plan's own example) is left alone.
4. **A cooldown, not a permanent "already sent" flag.** The same cart is not emailed again within `CART_RECOVERY_COOLDOWN_HOURS` (default 24) of its last recovery email, even though the job re-scans it every hour while it stays abandoned. This was a real design decision the plan's "Solution" bullet doesn't spell out (it only names the schema, `CartRecoveryEvent`, which has no field for this): the alternative, "send once, ever, per cart key", would wrongly suppress emailing a shopper who abandons the *same* persistent cart key a second time, months later, after having bought something in between.
5. **A defensive re-check for an already-completed order.** The checkout webhook clears a cart's Redis key on a successful order (`stripe.webhook.ts`), so a cart with no matching completed order is normally already guaranteed by the cart key simply still existing - but that clear is fire-and-forget, so the scan independently checks for a recent completed order by the same email before sending anything, exactly as the plan's "Solution" asks for.
6. **The AI orchestrator writes the message**, given the shopper's real cart contents and, if the store has one, an active discount code to mention - never inventing either. This is the first feature to use `promptType: "cart_recovery"`, still a plain `generationsUsed` spend (not the `chat` kind Module 3 uses), and skips gracefully (no email, no log) if the store's quota is exhausted, rather than falling back to a generic, unpersonalized message that was never part of the design.
7. **The email** goes through `lib/email.ts` (SendGrid's REST API directly, no SDK dependency needed for one call), to the shopper's account email (there is no other address to use for a first-time abandoner). A failed send logs nothing, so the very next scan can retry it rather than a delivery failure being silently treated as sent.

## Conversion tracking, honestly scoped

The plan names four outcomes (`sent`/`opened`/`clicked`/`converted`) on the pre-existing `CartRecoveryEvent` schema. Only two are real here:

- **`sent`**: set the moment the email is actually accepted by SendGrid.
- **`converted`**: inferred, on every scan, from a completed order placed by the same email address after a `SENT` event - genuinely meaningful and needs no extra infrastructure. Since a completed order clears its own Redis cart, this check cannot happen inside the same per-cart-key loop that finds abandoned carts (the key is usually already gone by the time someone converts); it is a separate pass over pending `SENT` events instead.
- **`opened`/`clicked`** are **not implemented** and always report 0. Real values would need SendGrid's Event Webhook (an open-tracking pixel and click-tracking redirect, plus verifying SendGrid's webhook signature) - a second integration on top of sending, and a deliberate scope cut for this pass rather than something quietly forgotten.

## What is exposed today

`GET /stores/:id/cart-recovery/performance` (owner, or staff with `analytics_read`): total sent, opened, clicked, converted, and a conversion rate. This is a data endpoint only, matching how `/ai-usage` shipped in Phase 4 before Module 6 wired it into a page - no admin UI was built for it in this pass, since the plan's checklist lists this as a backend-only module.

## A real mistake made and caught while testing: a background job with no ambient tenant context

`cartService.get()` (reused here to price a candidate cart) and the AI orchestrator's own quota bookkeeping both touch Prisma models that require an active tenant context, which every other caller gets for free from `withTenantContext` HTTP middleware. A BullMQ job has no request and no such middleware. The first test run failed on exactly this; the fix wraps each candidate cart's processing in `tenantContext.run(storeId, ...)`, the same primitive the middleware itself uses.

A second, unrelated mistake surfaced while chasing what first looked like a new bug: repeated "Store not found" errors during a supposedly-clean run turned out to be leftover Redis cart keys from an *earlier* test run, made before this module's own Redis cleanup existed, aged with a long TTL and still sitting in the shared local Redis well after their tenant had already been deleted from Postgres. Not a defect in the feature - the scan behaved correctly (skip-and-log, never crash) - but a reminder that this module's own tests must clean up the Redis keys they age, not just the Postgres/Mongo rows, which `verify-cart-recovery.ts` now does.

## Verification

`backend/scripts/verify-cart-recovery.ts` (17 checks, fake AI and email gateways, real Postgres/MongoDB/Redis/BullMQ; cart age is simulated by setting a key's TTL directly rather than waiting real hours): a fresh cart is left alone; an aged one is emailed with the real cart contents and, when one exists, a real discount code, and logged `SENT`; the same cart is not re-emailed inside the cooldown; a guest's abandoned cart is never touched; an emptied cart is skipped; a failed send costs nothing and is retried on the next scan; quota exhaustion is skipped gracefully; a completed order flips a `SENT` event to `CONVERTED`; the performance endpoint, its permission check, and tenant isolation.

## Deliberate limits

- No admin UI for the performance summary yet (a data endpoint only, matching the plan's backend-only scope for this module).
- No `opened`/`clicked` tracking (would need SendGrid's Event Webhook - a second integration, not built here).
- Only signed-in shoppers' carts are recovered; a guest cart cannot be, for lack of any email address.
- The AI-suggested discount is a nudge only - any active store-wide code, not one created or reserved specifically for cart recovery.
