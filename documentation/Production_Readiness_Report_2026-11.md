# Production readiness report (November 2026)

What was checked and changed to get ZYRO ready for a small public beta, what was verified by running
it, and what is left. How to run and operate it is in the README, "Running it in production".
Nothing has been deployed.

**Pull requests**, stacked, to be merged in this order after #45: #46 (baseline and settings), #47
(containers and reliability), #48 (payments and outside services), #49 (CI/CD and operations), #50
(business pages, SEO, this report).

## By step

| Step | What | Result | Verified by |
|---|---|---|---|
| 0 Baseline | Tests, lint, build, browser specs before any change | Green, recorded in #46 | Full runs |
| 1 Platform check | Permissions, tenant isolation, error paths | Two permission checks could leave a request hanging on a database error: fixed | New tests |
| 2 Settings | One checked list of settings; clear start-up errors; secrets from files; `.env.example` per service and environment | Done | `env-check.test.ts`; starting with missing settings |
| 3 Containers | Pinned images, non-root, health checks, restart policy, dev stack with live reload, stateless API | Done | Both compose stacks from scratch; two API copies, one killed under load: 0 failed requests |
| 4 Reliability | Circuit breakers on Stripe, email, AI, storage, recommendations; request size and pool limits; HTTPS redirect; load test | Done | Tests; load: browsing about 100 req/s, checkout 58/s, AI 12.8/s per worker at concurrency 4, sign-in 3/s per copy |
| 5 Payments | Works without Stripe (cash on delivery and bank transfer only); fast answer with no AI; webhooks idempotent | Done | `payments-without-stripe.test.ts`, browser spec without Stripe |
| 6 CI/CD | Migration safety, drift and rollback checks, gitleaks over history, browser smoke tests, images on `main`, Dependabot, CODEOWNERS, PR template | Done | Green CI on GitHub for #48 and #49 |
| 7 Operations | Backups with tested restore, JSON logs with store id, error tracking, metrics, alerts list, AI kill switch and daily caps, data export and erasure, retention, admin scripts | Done | Restore drill (41 tables, 5 collections equal); tests for each |
| 8 Business | Shop policy pages with templates; platform Terms and Privacy marked as template; contact page; cookie notice; unsubscribe in cart reminders; titles, canonical, noindex, robots.txt, sitemap, link previews; Pakistan checks | Done | `store-policies`, `unsubscribe`, `seo` tests; `production-pages.e2e.mjs` (28 checks) |
| 9 Docs | This report and the README section | Done | |
| 10 Verify | See below | All green; details below | |

**Pakistan checks.** Prices show as Rs 450 (paisa only when present), in link previews too. Phone numbers
match whether written 0300..., +92300... or 0092300.... The country defaults to PK and the postal code is
optional. Cash on delivery and bank or wallet transfer work with no card provider. Daily totals use the
shop's own time zone. The first page load is about 130 KB compressed (script and styles) and fonts are
served by ZYRO itself, so nothing waits on a third-party font service. Shared links on WhatsApp get a
preview page with the product, its price and photo (tested with WhatsApp's user agent). Policy templates are written for couriers, cash on delivery and rupees.

**Domain.** The platform runs on one domain, with shops at `/store/<id>`. The web server is the only
public entry: it serves the app and forwards `/api`, so the sign-in cookie stays first-party. Emails link
to `STOREFRONT_URL`. Shops on their own domain (`customDomain`, a Business plan field) are stored but not
routed yet: that needs per-domain TLS and a host lookup in the web server, and is listed below.

## Verification (STEP 10)

| Check | Result |
|---|---|
| Lint, type-check, build (frontend, backend) | Pass. Frontend lint: 0 errors, 47 warnings (all existing before this work) |
| Backend tests | 2,248 passed, 5 skipped (the Blob Storage suite, which needs Azurite: 8 of 8 against a local Azurite, and green in CI), 0 failed. Python: 20 passed |
| Frontend unit tests | 216 of 216 |
| Every browser spec, three runs in a row | 35 of 35 specs, three runs in a row, no failures |
| Production images (compose), smoke test at desktop and 390px | 40 of 40: sign-up, Blob Storage upload, bank-transfer receipt, recommendations, robots.txt and sitemap through nginx, a WhatsApp link preview, the browser journey, the shop, product page and checkout at 390px, and a restart (back in 4.9 s, shut down cleanly, data kept) |
| Restart, and one of two API copies killed under load | Two API copies under load (browse, 20 connections, 40 s): one killed mid-run, 2,520 requests, all answered 200, 0 failed |
| Secret scan (gitleaks, whole history) and debug code | gitleaks: 184 commits, no leaks. No debug code, `.only`, or committed `.env` file in the changes |

## Things you must do yourself

1. Have a lawyer review the Terms, the Privacy Policy and the shop policy templates; then set
   `reviewedByLawyer: true` and the operator's legal name in `frontend/src/lib/legal.ts`, and confirm the
   reply time promised on the contact page.
2. Choose a host, a domain and HTTPS; set `PUBLIC_URL`, `CORS_ORIGIN` and `STOREFRONT_URL` to it.
3. Create the production secrets in the host's secret store, never in a file: `JWT_ACCESS_SECRET`,
   `COD_PHONE_PEPPER` (set once, before the first order), `METRICS_TOKEN`, database passwords.
4. Email: verify the sending domain with SendGrid or Brevo (SPF, DKIM and DMARC), or cart reminders and
   reset links will land in spam.
5. Stripe: live keys and the webhook endpoint, or launch without card payments (it works).
6. AI: a provider key with a monthly spending limit set at the provider, and the daily limits
   (`AI_DAILY_STORE_LIMIT`, `AI_DAILY_GLOBAL_LIMIT`).
7. Backups: schedule `ops/backup.sh` daily to storage off the database host; do the first restore drill
   on the real host; turn on soft delete for Blob Storage.
8. Monitoring: an error-tracking project (`SENTRY_DSN`), a metrics collector, and the alerts in the README.
9. GitHub: protect `main` (pull request with one approval, the CI checks required: Backend, Frontend,
   Recommendation service, Browser smoke tests, Secret scan, Production images; no force pushes or
   deletion; branches up to date before merging); turn on secret scanning push protection and Dependabot
   alerts; add a second code owner.
10. After launch, submit `/sitemap.xml` in Google Search Console.
11. Run `npm run ai:check` and the AI features end to end once a real key is in place (not yet done).

## Needs your decision

| Decision | Recommendation |
|---|---|
| `COD_PHONE_PEPPER` required in production (today a warning) | Make it required |
| Daily AI limits (off by default) | 200 requests per store, 5,000 for the platform, then adjust to the budget |
| `AI_WORKER_CONCURRENCY` (default 4) | 8 for the beta: the provider is the limit, not the machine |
| Password hashing with bcryptjs at cost 12 (about 3 sign-ins per second per API copy) | Keep for the beta; switch to native bcrypt if sign-in traffic grows |
| A Pakistani gateway (JazzCash, Easypaisa, Safepay): interface and contract test exist, not wired | Wire it with the first provider whose merchant account you have |
| Plans without Stripe | Plan changes by a platform admin during the beta |
| "Secure checkout by Stripe" in every shop's footer, even when card payment is off | Show it only when card payment is available |
| Store deletion and data export by the owner (today operator scripts) | Keep scripts for the beta; add a settings page later |
| Soft delete (today deletion is final, after an export) | Not for the beta |
| Shops on their own domain | After the beta; needs per-domain TLS |
| Unsubscribe links are signed with a key derived from `JWT_ACCESS_SECRET` | Keep; rotate that secret only when needed |
| Prisma 7 and zod 4 upgrades | After the beta |
| Keyword suggestions ignore the shop's market | Accept for the beta (PKR shops are the target) |
| Server-side page caching and a per-store product text index | Not needed at beta traffic; revisit with the metrics |
| The existing Azure deploy workflow | Keep; it does nothing unless `DEPLOY_ENABLED` is set |

## Not checked

- Real card payments, real emails and real AI calls (no live keys were used).
- A real host: no deployment, so TLS, the host's networking and its backups are untested.
- A real WhatsApp or Facebook fetch of a shared link (tested with their user agents against nginx).
- Real phones on a slow mobile network (checked at 320, 390 px and desktop in Chromium).
- Load beyond one development machine.

## Readiness

**Ready for a small, invited beta on one host** once items 1 to 9 of "Things you must do yourself" are done. Every check above
was run and passed. It is **not ready for an open public launch** until the legal pages are reviewed and the first weeks on the
real host have shown the backups, email delivery and alerts working.

**Biggest risk:** nothing has run on a real host yet. The first deployment is the first time TLS, the managed databases, the
backup schedule and email delivery meet real conditions. Do a full staging run first, including a restore drill and one real
cart reminder email, before inviting shops.
