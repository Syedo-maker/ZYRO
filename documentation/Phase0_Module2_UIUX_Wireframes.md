# Phase 0 — Module 2: UI/UX Wireframes

**Status:** Complete
**Deliverable:** [ZYRO Wireframes canvas](https://claude.ai/artifact/BnBcKsX2dmw1g5GKgBeCT9) (Claude Design canvas, 13 artboards across 3 pages)
**Source files:** `design/wireframes/*.dc.html`, `design/wireframes/canvas.json`
**Built with:** the built-in `design` skill (found via `find-skill`, which confirmed no third-party skill was needed since this one already covers wireframes/navigation flow/component inventories).

This satisfies Phase 0's exit criteria for wireframes. The implementation plan originally named Figma as the tool; a Claude Design canvas was used instead since it's directly available in this environment and produces the same three artifacts (screens, navigation flow, component inventory) as one linked, clickable-through canvas rather than static exported images.

## What's on the canvas

**Page 1 — Customer Flow:** Storefront home, category/search listing, product detail, AI shopping assistant (chat widget), cart, checkout, order confirmation.

**Page 2 — Merchant Admin:** Dashboard (sales, AI quota, chart, top products, recent orders), product catalog management (including the AI description draft/regenerate/publish states), orders & shipping management (order detail + shipping zone config), marketing & analytics (discount codes + abandoned-cart recovery funnel).

**Page 3 — Flow & Components:** A navigation-flow diagram connecting all customer and merchant screens from their respective entry points, and a component inventory (color tokens, typography, buttons, form inputs, badges/status pills, cards, nav bar, admin sidebar) for Phase 1+ frontend work to build against.

## Design decisions

- **Static wireframes, not a clickable prototype** — the module is named "wireframes" in the plan, and this is a design-reference deliverable, not a demo; noted as an assumption rather than asked about mid-flow, per the design skill's own guidance for a brief that already names a concrete deliverable.
- **Type/color system**: Space Grotesk (headings) + IBM Plex Sans (body); oklch-based tokens — neutral background/text, an indigo accent for primary actions, a separate teal "ai" accent (same lightness/chroma, different hue) to visually distinguish AI-generated content and AI actions from regular UI everywhere it appears (product badges, the assistant widget, the AI content tool panel).
- **Status pills use one consistent semantic mapping** across every screen: green = fulfilled/success, amber = processing/draft/pending, red = cancelled, grey = no state yet, teal = AI-related.

## Quality check

Before publishing the final version, a background review pass checked all 13 source files against the brief (coverage, cross-file style consistency, `canvas.json` integrity, Design Components format compliance, and AI-slop-trope avoidance). It found and this session fixed two real issues:
- A `DRAFT` badge color mismatch between the component inventory reference and its actual usage in the product catalog screen (resolved by making the inventory match the real usage — amber, consistent with other "pending" states).
- Nine of the thirteen files were missing the required `a`/`a:hover` link-color rule (added to all nine).

## Environment note

Building this required installing Node.js (needed anyway for the Phase 1 backend) since the design canvas tooling has no browser/interpreter dependency but does need a JS runtime to assemble the published page locally.
