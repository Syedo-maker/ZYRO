# Phase 4: Marketing Copy and the Dashboard AI Quota Meter

Status: complete and verified. This closes out Phase 4: every Phase 4 item in the plan is now ticked. 15 new checks in `verify-ai-content.ts` (37 to 52, all passing) and 11 new browser checks in `phase4-ai-content.e2e.mjs` (16 to 27, all passing). The full regression passes: 16 backend scripts (804 checks in total) and all 7 browser suites.

A `find-skill` search found nothing to install: the installed `claude-api` skill already covers the orchestrator call, `frontend-ui-engineering` covers the dashboard component, and the prompts are business logic specific to this codebase.

## AI marketing copy

`POST /stores/:storeId/products/:productId/marketing-copy` with `{ channel, tone?, notes? }`.

- **Channels:** `social_post` (2 to 4 sentences plus 2 or 3 hashtags), `email` (a `Subject:` line, then a short body ending in a call to action), `ad_headlines` (three headlines, each meant to be under 30 characters).
- **Tones:** friendly (default), professional, playful, luxury.
- **`notes`** (up to 200 characters): the offer the merchant wants mentioned, for example "20% off this weekend".
- **A suggestion, never stored.** Same rule as auto-tag and SEO metadata: the merchant edits the text and copies it where it is needed. No schema change, nothing on the product changes (checked).
- **It may not invent an offer.** The prompt hands the model the product facts and the merchant's `notes` as the only source of any promotion, says explicitly when the merchant gave none ("do not mention any offer"), and forbids inventing a discount, price, shipping promise, stock level, review or claim. Advertising text with a made-up discount is the failure that would actually cost a merchant something. This is a prompt-level control, so a model can still ignore it; that is why the text is shown for editing rather than published automatically.
- **Format is enforced like the other structured tools.** An email reply without its `Subject:` line, or an empty reply, is a clean `503` "could not be understood, try again", not garbage passed to the merchant. Ad headlines have numbering and bullets stripped and are cut to three lines. Markdown emphasis is removed but `#` is kept, because hashtags are the point of a social post.
- **Same quota and permission as every other AI tool.** One generation per call from the monthly allowance (also when the reply turns out unusable, as with the other tools), `402` once it is used up, `products_write` permission required, `404` for another store's product, `400` (no quota spent) for an unknown channel or tone or over-long notes.

In the admin, the product form's AI tools panel has a new "Marketing copy" section: channel, tone and optional offer, then "Write marketing copy". The result appears in an editable box with a Copy button (if the browser blocks clipboard access it says so and the text stays selectable).

## AI usage meter on the dashboard

The Admin Dashboard now has an "AI usage this month" card under the key figures: two progress bars, "AI content generations" (descriptions, tags, SEO, review summaries, marketing copy, insights, recovery emails) and "Shopping assistant replies" (shoppers' chat), each as "7 of 50 used", plus "Resets on 1 October".

- The two allowances are counted separately by the quota system (Phase 4), so they are shown separately. Before this, the merchant could only see generation usage, and only inside the product form; assistant usage, which shoppers spend without the merchant doing anything, was not visible anywhere.
- At 80 percent the bar turns amber and says "Almost used up"; at the limit it turns red and says "Limit reached". The state is written in words as well as colored, and each bar is a real `progressbar` with its value for screen readers.
- The reset date is the 1st of next month in UTC, because quota rows are keyed by UTC month.
- Only people who may use the AI tools can read the figures (the existing `ai-usage` endpoint needs `products_write`). For a staff member without it, or if the request fails, the card is simply not shown instead of putting an error on the dashboard.

## Verification

- `verify-ai-content.ts` (15 new checks): a social post comes back cleaned and with hashtags; the prompt carries the product facts and says no offer may be mentioned when none was given, and forbids inventing one; tone reaches the model; the merchant's offer is passed through as the only offer; an email without a Subject line and an empty reply are clean errors; ad headlines are normalized to three lines; every call spends exactly one generation; nothing is written to the product; bad input is `400` and spends nothing; no token `401`, staff without permission `403`, another store `404`; and once the limit is reached marketing copy is refused with `402` like every other tool.
- `phase4-ai-content.e2e.mjs` (11 new checks, real Chromium): the meter shows both allowances at zero for a new store and says when it resets; marketing copy for an email with an offer and for ad headlines; the offer the merchant typed reaches the copy; Copy really puts the edited text on the clipboard; nothing is saved to the product; and at the end the meter's figure equals the server's usage after all the AI tool use in the run (7) and is also written out in words.

## Deliberate limits

- Marketing copy is one suggestion per click; there is no history of past suggestions and nothing is stored (the plan asks for neither).
- Copy is not sent anywhere: no posting to social networks and no email sending. The merchant copies it out.
- English only, because the prompts are English.
- The meter reports; it does not let the merchant buy more. Limits come from `AI_MONTHLY_GENERATIONS_LIMIT` and `AI_MONTHLY_CHAT_MESSAGES_LIMIT`.
