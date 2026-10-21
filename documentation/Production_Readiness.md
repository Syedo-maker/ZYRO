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

---

## Phase 2: One design system for the whole platform

### Where it started

The platform had two colour systems that never met. The landing page used a private palette of its
own (dark green, cream, orange, terracotta), and the other 72 screens used an indigo palette. A
merchant who signed up on the green landing page arrived in an indigo dashboard: it looked like two
products.

### What it is now

One set of design tokens in `frontend/src/index.css`, in three layers:

1. **Primitives**: the raw palette (`--zyro-green-900`, `--zyro-terracotta-700` and so on). They are
   deliberately kept out of Tailwind's theme, so no utility like `bg-green-900` exists and no
   component can reach past what a colour is for to its value.
2. **Semantic tokens**: what a colour is for (page, card, text, brand, accent, the dark surface,
   success, warning, danger, AI). Every screen uses these. The names are the ones the app was already
   built on, so re-theming 72 screens was a change to one file, not to 72.
3. **Components**: the variant maps in `components/ui/`, built only from semantic tokens.

The landing page's 181 private colour classes were moved onto the same tokens and the private
palette was deleted. The eight hard-coded colours (in landing illustrations and two directory
fallbacks) became tokens; no hex colour remains in any component. The typefaces are Plus Jakarta Sans
for headings and IBM Plex Sans for text, everywhere, and the ZYRO wordmark is one component
(`Wordmark.tsx`) instead of being typed out separately in each place.

### Buttons

`components/ui/Button.tsx` has one set of variants for every surface: primary, accent, secondary,
danger, ghost, inverse, outline-inverse and outline, in three sizes. `buttonStyles()` gives the same
classes to links that look like buttons (Start free, Go to checkout), which must stay links for the
router and for screen readers. Every button now has the same visible keyboard focus outline.

Building it found a defect. A screen that wanted a smaller button passed its own height, such as
`h-10`, but the button already carried `h-11`. When two classes set the same property, the
stylesheet's order decides, not the order they are written in, and Tailwind orders them numerically,
so `h-11` always won (confirmed in the built CSS). **51 buttons** asked for 32, 36 or 40 px and all
rendered at 44 px, and the same happened to their padding. A caller's own height, padding, text size,
weight or focus colour now replaces the default, so those buttons are now the size their screens
asked for. That is a visible change, and it shows in the before/after screenshots.

### Every pairing measured

Each colour pairing was worked out with the WCAG formula before it was written, and the numbers are
recorded in the stylesheet's header. Two rules followed from them:

1. **No text hierarchy by opacity.** The landing page made secondary text by fading its green to 60%,
   and that measured 3.6 to 4.2:1, which fails. Each tier of text is now a real colour, measured on
   each surface it appears on.
2. **The brand orange is never text.** It measures 2.77:1 on the page. It is used for fills and
   decoration; accent-coloured text is terracotta (5.78:1) on light surfaces and a lighter orange
   (4.99:1) on the dark one.

### Merchant colours on storefronts

A storefront wears its merchant's own colour; the platform around it stays ZYRO's. The colour tokens
are CSS variables that every utility reads at run time, so a storefront sets four of them on its root
element (`lib/brandTheme.ts`) and everything inside it changes.

A merchant can pick any colour, including a pale yellow that white text would vanish on (1.4:1). So
the colour is deepened, keeping its hue, only as far as needed for text on it and brand-coloured text
around it to reach 4.5:1. A colour that already passes is used exactly as chosen. This was checked
against 5,010 colours (ten chosen, 5,000 random): none fell below 4.5:1, and 29% were used unchanged.
A new browser test, `e2e/brand-theme.e2e.mjs`, proves it in a real browser: a deep colour is used
as-is, a pale one is deepened and passes, a shop with no colour wears ZYRO's green, and the merchant's
dashboard keeps ZYRO's green.

Before this phase, the merchant's colour was stored and could be set in settings, but no storefront
ever showed it.

### The audit had been blind to colour

The accessibility audit reported zero findings while text-contrast failures sat on the landing page,
because it never measured colour. It now measures what the browser paints: every text element's
colour against its real background (translucent layers composited), with the large-text threshold,
and every form field's border against what surrounds it (WCAG 1.4.11). It also runs with reduced
motion, because the landing page's scroll animations had hidden half the page from it.

Its first honest run found **127 failures**:

- **Every form field in the product**: input borders measured 1.31:1 against the 3:1 that tells
  anyone a field is there. Fields now use a border token that measures 3.51:1 on a card.
- **29 kinds of landing text** made with opacity, from 3.6 to 4.2:1. All now use real colour tiers.

The audit's own shop now uses the pale yellow, so every storefront screen it visits is also a test
of the merchant-colour adjustment.

### Tests that had gone stale

Running every browser suite for this gate found three that were failing for reasons that had nothing
to do with ZYRO's code, and fixed them:

- **`phase1-auth-catalog`** checked that Space Grotesk loads. This phase replaced it with Plus Jakarta
  Sans, so the check now asserts that.
- **`roles-and-ideas`** looked for a "Shop / Start a store" chooser on `/`. That screen was replaced
  by the landing page in an earlier piece of work (commit b3bb90a), before this programme, and the
  suite was never updated. It now checks the landing page's two equivalent links and follows "Shop
  now" into the directory.
- **`stripe-discount` and `stripe-real`** selected a payment method on Stripe's own hosted page by
  its radio input. Stripe has since redrawn that page: each payment method is a row whose click
  target is a transparent button laid over it. Both suites now click where a person clicks, on the
  word "Card". Both were run against real Stripe in test mode, with the webhook forwarder, and pass.

### Gate

| Check | Result |
|---|---|
| Accessibility audit, now measuring colour | 0 findings across 40 screen visits, 1,640 text elements measured; the audit's storefront uses a pale yellow merchant colour |
| Merchant colour browser test (new) | 6 of 6 |
| Merchant colour derivation | 5,010 colours, none below 4.5:1 |
| Browser suites against the test server | all 18 pass: 577 checks |
| Password protection suite (rate limiting on) | 5 of 5 |
| Real Stripe suites (test mode, webhook forwarder) | `stripe-discount` 15 of 15, `stripe-real` 22 of 22 |
| Backend tests touching store branding | 124 of 124 |
| Type check and production build | pass |
| Lint | 37 warnings (baseline 39), 0 errors |
| Hard-coded colours in components | none |
| Before/after screenshots | 21 screens at 375 px and 1440 px, `frontend/e2e/shots/visual/compare.html`, for the owners' review |

Bundle: the entry script is 334.44 kB (102.65 kB gzipped), against 333.58 kB at the baseline. The
stylesheet is 73.45 kB, of which 21.47 kB is the 30 `@font-face` rules added in Phase 1 when the
fonts were self-hosted; the styles themselves are 51.98 kB, about 2 kB smaller than at the baseline.

Test data was removed afterwards with `cleanup-test-data.ts`; what remains is 10 stores and 17 users,
all real (the tenth, `anu`, was created on 2026-10-18, before this programme).
