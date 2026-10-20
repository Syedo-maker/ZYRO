# ZYRO: Production Readiness Programme

Started 2026-10-20. The goal is to take ZYRO from a working final year project to a product that can
be sold and run for real on Microsoft Azure.

This is a running record, one section per phase, kept alongside the work rather than written up
afterwards. Each phase ends with a test gate.

| Phase | Content | Status |
|---|---|---|
| 0 | Groundwork: skills, baseline | done |
| 1 | Rebrand ShopMind AI to ZYRO | done |
| 2 | One design system for the whole platform | |
| 3 | Production hardening | |
| 4 | Whole-system workflow tests | |
| 5 | Azure deployment structure | |
| 6 | Smoke tests on a local production stack | |
| 7 | Documentation and handover | |

## Decisions taken before starting

| Question | Decision | Why |
|---|---|---|
| Should storefronts wear ZYRO's colours or the merchant's own? | **The merchant's own.** ZYRO colours belong to the platform: the landing page, the dashboard, the register, the directory. | A storefront is the merchant's shop, not ours, which is how established platforms work. It also fixes a latent bug: `Tenant.themeColor` could be set but was never applied anywhere. |
| Which MongoDB on Azure? | **MongoDB Atlas, in an Azure region.** | Cosmos DB for MongoDB vCore supports weighted text indexes, but its text index is case-sensitive, which would silently change what product search returns. Atlas is genuine MongoDB and carries no such risk. |
| How many environments? | **Staging and production.** | Every change is proved on staging before it reaches paying merchants. |
| How far does the rename go? | **Everything a user sees.** "ShopMind AI" remains only as the academic project title in the proposal and report. | One product name everywhere a customer looks. |

## What the review found before any work began

Eight things a real deployment would hit, each verified in the code:

1. Uploads are written to the container's local disk, which Azure discards on every restart.
2. Payment receipts and voice notes are served from a public folder; bank-transfer receipts carry
   names and account details.
3. No graceful shutdown, so in-flight requests and AI jobs are cut off when a container stops.
4. No request timeout, so a request can hang indefinitely.
5. `/health` reports "ok" without checking any dependency.
6. The AI and cart-recovery workers run inside the API process and cannot scale on their own.
7. The frontend's 86 API calls are never checked against the server's routes, and response shapes are
   never checked against the contract.
8. The merchant's theme colour is stored and never applied.

Also on record: the Prisma migration checksum drift in the development database, the recommendation
model downloading itself again on every container start, and the rate limiter needing correct proxy
settings behind Azure's ingress.

A three-week-old backend error log added two more: the development Redis is the abandoned 5.0.14
Windows port while BullMQ wants 6.2 or later and Azure Managed Redis runs 7.x, and a second backend
started on a busy port crashed with an unhandled error rather than a clear message.

## Two Azure facts that changed the plan

- **Azure Cache for Redis can no longer be created.** Its creation cutoff for new deployments was 1
  October 2026, so ZYRO uses **Azure Managed Redis**. Compatibility with BullMQ is tested in Phase 6.
- **Cosmos DB for MongoDB vCore's text index is case-sensitive**, which is what decided the MongoDB
  question above.

---

## Phase 0: Groundwork

### Skills

Six skills were installed from Microsoft's official
[`microsoft/azure-skills`](https://github.com/microsoft/azure-skills) repository (MIT, Microsoft
organisation, commit `cf79ce8` of 2026-10-16): `azure-prepare`, `azure-validate`, `azure-deploy`,
`azure-storage`, `appinsights-instrumentation` and `azure-reliability`.

They were reviewed before installation. The prose contains no instruction to bypass confirmation or
send data anywhere, and requires the user's confirmation for destructive actions. The seventeen
scripts across them only invoke `az`, `azd` or `terraform` against the user's own subscription.
After installation, all 541 relative links inside them were checked and every one resolves.

No skill called "product engineering" fits this project. The one published under that name defers
all of its rules to another company's repository and cannot work without it; a broader
"senior engineer" alternative is an agent that orchestrates seventeen further skills. The practice is
applied throughout this programme instead, using the built-in code review and security review, the
`vibe-ship` deployment skill and the Microsoft reliability and observability skills.

### Baseline

Taken before any change, so every later phase can be measured against it.

| Measure | Value |
|---|---|
| Backend tests | 45 suites, 1725 tests, all passing |
| Backend coverage | 92.40% statements, 77.40% branches, 94.18% functions, 94.87% lines |
| Accessibility audit | 0 findings across 40 screen visits |
| Frontend entry bundle | 333.58 kB (101.97 kB gzipped); CSS 53.94 kB (10.15 kB gzipped) |
| Lint | 39 warnings, 0 errors |
| Screens photographed | 21 screens at 375 px and 1440 px, 42 screenshots |

The screenshots are taken by `frontend/e2e/visual-capture.e2e.mjs`, which also produces a
side-by-side comparison after a change (`baseline`, then `after`, then `compare`). They are kept out
of the repository as review material.

---

## Phase 1: Rebrand to ZYRO

### The rename

23 replacements across 14 files: the landing page's components, the page title and description, the
link-preview tags and image, the footer, the landing browser test, the README, and header comments in
the database schema and row-level security script, so the codebase uses one name.

"ShopMind AI" was deliberately kept in two places. The implementation plan is the academic project's
own document and carries its academic title; the scope document names the real file that was
submitted, `ShopMind_AI_Scope_Document.docx`.

The README now leads with the product, and its Project section records that ZYRO is registered at the
university under the academic title ShopMind AI.

### The API documentation

The opening of `openapi.yaml` described the API as "the contract draft for Phase 0, Module 3", built
so "different students" could work in parallel, and versioned it `0.1.0-draft`. An integrator reading
it should see a product. It now describes the API, states a **versioning policy** (additive changes
only within a major version; anything breaking ships as a new major version at a new path, with the
old one kept running), documents the **error format** (RFC 9457 problem documents, and that clients
should branch on `type`, never on the wording), and is versioned `1.0.0`.

Both new claims were checked against the code before they were written. The error claim holds: every
path, including request-parsing failures and unhandled errors, returns a problem document. A third
claim, that a breaking change "fails the build", was written and then **removed**, because there is no
CI yet. It belongs in the document once Phase 5 makes it true.

### Two defects found on the way

**The app's styling waited on Google.** The stylesheet imported its fonts from `fonts.googleapis.com`.
While running this phase's browser test, that host stopped answering from this machine while
`google.com` still loaded, and every page sat waiting for it. A merchant on a slow or filtered
connection would have seen ZYRO late or unstyled, and every visit told Google who was looking.

The fonts are now **self-hosted**: bundled through Vite from the `@fontsource` packages (all SIL Open
Font License 1.1, which permits commercial use), hashed, cached, and served from ZYRO's own origin. The
two `preconnect` tags pointing at Google were removed with them. The landing page now loads with
Google Fonts still unreachable, which is the proof that the dependency has gone. Each font file carries
a `unicode-range`, so an English page downloads only its few Latin files out of the 36 bundled.

**All 16 browser test suites depended on a package that was never declared.** Installing the font
packages made npm prune `playwright`, which had only ever been installed by hand. On a fresh clone, a
CI runner or a teammate's machine, not one browser test could have run. It is now a declared,
exactly pinned development dependency at 1.63.0, the version whose Chromium build (revision 1243) was
already downloaded here, so nothing had to be fetched again.

Since that kind of defect rarely comes alone, every import in both applications was then checked
against their `package.json` files. Nothing else was undeclared.

### The rolled Anthropic key

The key the user rolled was confirmed working with the real-API suite: both model tiers answered and
reported token usage, and nothing about the key's value was printed.

### Gate

| Check | Result |
|---|---|
| "ShopMind" in any source or user-facing file | none |
| Landing browser suite | passes, including with Google Fonts unreachable |
| Merchant sign-in and catalogue browser suite | passes |
| Accessibility audit | 0 findings across 40 screen visits |
| Contract test | 28 passed; `openapi.yaml` parses as ZYRO API 1.0.0 |
| Production dependency audit | 0 vulnerabilities |
| Lint | 39 warnings (the baseline), 0 errors |

### Raised for later phases

- **The footer says ZYRO is coursework, "not a registered company".** That was written to be honest
  during the project. Once ZYRO takes real merchants' money it is a business, and the footer should
  name who operates it. That is the owners' decision, not an engineering one.
- **There is no Terms of Service or Privacy Policy page.** A product that takes payments needs both.
  `Privacy_Notes.md` was written as the source for one. Planned for Phase 7.
- **Error `type` URIs use `zyro.dev`**, a domain the project may not own. They are identifiers and need
  not resolve, but they should sit on a domain ZYRO controls. Settled when the production domain is
  chosen in Phase 5.

