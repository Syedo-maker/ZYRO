# Security review: Phase 0 through Phase 4 (AI Orchestrator)

At the user's request, a full audit of everything built so far (not just an uncommitted diff, since the working tree was clean): authentication and multi-tenancy, Postgres row-level security, Stripe payments and webhooks, POS cash handling, discount codes, search, reviews, analytics, the AI Orchestrator, and the storefront/admin frontend.

`/find-skill` was run first, per process: the bundled `security-review` skill already covers this, so no external skill search or install was needed.

Four reviewers went over the codebase in parallel, one per area (auth/multi-tenancy/RLS, payments/POS/discounts, catalog/search/reviews/analytics/AI, and the frontend), each reading the real code before reporting rather than guessing, and each finding was checked for an existing mitigation before being counted. Findings below meeting a real, currently-exploitable bar were fixed; sub-threshold notes worth hardening were fixed too, since they were cheap and the user asked for weak points, not only confirmed vulnerabilities.

## Fixed: discount code usage-limit bypass (confidence 8/10)

**The bug.** `discount.service.ts`'s `assertCanHold` (the check that runs when a checkout session is created with a code) excluded the shopper's own cart from the "how many uses are currently held" count, so that retrying an abandoned checkout would not block the same shopper. The exclusion was unconditional: it excluded *every* pending session the shopper's cart already had, not just the one being retried.

**The exploit.** A shopper (or an unauthenticated guest, since guest checkout needs no account) could call `POST /stores/:id/checkout/session` with a code repeatedly without ever paying. Each call created a new held reservation; their own next call never saw their own prior holds, so nothing stopped them from holding a "1 use" code's only use across as many parallel, unpaid Stripe Checkout pages as they liked, then paying all of them. Each webhook redeemed the code in "honour" mode, which trusts that the hold was legitimate and does not re-check the limit. A code meant for one redemption per shopper (or ten total, storewide) could be redeemed many times over by one determined shopper, with no price tampering involved (each order was honestly priced), so it would not have been caught by the amount-matches-record check that guards against a different class of attack.

**The fix.** Starting a new checkout for a cart now supersedes that cart's own earlier pending discount holds first: the old Stripe Checkout Session is expired via the Stripe API, and only once Stripe confirms it can no longer be paid is the old row marked `FAILED` in the database. If expiring fails for any reason (already paid, already expired, a network error), the old row is left exactly as it was, so it still counts as a real reservation and the new attempt is judged honestly rather than the vulnerability's fail-open behavior. With that in place, `assertCanHold` no longer excludes anything: it counts every currently-held reservation, because there is now never more than one live hold per cart to wrongly exclude. The order matters here on purpose: expire-then-mark-failed (not mark-failed-then-expire) means a shopper genuinely mid-payment on an older tab is never silently short-changed of an order Stripe actually charged them for.

Files: `backend/src/lib/stripe.ts` (new `expireCheckoutSession` method on `StripeGateway`), `backend/src/modules/checkout/checkout.service.ts` (`createSession`), `backend/src/modules/discounts/discount.service.ts` (`assertCanHold`).

**Verification.** `backend/scripts/verify-discounts.ts` gained a check that a retry supersedes rather than adds to a shopper's held reservations, and a dedicated reproduction of the original exploit: the same shopper retries a "1 use" code five times without paying, and only the most recent attempt is ever held (the other four are superseded), while a genuinely different shopper is still correctly refused. All 108 checks in that suite pass, including the pre-existing race, honour-mode, and POS tests, which needed no changes.

## Fixed: AI quota check-then-increment race (not yet reachable, hardened anyway)

The AI Orchestrator's `generate()` checked remaining quota, then enqueued a job, then incremented usage only after it succeeded. Two concurrent calls could both pass the check before either had incremented, letting a tenant exceed its hard monthly limit. Nothing calls `generate()` yet (Module 6, which will, has not been built), so this was not currently exploitable, but it was fixed before that changes: the check and the increment are now one atomic conditional `UPDATE ... WHERE used < limit` (`reserveQuota`, raw SQL, the same idiom `discount.service.ts` already uses for the equivalent problem), so two racing callers can never both succeed past the limit. A failed generation still gives its reservation back (`releaseQuota`), so the "a failed generation costs nothing" guarantee is unchanged.

Files: `backend/src/modules/ai/ai.quota.service.ts`, `backend/src/modules/ai/ai.orchestrator.ts`. Verified by the existing `verify-ai.ts` suite (16 checks, all still passing; observable behaviour is unchanged, only the internal mechanism is now atomic).

## Checked and found solid (no fix needed)

- **Tenant isolation.** Every route touching tenant-scoped data has `withTenantContext` and the right permission check; the Prisma tenant-scoping extension is applied everywhere it should be; every use of the unscoped Prisma client (`prismaUnscoped`) matches its documented narrow exception (a caller's own cross-tenant self-lookup, or the Stripe webhook's necessary bootstrap before a tenant is known, which immediately re-enters the scoped client). No IDOR, no missing permission check, no raw-SQL injection (all raw queries are Prisma tagged-templates, which parameterize).
- **JWT and passwords.** HMAC-signed access tokens with a validated production secret, hashed and rotated refresh tokens, bcrypt cost 12, login timing equalized against account-existence probing.
- **Stripe.** Webhook signature verification runs on the untouched raw body before anything else executes, with no path that skips it. Every amount charged, discounted, or refunded is computed server-side and re-checked against what Stripe actually reports; nothing is ever taken from client input. Webhook and POS-sale idempotency both hold up against retries and doubled requests.
- **POS.** Cash tendered, change due, and discount caps are all server-computed or server-enforced; a cashier's request cannot forge any of them.
- **Catalog, search, reviews, analytics.** Every user-controlled filter goes through Zod validation before reaching a database query; the two Mongo aggregation pipelines in these modules both scope by `storeId` explicitly; the one place regex is built from user input escapes it first; all four analytics raw queries use parameterized `$queryRaw`.
- **Frontend.** No `dangerouslySetInnerHTML` or equivalent anywhere; the access token lives only in memory (never localStorage), the refresh token is an httpOnly cookie; the one user-controlled redirect target (`next` on the account pages) is allowlisted to the same store; no hardcoded secrets.
- **Guest cart sessions.** `X-Guest-Session-Id` is generated with `crypto.randomUUID()` (a CSPRNG, 122 bits), confirmed by reading `frontend/src/lib/guestSession.ts` directly rather than assuming.

## Known, pre-existing, deliberately not changed here

- **Postgres RLS is currently inert.** The policies in `prisma/manual-sql/*.sql` reference a session variable (`app.current_tenant_id`) that nothing in this codebase ever sets, and the API connects as the database owner, not the restricted role the policies assume. This was already the documented state from Phase 0 (the app-layer Prisma extension is what is actually enforced; RLS was always framed as a defense-in-depth second layer, not yet wired up). It is not a new finding, and app-layer tenant isolation was independently verified to hold everywhere by this review. Wiring RLS up for real would mean a dedicated non-bypassing database role and `SET LOCAL app.current_tenant_id` on every request's transaction, which is a real, separate piece of work if wanted, not a quick fix, so it was flagged rather than silently done.

## Also fixed while testing: two flaky (not broken) frontend checks

Rerunning the Phase 3 browser suite to confirm the checkout fix caused no regression surfaced two pre-existing flaky checks, unrelated to anything in this review (a review's star rating and its "Verified purchase" badge, both asserted immediately after an action with no wait for the page's async re-render). Root-caused and fixed with an explicit wait in `frontend/e2e/phase3-storefront-admin.e2e.mjs`; confirmed stable over two clean reruns (91/91) afterward.

## Verification summary

All 11 backend suites pass (668 checks total, up from 663: +5 in `verify-discounts.ts`), both browser suites touching payments/discounts pass clean (phase 2 checkout 49/49, Phase 3 91/91), and both apps typecheck and build with zero errors.
