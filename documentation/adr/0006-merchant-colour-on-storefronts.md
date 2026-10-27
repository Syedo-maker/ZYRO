# 0006: Storefronts wear the merchant's colour, adjusted for contrast

**Status:** Accepted, 2026-10-20 (the owners' decision); implemented 2026-10-21.

## Context

ZYRO has one design system (green, cream, terracotta). A storefront is the merchant's shop, not ZYRO's,
and the merchant's colour was stored in settings but never shown.

## Decision

ZYRO's colours belong to the platform (landing page, dashboard, register, directory). A storefront
overrides the brand tokens with the merchant's own colour at run time (`frontend/src/lib/brandTheme.ts`).
A colour too pale to read is deepened, keeping its hue, only as far as needed for 4.5:1 contrast; a
colour that already passes is used exactly.

## Why

- It is how established commerce platforms work, and merchants expect their shop to look like theirs.
- Letting merchants pick any colour must not make any shop unreadable; the adjustment was checked
  across 5,010 colours.

## Consequences

- Utilities read CSS variables (`@theme`, not `@theme inline`), so the override is one style attribute
  on the storefront's root.
- The accessibility audit runs its storefront in a pale yellow, so the adjustment is tested on every
  run.
