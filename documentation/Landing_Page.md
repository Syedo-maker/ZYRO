# The ShopMind AI Landing Page

Built 2026-10-06, after the role separation work and before Phase 7. Branch `feature/landing-page`.

The homepage at `/`: what the product is, who it is for, and a working demonstration of the feature
that makes it different, aimed at a small business owner in Pakistan who has been put off by other
platforms' prices and complexity.

---

## What it replaced

`/` previously showed a plain two-button screen asking "Shop, or start a store?". That question is
now the hero's two buttons inside a page that actually explains the product. The role handling
behind them is unchanged: a signed-in visitor never sees this page at all, and whether they have a
shop (not a stored preference) decides where they go, exactly as `lib/experience.ts` already did.

---

## The sections

| # | Section | Background | What it does |
|---|---|---|---|
| 1 | `LandingNav` | dark green, sticky | Logo, four anchors, Log in, Start free. Collapses to a disclosure button under 1024px. |
| 2 | `Hero` | dark green | Roman Urdu kicker, headline, both calls to action, and the live demo. |
| 3 | `ProblemSection` | cream | Three pain points: monthly fees, AI sold as add-ons, not knowing what shoppers search for. |
| 4 | `AiFeatures` | cream / sage, alternating | An `h2` introduction, then five features as `h3`, trending suggestions first and largest. |
| 5 | `FeatureGrid` | dark green | The eight non-AI things a shop needs, as an icon grid. |
| 6 | `HowItWorks` | cream | Three steps, each with a drawn visual. |
| 7 | `ComparisonTable` | sage | Six rows against "a typical hosted store platform". A real `<table>` above 768px, cards below. |
| 8 | `PricingSection` | cream | Three plans, read from `GET /plans`. |
| 9 | `StoreDirectoryPreview` | sage | Real listed shops. Removes itself below three. |
| 10 | `TrustSection` | dark green | Isolation, Stripe, hashed passwords, AI with no authority. |
| 11 | `FaqAccordion` | cream | Eight questions on `<details>`/`<summary>`. |
| 12 | `FinalCta` | orange | One band, two buttons. |
| 13 | `LandingFooter` | dark green | Links, contact, and the university project note. |

---

## The live demo, and how it cannot cost anything

The hero demo is the centrepiece: a visitor types a product and sees the suggestions a merchant
would get, from the same keyword sources and the same prompt. It is also the **only AI-backed
endpoint on the platform a stranger can reach**, so its budget is the interesting part.

`POST /demo/product-ideas` is public and protected in four layers, in order:

1. **Prepared examples.** Six phrases people in Pakistan actually sell (lawn suit, handmade khussa,
   clay chai cups, phone cover, chocolate fudge cake, silver jhumka earrings), generated once by
   `scripts/seed-demo-ideas.ts` and kept in Redis for a week. The page offers them as chips and
   loads the first one automatically, so almost every visitor costs **zero AI calls**.
2. **Cache first.** Any phrase is normalised and looked up; an identical repeat is served from Redis.
3. **Two caps on a miss.** Three live generations per visitor per hour, **and a hundred per day
   across every visitor together**. The global cap is the real cost ceiling: it is what survives
   being scraped or linked somewhere busy. Both counters live in Redis with expiries.
4. **The platform pays.** The one call that gets through uses `billedTo: "platform"`, the flag the
   Growth Advisor already uses, so the orchestrator reserves no quota, spends none and records no
   tokens. **No merchant's AI allowance is ever touched by the demo**, which the test suite asserts
   directly by watching a real store's counters across the whole scenario.

If Redis is unreachable the answer is **no live generation**, deliberately. A login limiter should
fail open so people can still sign in; this one must fail closed, because failing open means an
unbounded bill. A visitor then gets a prepared example, which is a perfectly good demonstration.

There is also an eight-second timeout, after which the visitor gets a prepared example rather than
a spinner.

### It says which it is showing

The response carries `origin`, and the page prints it: `live` ("Written just now"), `cached`
("Someone asked for this one already"), or `example` ("A prepared example, written by the same AI").
When a cap is what caused the fallback, the note says which cap and invites them to sign up. A saved
answer is never presented as a fresh one.

### Keywords, never numbers

The demo returns keyword **words** only. The weights that order them are not search volumes and are
never sent to the browser, so there is nothing on the page that could be misread as one. The
per-suggestion "Uses popular searches:" line is verified on the server against both the real keyword
list and the text the model actually wrote, exactly as in the merchant-facing feature.

### One prompt, not two

`buildIdeasPrompt()` was extracted from `ideas.service.ts` and is used by both the real feature and
the demo. They differ in who pays and how they are rationed, not in what is asked, so a visitor sees
the real behaviour rather than a mock-up of it.

---

## Honesty decisions

The brief forbade invented numbers, and a few things had to be settled rather than written around.

| Thing | What we found | What the page says |
|---|---|---|
| **Prices in rupees** | Plans are charged in **US dollars** through Stripe: Free $0, Pro $12, Business $39 (`lib/plans.ts`, `BILLING_CURRENCY = "usd"`). | The dollar price, which is what is charged, with "about Rs X a month, at Rs 280 to the dollar" beside it. The rate is a stated constant in `PricingSection.tsx`, so the figure can be checked rather than trusted. Quoting a rupee price we do not charge would have been a lie about the product. |
| **WhatsApp** | Nothing in the codebase. Grepped both halves. | Nothing. The Pakistan angle is carried by rupees, cash on delivery, bank transfer with receipt checking, and Roman Urdu, all of which are real. |
| **Custom domains** | Stored and plan-gated, but serving a storefront on one was never built. | "Your own domain (coming soon)" on the Business plan, and the FAQ says so outright. |
| **Testimonials, user counts, ratings** | We have none. | None shown. The store directory preview uses **real** listed shops and hides itself entirely below three, rather than padding the page with placeholders. |
| **Competitors** | We have not audited anyone's current pricing. | The comparison names nobody and says "a typical hosted store platform", with a line on the page explaining why. |
| **Social links** | We have no accounts. | No social icons. An icon that goes nowhere is worse than an absent one. |
| **It is a student project** | True. | Said plainly in the footer, with both authors and the supervisor. Somebody deciding whether to put their livelihood on a platform is entitled to know. |

Every feature shown is built and working. Nothing is labelled "coming soon" except the custom domain.

---

## Design

The palette is **scoped to this page**: `--color-lp-*` tokens in `index.css`, used nowhere else. The
app's own indigo system dresses forty-odd screens whose contrast was audited in Phase 0, and
re-skinning those was not asked for and would have put every one of them at risk.

Contrast was measured, not guessed, with the sRGB relative-luminance formula:

| Pair | Ratio | Verdict |
|---|---|---|
| cream on dark green | 11.2 | comfortable AA |
| dark green on cream | 11.2 | comfortable AA |
| dark green on sage | 9.53 | comfortable AA |
| white on brand orange `#E8703D` | **3.08** | large text and UI shapes only |
| dark green on brand orange | **4.04** | large text and UI shapes only |
| brand orange on cream | **2.77** | fails |

So the brand orange carries **no small text anywhere**. It is used for large headings, the kicker,
icon strokes, borders and the call-to-action band's background. Anything small or button-shaped uses
`#A8481B`, a deeper terracotta from the same family, which measures 5.24 on cream and 5.82 behind
white text. This was the single most consequential design decision on the page and the numbers are
in a comment above the tokens.

Headings are Plus Jakarta Sans; body text is IBM Plex Sans, which the app already loaded.

**Motion** is one `IntersectionObserver` per revealed block plus two CSS properties, and a keyframe
for the demo cards appearing one by one. No animation library. Everything is behind
`prefers-reduced-motion`: the `Reveal` component checks it before the observer is ever created, so
there is no flash of hidden content, and the card stagger is applied through Tailwind's
`motion-safe:` variant.

**Illustrations** are drawn in markup (`Mockups.tsx`) rather than screenshotted. A screenshot of a
dashboard shrunk into a card is unreadable, goes stale the moment the UI changes, and costs a few
hundred kilobytes; these reproduce the real shapes and the real wording, weigh nothing, stay sharp,
and are `aria-hidden` because the text beside them already says what they show. The Open Graph image
is an SVG of the same kind.

---

## Speed

The landing page is the first thing a visitor loads, and it was pulling the entire application with
it. The route tree in `App.tsx` is now split: the landing page, the shop directory and the two
sign-in screens load eagerly, and the merchant dashboard, the register and the storefronts are
`React.lazy` chunks fetched on first navigation.

**The entry bundle fell from 606 kB to 333 kB (162 kB to 102 kB gzipped)**, and the build's
"chunks are larger than 500 kB" warning is gone. The `phase1-auth-catalog`, `phase2-checkout` and
`phase2_5-pos` browser suites were re-run afterwards and all pass, so no route broke.

Images are `loading="lazy"`, the fonts preconnect, and the page ships no third-party script.

---

## Accessibility

- A skip link to `#main`, because the page is long.
- Heading order never skips a level, asserted in the browser suite by reading every `h1`, `h2` and
  `h3` in order and failing on a jump.
- The navigation disclosure is a real `<button>` with `aria-expanded` and `aria-controls`, and closes
  on Escape. The FAQ is `<details>`/`<summary>`, so keyboard operation and screen-reader semantics
  come from the browser rather than from re-implemented ARIA.
- The demo announces its result through an `aria-live` region, since the cards otherwise appear
  silently.
- Visible focus rings on every interactive element, with the ring colour chosen per background.
- The comparison is a real `<table>` with a caption and `<th scope>`, re-rendered as cards on a phone
  where six rows by three columns would be unreadable.
- Decorative artwork is `aria-hidden`; the one real image (a shop logo) has an empty `alt` because
  the shop name sits beside it.

---

## API

| Endpoint | Auth | Cost |
|---|---|---|
| `GET /demo/product-ideas/examples` | public | nothing |
| `POST /demo/product-ideas` | public | nothing, or one platform-paid call within the caps |

`GET /plans` was already public; the landing page now reads it, through a new `plansApi.list()`.

## Operating it

Run `npx tsx scripts/seed-demo-ideas.ts` after a deployment, or any time Redis has been cleared, to
fill the demo cache. It costs one platform-paid AI call per example, so about six, and skips
anything already cached. It is not required: an unseeded example generates itself once on first
request and is cached from then on.

---

## Tests

| Suite | Kind | What it proves |
|---|---|---|
| `tests/integration/demo-landing.test.ts` | integration, 23 tests | The financial guarantees: a prepared example costs nothing, a repeat costs nothing, the per-visitor cap engages, **no store's quota or top-up credits move**, an AI outage yields a saved example rather than an error, nothing is written, and the response carries no number readable as a search volume. |
| `frontend/e2e/landing.e2e.mjs` | browser, 45 checks | Every section in order, heading order with no skipped levels, the demo answering and labelling its origin, prices matching `GET /plans` exactly, the rupee figure marked as a conversion, the FAQ opening from the keyboard, both calls to action, signed-in owners and shoppers being redirected past the page, and phone, tablet and desktop widths with the mobile menu. |

Re-run for regressions after the code splitting: `phase1-auth-catalog`, `phase2-checkout`,
`phase2_5-pos`, plus `ideas` and `roles-and-ideas` for the prompt refactor. All pass.

### A defect the tests found

The AI feature titles were `h3` with no `h2` above them, skipping a heading level on a page whose
brief asked for correct heading order. Fixed in the page by giving the AI block its own `h2`
introduction, which it needed anyway: it previously jumped from the problem statement straight into
feature one with nothing to orient the reader.
