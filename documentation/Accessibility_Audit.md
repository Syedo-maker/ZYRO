# Accessibility and Interaction Audit

Carried out 2026-10-07, on branch `feature/ui-ux-audit`, using the `ui-ux-pro-max` skill's priority
order (accessibility first, then touch and interaction) against its web-correct thresholds.

The audit itself is `frontend/e2e/a11y-audit.e2e.mjs`. It is a measuring instrument that runs in a
real browser over 40 screen visits (20 screens at 375 px and 1440 px), and it is kept in the
repository so the result can be reproduced rather than taken on trust.

---

## Result

| | Findings |
|---|---|
| First run | 647 |
| After correcting the instrument | 51 |
| Genuine defects, after verification | **2** |
| After fixing them | **0 across 40 screen visits** |

**The most important thing in this document is the gap between 647 and 2.** Nearly every finding in
the first run was the audit being wrong, not the application. Had they been "fixed", the result
would have been a worse product: 150 perfectly good navigation links padded out, 23 elements given
redundant focus styles, and three correct buttons relabelled.

---

## What the instrument got wrong, and how it was caught

### Target size: 155 findings, all false

The headline rule is "44×44 px minimum". For the **web** that is wrong. Querying the skill directly
gives the real guidance:

> Use 44pt on iOS and 48dp on Android; for web use the separate WCAG Target Size rule.
> Web: 24 CSS px plus WCAG exceptions.

The exception that mattered is **spacing**: a target smaller than 24 px passes if a 24 px circle
centred on it touches no other target's circle. Well-separated text links in a navigation bar pass
comfortably. Once the exception was implemented, all 155 findings disappeared and none came back.

### Focus indicators: 152 findings, all false, across three attempts

This one took three tries, and each failure was instructive.

1. **Reading class names** guessed, and guessed badly.
2. **Reading the stylesheet** for `:focus-visible` rules looked rigorous but could not match
   Tailwind's generated selectors, whose class names contain escaped colons.
3. **Calling `element.focus()` and comparing computed styles** failed for a subtler reason: Chrome
   paints its default focus ring only on `:focus-visible`, and a programmatic focus does not satisfy
   that heuristic, so the ring never appeared while it was being measured.

All three also treated `outline-style: none` at rest as "the ring was removed", when that is simply
the resting state of every element.

The check was settled by doing what a keyboard user does: **pressing Tab and looking.** A short probe
tabbed through the merchant dashboard and found every element reporting `outline: auto 1px` and
matching `:focus-visible`. The focus indicators were never missing.

The audit now walks each screen with real `Tab` presses and reports only elements where nothing
visible changes.

### Unlabelled controls: 3 findings, all false

Three category-filter buttons on the storefront catalogue were reported as having no accessible
name. They have visible text. They sit inside the closed mobile filter drawer, under
`visibility: hidden` on an ancestor, which keeps the layout box (so the element still has a size)
while `innerText` returns empty. The audit was checking the element's own style rather than whether
it actually renders; it now asks the browser with `checkVisibility()`.

### Tabular form layout: 2 findings, false

The add-product form puts Price and Stock side by side in a two-column grid, which the table-semantics
heuristic read as a data table. A grid containing form controls is now excluded.

---

## The two genuine defects, both fixed

### 1. The merchant's product list had no table semantics

`src/pages/admin/ProductsPage.tsx` laid the product list out as a CSS grid of `<div>` elements with
a `<div>` header row above it. To a sighted user it is obviously a table. To a screen reader it was
a flat run of text: a cell reading "8" with nothing connecting it to the STOCK column.

This was first noticed during Phase 7, when the golden-path test could not select a row by role and
had to reach it through the edit button instead. It was recorded then and fixed now.

**Fix:** `role="table"`, `role="rowgroup"`, `role="row"`, `role="columnheader"` and `role="cell"`,
with an `sr-only` label on the actions column. The CSS grid still does all the layout, so nothing
changed visually, and the golden-path test now selects the row by its role, which is both cleaner and
proof the fix works.

### 2. The storefront catalogue skipped a heading level on a phone

Each product title is an `h3`. The page title is an `h1`. The only `h2` on the page belonged to the
filter panel, which lives in a closed drawer at 375 px, so the heading sequence on a phone was
**1, 3, 3, 3**. A screen reader user navigating by heading lost a level with no explanation.

**Fix:** the results list is now a `<section>` with its own `h2`, carrying the result count
("12 products"), marked `sr-only` because the `h1` above already names the page visually. The
sequence is correct at every width.

---

## What was checked and found clean

Across 20 screens at two widths: the landing page and its collapsed menu, the shop directory, both
sign-in and sign-up screens, the storefront home, catalogue, cart and customer sign-in, ten merchant
screens, the add-product form with its AI panel, and the register (held to the stricter 44 px touch
figure, since it is genuinely used on a phone or tablet at a counter).

| Check | Result |
|---|---|
| Target size, WCAG 2.2 with the spacing exception | clean |
| Images without an `alt` attribute | clean |
| Controls with no accessible name | clean |
| Form fields with no label, placeholder-only included | clean |
| Visible focus when reached with the Tab key | clean |
| Heading levels never skipped | clean after the fix |
| Tabular data carrying table semantics | clean after the fix |

---

## Reproducing it

```
backend:   npx tsx scripts/e2e-server.ts      (plus Redis)
frontend:  npm run dev
then:      node e2e/a11y-audit.e2e.mjs
```

It prints a line per screen and writes the full list to `e2e/shots/a11y-findings.json`. Afterwards,
run `backend/scripts/cleanup-test-data.ts`; it creates a throwaway shop with the `e2e-` prefix.

## Regression checks run after the fixes

`phase1-auth-catalog`, `golden-path`, `partF-search` and the `responsive` sweep all pass. Lint is
back at its 39-warning baseline with zero errors (two unused variables left over from Phase 7's
golden-path rewrites were cleaned up), and the frontend builds.
