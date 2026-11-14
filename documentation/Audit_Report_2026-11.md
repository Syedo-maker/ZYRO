# ZYRO audit report, November 2026

What was fixed, what the security audit and health check found, what was changed because of it, and what is left for you to decide or do.

| | |
|---|---|
| Date | 2026-11-06 to 2026-11-08 |
| Branches | `fix/known-items` (PR #41), `feature/password-reset` (PR #42), `feature/ux-polish` (PR #43), `audit/full-project-check` (PR for the audit fixes). Each one is stacked on the one before, and all of them are stacked on PR #40. |
| Nothing merged | Every change is on a branch with a pull request. Nothing is merged and nothing is deployed. |
| Audit output | Outside the repository, in `C:\Users\User\security-audit-skill\ShopMind\run-1\`: `REPORT.md`, `findings.json`, `coverage-ledger.json`, `NEEDS-VALIDATION.md`, `FINDINGS-DETAIL.md` and `architecture.md`. |

## 1. Known items and features (A1 to B5)

Every item was tested in a real browser and has its own automated test. The full browser suite was run three times; the results are in section 6.

| Item | What was done | Tests | PR |
|---|---|---|---|
| A1: AI key check, one friendly failure message, fallback | `npm run ai:check` names the variable that is missing or rejected. It never prints a key. Any AI failure reaches the user as one plain sentence, and nothing from their allowance is used. OpenAI can be added as a fallback provider. | `ai-providers.test.ts` (34), `ai-fixes.test.ts` | #41 |
| A2: Product Scout demo data stays recent | Demo sales move forward by whole days, so the newest is always yesterday. This runs on the daily refresh, as a catch-up run, and through `npm run demo:scout:refresh`. | `demo-dates.test.ts`, `e2e/product-scout` | #41 |
| A3: one budget filter for the assistant's answer and its cards | One reader (`lib/budget.ts`) works out the budget, and one filter applies it to both the answer and the cards. A budget in another currency is ignored rather than guessed. | `budget.test.ts` (30), 6 checks in `assistant.test.ts` | #41 |
| A4: flaky directory browser check | The real cause was fixed: the test now waits for the right page. There are no retries and no longer sleeps. It passed 20 runs out of 20. | `e2e/roles-and-ideas` | #41 |
| B1: forgot and reset password | Covers every account type. Tokens are hashed and expire after 30 minutes. Each link works once, and a newer link cancels older ones. The answer is the same whether or not the email exists. Requests are rate-limited by address and by email, and a reset signs the account out everywhere. In development without email, the link is written to the console. This adds a new table (migration plus rollback script). | `password-reset.test.ts` (13), `e2e/password-reset` | #42 |
| B2: 404 page and error page | A real 404 page appears at the wrong address, and its button goes to the right home for the visitor. A page that breaks shows an error page instead of a blank screen. The API's JSON 404 and its safe 500 are now covered by tests. | `error-responses.test.ts`, `e2e/error-pages` (12 checks) | #42 |
| B3: one toast system | Success, error, warning and info toasts. They close themselves after 4 or 5 seconds, have a close button, stack, are read out once to screen readers, and respect reduced motion. Inline notices are kept. | `toasts.test.ts` (8), `e2e/toasts` (15) | #43 |
| B4: assistant suggestion chips | Four questions, including a budget in the shop's currency. A chip uses the same request as a typed message, so it has the same quota, rate limit and permissions. The chips work from the keyboard, wrap on a phone, and show the friendly "unavailable" sentence. | `assistantSuggestions.test.ts`, `e2e/assistant-chips` (16) | #43 |
| B5: light mode with a Dark / Light / System toggle | Dark is the default. There is no flash of the wrong theme on load: a CSP-safe script runs before the first paint. Every colour comes from the tokens. In light mode lime is only ever a fill with black text on it. Merchant colours adjust to the theme. Contrast passes WCAG AA in both themes. | `themeContrast.test.ts`, `theme.test.ts`, `brandTheme.test.ts`, `e2e/theme`, `e2e/a11y-audit` in both themes (0 issues) | #43 |

## 2. Security audit: how it was run

The Cloudflare `security-audit` skill was run in full audit mode on the whole repository:
- 4 reconnaissance agents;
- 10 hunters covering 20 coverage units;
- 1 coverage critic;
- 4 independent verifiers;
- the skill's two validators, which both pass: 19 findings and 27 coverage units.

**What the skill could not do here, exactly:**
- **No code execution inside the audit.** The skill only allows running target code inside an OS-enforced sandbox, and this Windows machine has none. So no audit agent ran the project, and every record that needed running stayed "needs validation". In the skill's terms that means 0 confirmed, 18 needs validation and 1 rejected.
- **Validation was merged.** The standard profile verifies each candidate twice with separate fresh agents. Here each candidate got one fresh verifier for both checks, which the skill's quick profile allows. The usage limit stopped the agents twice, and this kept the run within budget.
- **The second hunting wave was not run.** The critic found 7 more areas worth covering, and they are recorded as deferred (section 5). This audit is therefore a **partial pass**, not complete coverage.
- **The validators would not run on Windows**, because they need no-follow file reads. They were run in a local Linux container with no network and read-only mounts.
- **Small install quirk:** the AI and LLM companion file was installed as `33.md`, not `AI-AND-LLM.md`. It was used under that name.

**Afterwards, outside the skill:** you allowed running the project's own tests against local test data only. Each finding below marked "reproduced" was first shown to fail on the old code with such a test, then fixed, and the same test passes now. These local runs are not the skill's evidence, so they do not change its verdicts.

## 3. Findings

**Severity** is my assessment from the local reproduction. The skill gives no severity to a needs-validation record.

**Status:**
- **Fixed**: the fix is in place and its test passes.
- **Decision**: changing it would change behaviour, the schema, a deployment, or a product rule, so it is listed in section 4 instead.

| # | Finding | Area | Severity | Status | Commit and test |
|---|---|---|---|---|---|
| 1 | A signed-in shopper who typed someone else's email at checkout was linked to that person's customer record, and so saw their earlier orders, address and phone | Orders, customers | High | Fixed (reproduced). Remaining: accounts are not email-verified (decision D2) | `fa6ecb0`, `audit-fixes.test.ts` |
| 2 | A partial till return racing a whole-order refund paid back more than the sale took | Refunds | Medium | Fixed (reproduced, forced interleaving) | `cba8c67`, `audit-fixes.test.ts` |
| 3 | Recording a cash-on-delivery outcome twice at once restocked twice and counted two refusals on the shared phone signal; a cancelled order could be marked collected | Payments | Medium | Fixed (reproduced) | `efc3870`, `audit-fixes.test.ts` |
| 4 | Re-using a transfer reference bought a platform-paid AI vision call every time, without limit | AI cost | Medium | Fixed (reproduced: 3 extra AI calls) | `e220856`, `audit-fixes.test.ts` |
| 5 | The chat limit was keyed on a guest id the caller chooses, so one client could spend a store's whole chat allowance and its bought top-ups | AI cost | Medium | Fixed (reproduced): a per-address limit was added | `3ac7933`, `chat-limit.test.ts` |
| 6 | The public payment-failure help called platform-paid AI with no limit, even for a store that does not exist | AI cost | Medium | Fixed (reproduced): a per-address limit, and real stores only | `c714a9d`, `chat-limit.test.ts`, `audit-fixes.test.ts` |
| 7 | The landing demo's saved-example path called the AI outside the daily ceiling | AI cost | Low | Fixed (reproduced) | `1a73ee3`, `audit-fixes.test.ts` |
| 8 | When an AI request timed out, the job kept running and spent money that was never counted | AI cost | Low | Fixed (reproduced). Refunded at once; charged only if the job really finishes | `383a869` and `102b7ef`, `ai-timeout.test.ts`, `dependency-failures.test.ts` |
| 9 | The assistant's conversation id outlived a sign-out, so the next person on a shared browser continued the previous chat | Privacy | Low | Fixed in the browser. Binding it on the server is decision D9 | `a1cd455` and `6187da2`, `assistantId.test.ts` |
| 10 | nginx wrote password-reset tokens to its access log, both in the request and in the referrer of the page's own files | Logs | Medium | Fixed (reproduced in a local nginx container) | `ca5308e`, `nginxConfig.test.ts` |
| 11 | The deploy workflow would have accepted a fork's pull request named `main` and released it with the staging cloud identity | CI | High while deploy is on (it is off today) | Fixed | `4251a06`, `deploy-workflow.test.ts` |
| 12 | A login or refresh that was already under way when a password reset finished kept a valid session | Auth | Medium | Decision D1 (needs a schema field) | none |
| 13 | `TRUST_PROXY=3` may let a visitor choose the address that every rate limit counts by, if Azure's ingress adds fewer forwarding hops than assumed | Deployment | Unknown until staging | Needs validation on staging (to-do T6) | none |
| 14 | `compose.yaml` contains a JWT signing secret that the production start-up check accepts | Config | Low (port is bound to loopback) | Decision D3 | none |
| 15 | Trend Scout keyword figures can be subtracted from each other to reveal one store's sales | Privacy | Medium | Decision D5 | none |
| 16 | Product Scout and Trend Scout count free, unverified shops, so one person with several shops can isolate another shop's sales | Privacy | Medium | Decision D6 | none |
| 17 | Anonymous searches across 5 shops can put chosen words into every merchant's AI keyword list | AI content | Low | Decision D7 | none |
| 18 | Any store can move the shared cash-on-delivery phone signal that other stores use. With default settings it cannot block anyone | Payments | Low | Decision D8 | none |
| 19 | Cart-recovery emails include the store's newest discount code | Product | None | Rejected by the verifier: documented as intended, and codes have no private setting | Product idea in D10 |

**Health check fixes:**
- 21 backend variables and 2 recommendation-service variables were read in code but missing from `.env.example`; all are now documented (`820741b`).
- The e2e test server listened on every network interface; it now listens on loopback only and refuses production (`d79a9f7`).
- The directory test relied on the database being nearly empty (`471e6b6`).

**Dependency fixes:**
- 8 backend packages: multer, body-parser, qs, ip-address, the Azure identity packages and ts-jest (`ad95d8a`).
- Vite and its bundler: the frontend now shows 0 known vulnerabilities (`71b7054`).
- fastembed 0.9.1 and Pillow 13.0.0: the 39 Pillow CVEs are gone and pip-audit is clean (`5064e9c`).

## 4. Needs your decision

These would change behaviour, the database schema, a deployment, or a product rule, so I did not make them.

| # | Decision | Recommendation |
|---|---|---|
| D1 | After a password reset, an access token that was already issued keeps working for up to 15 minutes, and a login or refresh in flight can keep a session (finding 12). Closing both needs a `sessionVersion` (or `passwordChangedAt`) column checked when a session is issued and on refresh. | Add it. One small migration and one check per refresh. |
| D2 | Accounts are not email-verified, so someone could register an unclaimed email and inherit that guest's customer record (what remains of finding 1). | Add email verification before an account is linked to existing guest orders. |
| D3 | `compose.yaml` falls back to a committed JWT secret, and also a committed recommendation-service token (finding 14). | Require `ZYRO_JWT_ACCESS_SECRET` (`${VAR:?}`). This adds one setup step to the one-command `docker compose up`. |
| D4 | `COD_PHONE_PEPPER` falls back to a public value, which makes the shared phone hashes reversible. | Refuse to start in production without it, and add it to Key Vault and Bicep. |
| D5 | Trend Scout figures can be subtracted (finding 15). | Add the same remainder check Product Scout already has, so a figure is withheld when subtracting it from another would reveal one store. |
| D6 | The anonymity rules count unverified shops (finding 16). | Decide whether several shops run by one person are in scope. If so, count verified or older shops only. |
| D7 | The shopper-search keyword source (finding 17). | Add the market, demo and opt-out filters the other sources use, and count each search once per shop per day, as Privacy_Notes.md already says it does. |
| D8 | The shared cash-on-delivery phone signal trusts each store's own report (finding 18). | Count at most one outcome per store per phone. This changes the table. |
| D9 | The assistant's conversation id is trusted by whoever holds it (finding 9). | Bind it to the cart owner on the server. |
| D10 | Cart-recovery emails use any active discount code (finding 19). | A "use in recovery emails" switch per code. |
| D11 | Cancelling a pending cash-on-delivery or bank-transfer order neither puts the stock back nor settles its payment. The coverage critic found this, and it was not tested. | Restock and mark the payment failed when cancelling a pending order. |
| D12 | Major upgrades: Prisma 7 (an advisory via deepmerge-ts) and zod 4 (an advisory on oversized collections). | Plan both. Each is a breaking upgrade that needs its own branch and a full test run. |
| D13 | `frontend/dump.rdb` (a local Redis snapshot: 651 AI job entries and no secrets) is still in git history. | Removing it means rewriting history and force-pushing. Only worth it if the repository becomes public. |
| D14 | Smaller hardening items, none of them a finding: restrict image and logo URLs to https; check that the private uploads folder is not inside the public one; switch off the recommendation service's `/docs` and `/openapi.json`; refuse the mock gateway's fallback secret; narrow the recommendation identity's Key Vault access to its own two secrets; pin GitHub Actions and base images by hash. | Do them as one hardening branch. |

## 5. What was not covered

- **The 7 areas the critic proposed, deferred:**
  - order status changes, including cancellation;
  - receipt routes that are reached by order id alone;
  - COD risk worked out from a typed email;
  - other uses of the unverified account email;
  - plan entitlements after a plan lapses;
  - public directory and platform readers;
  - data retention and deletion.
- No code execution inside the skill (no sandbox). No live or deployed system was probed: nothing is deployed.
- The Azure Bicep files could not be validated, because the `az` CLI is not installed.
- **Browser suites not run:**
  - `stripe-real` and `stripe-discount`: they call real Stripe;
  - `smoke`: it needs the production Docker images built;
  - `visual-capture`: a photo tool, not a test.

## 6. Verification

All runs are on the final code of `audit/full-project-check`.

| Check | Result |
|---|---|
| Backend type check | Clean, for both source and tests |
| Backend tests (full Jest suite) | 2,071 passed, 5 skipped (the Azure storage tests, which need Azurite), 0 failed |
| Frontend type check, lint, unit tests, build | tsc clean; lint 0 errors (42 warnings, the same as before this work); 181 unit tests pass; production build passes |
| Recommendation service | 20 pytest pass; the real embedding model loads offline |
| Dependency audits | Backend npm audit: 11 left (4 high, which need the Prisma 7 and zod 4 majors, decision D12; 7 low, dev-only jest). Frontend npm audit: 0. pip-audit: 0 |
| Browser suites, 3 rounds | 33 suites plus the accessibility audit in both themes: 102 runs. 96 passed first time. All 6 failures were explained and now pass (below) |
| Accessibility audit, both themes | 0 issues in each of the 3 rounds, about 2,190 text elements measured for contrast on each pass |
| Security-audit validators | Both pass (19 findings, 27 coverage units) |
| Re-check of the fixes | A fresh read-only agent rated 5 fixes closed, 6 partial and none open. One gap it found was fixed (`6187da2`). One residual it raised does not hold: partial returns exist only on till sales, which never use Stripe. The others are in section 4 |
| Leftover search | No em dashes, no raw colours and no secret-shaped strings in the 27 files this branch changes |
| Test data | Cleaned after the browser runs; your 10 real stores and 17 real users are untouched |

**The first full backend run had 34 failures in two suites:**
- `dependency-failures`: it showed my first AI-timeout fix broke a deliberate rule (nothing charged for an attempt that produced nothing). Corrected in `102b7ef`.
- `roles-and-ideas`: 68 leftover test shops pushed the test's shop off the first directory page. The test now searches for its own shop (`471e6b6`).

**The 6 browser failures:**
- `phase1-security`, all 3 rounds: it tests the login rate limit, which the e2e server switches off by default. With the server started with limits on, as the suite's own header says, it passed 3 out of 3.
- `partD-trends`, rounds 2 and 3: the week's reports already existed from round 1, because reports are once per week. With the cleanup script run between runs, it passed 3 out of 3.
- `golden-path`, once: the test read the till's price before it had rendered. Fixed (`74fdcbf`), then 3 out of 3.

The theme suite checks both themes at 390 px wide, with no sideways scrolling and no script errors. Its screenshots are in `frontend/e2e/shots/theme-*.png` (git-ignored).

## 7. Things only you can do

1. **Replace the Anthropic key.** The current key is rejected by Anthropic (HTTP 401). Put a valid key in `backend/.env` as `ANTHROPIC_API_KEY`, restart the API, then run `npm run ai:check` in `backend`. It should say `ANTHROPIC_API_KEY: ok`.
2. **Optional:** add `OPENAI_API_KEY` as a fallback provider, and set `AI_PROVIDER_ORDER` if OpenAI should go first. Check it with `npm run ai:check`.
3. Email is set to Brevo (`EMAIL_PROVIDER=brevo`), and its key was valid when last checked. The reset emails use it.
4. Before any deployment, set `COD_PHONE_PEPPER` to a long random value (or decide D4).
5. **GitHub settings to confirm:**
   - fork pull requests need approval before their workflows run;
   - the `staging` environment has required reviewers;
   - `DEPLOY_ENABLED` stays unset until you deploy.
6. **On staging, before going live:** send one request with a made-up `X-Forwarded-For` header and confirm the API logs your real address (finding 13).
7. **Merge order when you are ready:** #40, #41, #42, #43, then the audit PR, each into the one before it. Nothing has been merged.

## 8. Is it safe for a demo?

Yes, for a demo on this machine with the local test and demo data, with one exception: every AI feature answers "temporarily unavailable" until a valid Anthropic key is in `backend/.env` (to-do 1). Everything else, including password reset, the 404 page, toasts, the chat chips and light mode, works and is tested.

It is **not** ready for real customers yet:
- 14 decisions are open, including session revocation after a password reset, email verification, the compose secret, and the COD pepper;
- the security audit was a partial pass, with 7 areas deferred and no code executed inside the audit;
- nothing is deployed.
