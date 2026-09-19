# Audit of Phases 0, 1 and 2 (2026-09-19)

A full re-check that everything built so far runs correctly, done layer by layer against the real databases, the real servers and a real browser. Problems found were fixed, not just listed.

## Result

Phases 0, 1 and 2 are complete and working. The audit found and fixed **8 problems**, two of them serious enough that they would have affected real users. The one item the audit could not verify, real Stripe, was completed afterwards (see `Stripe_Setup_And_Verification.md`).

| Layer | Check | Result |
|---|---|---|
| Infrastructure | PostgreSQL, MongoDB, Redis running; schema and live database identical (`prisma migrate diff`: no drift); 5 migrations applied; 14 row-level-security policies present | pass |
| Build | Backend and frontend type-check, production build, no CSS or build warnings | pass |
| Phase 0 | Contract validates with Redocly; 13 wireframes, schema and design docs present | pass after fixes |
| Phase 1 backend | `scripts/verify-phase1.ts`, 80 checks (new) | pass |
| Phase 2 backend | foundation 21, checkout 62, orders 63 | pass |
| Phase 1 browser | `e2e/phase1-auth-catalog.e2e.mjs`, 24 checks (new) | pass |
| Phase 2 browser | `e2e/phase2-checkout.e2e.mjs`, 49 checks, 3 runs | pass |
| Repository | no secrets, no generated or environment files tracked, no em dashes | pass |

| Security (added after) | `scripts/verify-security.ts` 27 checks, `e2e/phase1-security.e2e.mjs` 5 checks | pass |

Total: 253 backend checks and 78 browser checks.

## Problems found and fixed

1. **The API contract did not parse.** My earlier em-dash cleanup turned `Valid: ...` into an unquoted colon inside a YAML value, which is invalid. The file had been broken since that commit, and nothing caught it because the code never reads it. Fixed, plus three descriptions of mine with unquoted commas and two Phase 0 `examples` blocks that OpenAPI 3.1 does not allow (they must be lists). The contract now passes the Redocly linter with no errors.
2. **The design fonts never loaded.** In `index.css` the Google Fonts `@import` came after `@import "tailwindcss"`, and CSS ignores an `@import` that is not first. So the whole app has been showing a system font instead of Space Grotesk and IBM Plex Sans since Phase 1. Fixed, and a browser check now proves both fonts load. The same mistake made Vite print a CSS error on every hot update.
3. **Staff management did not match the contract.** The contract defines list and delete, but only create existed, create returned a raw database row with uppercase permissions instead of the documented shape, and an owner could be added as staff of their own store. All fixed: list and delete added (owner only), responses now carry the email and lowercase permissions, and permission names are lowercase on the wire as the contract says. Removing staff takes effect immediately (tested).
4. **Products table columns were misaligned.** Headers sat to the right of their values because the header row's last column collapsed. Fixed with a fixed-width last column, and a browser check verifies the alignment.
5. **Products page had no error handling.** If the API failed it showed "Loading..." forever, and a failed delete did nothing visible. It now shows an error. It also hardcoded `$`; it now formats prices in the store's currency.
6. **Missing accessible names** on the product form's image add and remove buttons and on the row Edit and Delete buttons. Added.
7. **No way to find the storefront.** The admin never showed the shop's address. Added a "View storefront" link to the admin header.
8. **Test debris.** Browser tests register through the UI and could not clean up, leaving 88 test stores. Added `scripts/cleanup-test-data.ts`, which only touches known test prefixes, and ran it. Your own account and store, and the sample accounts from earlier sessions, were left alone.

## Password and abuse protection (added after the audit)

The audit's biggest open gap was that anyone could guess passwords without limit. Reading the auth code also turned up four other weaknesses, confirmed against the live server before fixing:

| Weakness found | Confirmed how | Fix |
|---|---|---|
| Unlimited login guessing | No limit existed | Failed logins only count: 5 wrong passwords for one email from one address blocks that pair for 15 minutes (even the correct password is refused), and 30 failures from one address across any emails blocks the address. Registration is capped at 20 per address per hour and every API call at 600 per minute. Counters live in Redis, so they survive restarts and work across servers. |
| Timing reveals which emails have accounts | unknown email answered in 61 ms, a real one in 371 ms | An unknown email now runs a full password check too (measured 656 ms vs 341 ms). |
| bcrypt silently ignores everything past 72 bytes | code reading | Passwords over 72 bytes are rejected (counted in bytes, so accented characters count double), and the form limits the field to 72. |
| A malformed JSON body returned a 500 | live request returned HTTP 500 | Now a 400; an oversized body is a 413. |
| No security headers, and the server announced "Express" | live response headers | Standard headers added (helmet): no `X-Powered-By`, nosniff, frame protection, HSTS, a content security policy. Uploaded images stay embeddable by the storefront. |
| Production could start with the placeholder JWT secret | code reading | In production the server refuses to start unless the secret is random and at least 32 characters. |

Design choices worth knowing: the limiter **fails open**, meaning if Redis is unreachable logins keep working (tested with Redis down: no crash, no unhandled error) rather than a cache outage locking everyone out. Behind a reverse proxy set `TRUST_PROXY` so limits apply per visitor instead of per proxy. The login page now shows "Too many attempts. Please wait 15 minute(s) and try again." instead of a bare error.

Tests: `scripts/verify-security.ts` (27 checks, tight limits and a private Redis prefix so it never disturbs real counters) and `e2e/phase1-security.e2e.mjs` (5 browser checks, run against an API started with limiting on). All earlier suites still pass: 226 backend and 73 browser checks.

Not done, on purpose: no per-account lockout that a stranger could use to lock a real user out (the limit is per email and address together), no CAPTCHA, no password-strength meter, no email verification or password reset, and no two-factor login. These are product decisions for later.

## Contract versus implementation

Of 48 operations in `openapi.yaml`, 34 are implemented (32 before this audit, plus staff list and delete). The 14 still missing all belong to later phases: reviews (2), AI content and quota (5), discount codes (4), the shopping assistant (1) and analytics (2).

## An intermittent test failure, and what it really was

The Phase 1 browser test failed now and then (about 1 run in 6), always stuck on the registration form. I first suspected the CSS error described above, which turned out to be wrong: it kept happening after that was fixed. A failure screenshot showed the real cause. The **Email field was empty while every other field was filled**. The test clicked "Create one" and typed the email the moment the URL changed, but React had not yet swapped the login page for the register page, so the email went into the old login form's input, which then vanished. It is a race in the test, not a defect in the app. The test now waits for the register page's heading before typing, and it prints a network trace and saves a screenshot whenever a step fails, which is how this was found.

## Not fixed on purpose, and recommendations

- **(Fixed afterwards, see "Password and abuse protection" below.)** The audit originally left login without rate limiting or security headers.
- **Row-level security is defined but not enforced.** The database policies exist, but the API connects as the owning role, which bypasses them, and never sets the tenant variable. Isolation is enforced in application code (and tested). Wiring the database layer is planned for the Phase 7 tenant-isolation work.
- **(Done afterwards.)** Real Stripe was exercised end to end with a test sandbox; see `Stripe_Setup_And_Verification.md`.
- **Cosmetic contract warnings remain** (no license field, and 4XX responses not declared on some operations). They do not affect correctness.
- **Every anonymous visit logs one harmless 401** in the browser network panel (the silent login restore finds no cookie).
- **The published Claude Design canvas** was not republished after the em-dash edits to the wireframe source files, so it may still show the old dashes.
