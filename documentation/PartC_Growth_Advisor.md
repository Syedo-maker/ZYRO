# Part C: AI Growth Advisor

Status: built and tested. 15 unit tests (`advisor-rules`), 15 end-to-end tests (`advisor`) and 12 browser checks (`partC-advisor`); the full gate is listed at the end.

`find-skill`: nothing to install. `bullmq-specialist` (weekly job), `claude-api` (the message), `frontend-ui-engineering` (the card) and `database-schema-designer` (the table) were already installed. Hijri calendar libraries exist, but Node's built-in `Intl` already has the Umm al-Qura calendar, so none is needed.

## The approach, and why

**Rules decide, the AI only words the result, and a template is the fallback.**

1. A weekly job (Mondays 06:00 UTC, 11:00 in Pakistan) checks each store with plain code. Most weeks and most stores, nothing is worth saying and nothing is called.
2. Only when a check fires is a message written: by the AI from the figures that fired, or, if the AI is not available, from a template with the same figures.

Why this is the most useful design for this project:

- **It works today.** There is no Anthropic key yet; an AI-only advisor would show nothing. With the template fallback, merchants get tips now, and the tips read better as soon as a key is added.
- **It is cheap.** The AI is called at most once per store per week, on the small fast model, and only when there is something to say. The platform pays (the brief's rule); the store's allowance is never touched.
- **It cannot invent anything.** Every figure is computed by the server from real data before the AI sees it, and the AI is told to use only those facts. The tests prove the AI is handed totals only, never customer data.
- **It reuses what exists** (the brief's rule): the analytics module for sales, the Phase 5 business-insights low-stock and sales-velocity logic, the cart-recovery records, the plan and quota data from Part A.

## The checks

| Check | Fires when | Kind |
|---|---|---|
| Best seller running low | A top seller of the last 30 days is at or below its low-stock level, or will run out within a week | tip (always said while true) |
| Festival coming up | Ramzan, Eid ul Fitr, Eid ul Adha, 14 August or the wedding season starts in 14 to 42 days | tip |
| Sales up | Net sales of the last 30 days are 30% or more above the 30 days before | praise |
| Sales down | 30% or more below | tip (a discount or bundle) |
| Abandoned carts | 5 or more recovery reminders sent in the last week | tip |
| Slow movers | 3 or more products in stock, 30+ days old, not sold in 30 days | tip (bundle, better listing, discount) |
| AI allowance nearly used | 80% or more of this month's AI generations used | upgrade |
| Near the product limit | 80% or more of the plan's products, and a bigger plan exists | upgrade |

Both trend checks need at least 5 orders in each period, so "up 100%" from one order to two never appears.

**Not built: "products viewed but not bought".** ZYRO does not record product page views, so there is no data for this check. It needs view tracking first; it is left out rather than faked.

## One tip a week, never nagging

- At most one tip per store per week (a unique key on store and week, so even two simultaneous checks make one).
- A tip covers one main point, the good news if there is any, and an upgrade line only if a limit is genuinely close.
- Nothing said in the last three tips is said again, except a best seller still running out.
- If nothing new stands out, no tip is written that week.

## Festivals

Islamic dates come from the Umm al-Qura calendar built into Node. Pakistan follows its own moon sighting, which can differ by a day or two, so every Islamic date is marked approximate and tips say "around". 14 August and the start of the wedding season (1 November) are fixed. A festival is mentioned 14 to 42 days ahead: early enough to order stock, late enough to matter.

## What the merchant sees

A "This week's tip" card at the top of the dashboard: the tip, "From automated weekly checks on your store's totals", "Got it" to hide it, and for the owner "Turn off tips" (and "Switch tips on" again). Before the Monday check, "Check now" runs this week's check at once (still one tip a week). Staff without the analytics permission do not see the card.

## Privacy

Only totals and the store's own catalog are used; no customer names, emails or order details, and one store's figures are never used for another's tips. The privacy statement is in `documentation/Privacy_Notes.md`, for the product's privacy policy.

## API

`GET /stores/:id/advisor`, `PATCH /stores/:id/advisor` (owner), `POST /stores/:id/advisor/check`, `POST /stores/:id/advisor/tips/:tipId/dismiss`. Contract in `backend/openapi.yaml`.

## Tests

- `advisor-rules` (unit, 15): the festival calendar (Ramzan 1448 about 8 February 2027, marked approximate; 14 August exact and only inside the window), every check firing and not firing at its threshold, the too-few-orders guard, upgrades only near a limit and only if a bigger plan exists, topic choice and no repeats, weeks starting on Monday, the template's wording.
- `advisor` (end to end, 15): a store's real orders, stock, abandoned carts and allowance fire the right checks; the AI gets the figures on the fast model and no customer data; the platform pays; one tip a week; no repeats next week; the template when the AI is down; dismiss, switch off, owner-only switch, isolation, the weekly run, "Check now".
- `partC-advisor` (browser, 12): the card before and after "Check now", the tip naming the low best seller, "Got it", off and on, a cashier not seeing it, phone width.

## Deliberate limits

- English only.
- Weekly, not daily.
- Tips are not emailed yet (the brief says email later).
- The AI cost of tips is recorded per tip (`GrowthTip.inputTokens` and `outputTokens`) but not yet shown on the platform page.
