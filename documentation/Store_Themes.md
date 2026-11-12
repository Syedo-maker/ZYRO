# Store Themes and the Theme Studio

Built 2026-11-12 on the branch `feature/store-themes`. Each Zyro store can have its own look on its storefront and checkout: colours, fonts, shapes, logo, banner and homepage layout. The owner designs it in the **Theme Studio**, by hand or with the **AI design assistant**, and publishes it when ready. The platform itself (dashboard, sign-in, landing page) always keeps Zyro's own look.

## 1. For owners: how the Theme Studio works

Open **Theme** in the dashboard sidebar (`/admin/theme`). Only the store owner sees it; staff, including Managers, do not.

- **Live preview (left).** Your real storefront, wearing your draft. Switch between Desktop, Tablet and Mobile, and between the Home, Product, Cart and Checkout pages. Every change shows at once, without reloading.
- **Tools (right; a bottom sheet on a phone).**
  - **Assistant:** say what you want in English, Roman Urdu or Urdu ("warm and handmade", "mujhe dark aur premium look chahiye"), or press a quick action: *Try a bolder look*, *Make it simpler*, *Match my logo colors*. The assistant applies its best idea straight away and shows two or three looks as cards (name, a one-line reason, a small preview). Press **Try this** on any card. If your request is unclear it asks one short question, and still gives you looks to try.
  - **Customize:** every setting by hand: a starting preset, the four colours, font pair, corners, button and card style, surfaces, logo and banner, homepage sections (show, hide, reorder), footer style, and the hero and about texts.
- **Undo and Redo** (also Ctrl+Z and Ctrl+Shift+Z): every change, including each assistant answer, is one step. The last 30 steps are kept.
- **Versions:** the last 10 published versions; **Restore** loads one into your draft.
- **Finish and polish:** checks your draft and fixes what it can (see section 5), then lists every fix. It never publishes.
- **Publish:** nothing reaches shoppers until you press it. Until then they keep seeing your last published look (or Zyro's default look if you have never published).
- If a colour you choose would be hard to read, it is adjusted automatically and a message tells you exactly what changed.
- Each assistant request uses one AI generation from your monthly allowance; the panel shows how many are left. A request that fails uses none.

## 2. The AI design assistant

`POST /stores/:storeId/theme/assistant`, in `backend/src/modules/themes/theme.assistant.ts`.

1. The request (`message` up to 500 characters, and/or `action`: `bolder`, `simpler`, `logo`) is validated before anything else; an empty or over-long request never reaches the AI.
2. The prompt holds only this store's own data: its name, its one-line description, up to 8 categories and up to 12 product names, plus the current draft (without image links). For *Match my logo colors*, the colours are read from the logo **in the owner's browser** (`frontend/src/lib/logoColors.ts`) and only the hex values are sent; the picture never goes to the AI.
3. The call goes through the existing AI orchestrator (`promptType: theme_design`, standard model tier): job queue, the store's monthly quota (reserved before the call, refunded if it fails), and the store's token counters.
4. The model must answer with JSON only: `{ reply, question, options: [{ name, reason, changes }] }`.
5. **Nothing from the model is trusted.** Each setting in `changes` is laid over the current draft one at a time and checked against the same strict schema the manual controls use; texts are cut to length and stripped of `< > { }`; a value that does not pass is dropped. The model cannot set the logo, banner, version, CSS, HTML, links or any setting outside the list. Every look then goes through the contrast guard.
6. The first valid look is saved as the draft (one Undo step). Up to three looks are returned as cards.
7. **Invalid output:** if no look in the reply is usable, its quota turn is given back and the model is asked once more. If that also fails, the owner sees "The AI assistant could not come up with a usable design this time..." and nothing is charged or changed.
8. **AI unavailable** (no key, a rejected key, an outage, a timeout): "The AI assistant is temporarily unavailable. Nothing was used from your AI allowance; please try again later." The manual controls keep working.
9. **Prompt injection.** Owner text, product names and logo colours are wrapped in `<owner_request>`, `<store_data>` and `<logo_colors>` blocks, and the instructions say their contents are information, not instructions. A product name cannot close a block early (the tags are removed from data). Even an injection that worked could only produce a valid, contrast-checked theme.
10. **Rate limits:** 6 requests per person per minute and 40 per store per hour (`RATE_LIMIT_THEME_AI_MAX`, `RATE_LIMIT_THEME_AI_STORE_MAX`), on top of the monthly quota.

## 3. The theme schema

One strict shape (`backend/src/modules/themes/theme.schema.ts`) for every theme, whoever wrote it. Unknown keys are refused, so no CSS or HTML can ride along.

| Field | Allowed values |
|---|---|
| `version` | `1` |
| `preset` | the preset it started from, or null (reference only) |
| `colors.primary`, `accent`, `background`, `text` | six-digit hex, stored lowercase |
| `surfaceStyle` | `flat`, `raised`, `contrast` |
| `font` | `jakarta-instrument`, `inter-clean`, `poppins-bold`, `nunito-friendly`, `dmsans-playfair`, `inter-lora` |
| `radius` | `none`, `small`, `medium`, `large` |
| `buttonStyle` | `pill`, `rounded`, `square` |
| `cardStyle` | `flat`, `bordered`, `shadow` |
| `logoUrl`, `bannerUrl` | null, or an image uploaded to **this** store (JPEG, PNG or WebP, at most 5 MB, checked by its bytes; never SVG). The link must be exactly the address the store's own upload produced. |
| `sections` | all five of `hero`, `featured`, `categories`, `reviews`, `about`, each once, in display order, each with `visible` |
| `footerStyle` | `simple`, `detailed`, `minimal` |
| `heroHeadline`, `heroText`, `aboutText` | plain text, at most 80, 200 and 600 characters, no `< > { }`, or null |

Fonts are self-hosted (`@fontsource`, SIL Open Font License) and loaded only when a store uses them. Presets: Dark Lime (the default, wearing the store's existing colour), Clean Light, Warm Earth, Soft Pastel, Bold Contrast.

**How a theme reaches the page.** The server turns a theme into design tokens (`theme.tokens.ts`): only CSS custom properties from a fixed list (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`, `color-scheme`) with plain values. The storefront sets those on its root element; every component already reads them (`frontend/src/index.css`). The browser checks every name and value against an allowlist again (`frontend/src/lib/storeTheme.ts`) before using it. No CSS or HTML is ever stored or rendered from a theme.

**No flash of the default look.** A returning shopper's browser remembers each store's published tokens (`localStorage`, key `zyro-store-theme:<storeId>`); `frontend/public/theme-init.js` applies them before the first paint, through the same allowlist. The server's answer replaces or clears them, and they are removed when the shopper leaves the store.

## 4. Contrast rules (WCAG 2.2 AA)

`backend/src/modules/themes/theme.contrast.ts` and `theme.tokens.ts`. Every pairing the storefront uses is measured, and anything that fails is corrected with the smallest change that passes (moved towards black or white, keeping its hue). Each correction comes back to the owner in plain words.

| Pairing | Minimum |
|---|---|
| Body, secondary and muted text on the page, cards, quiet fills and raised menus | 4.5:1 |
| Links, prices and accent text on every surface and on the soft brand tint | 4.5:1 |
| Button text on the button colour, and on its hover shade (black or white, whichever reads better) | 4.5:1 |
| Success, warning and danger text on the page and on their soft fills | 4.5:1 |
| Input borders | 3:1 |

A background so mid-toned that neither black nor white text reads well on it is moved towards dark or light first (until black or white has 8:1), and the owner is told. A light main colour keeps its colour on buttons (with dark text) and uses a darker shade only for links and prices. The guard is tested on the presets (no corrections needed) and on 400 random themes per test run (every pairing passes); a one-off run of 30,000 random themes found no failure.

## 5. Finish and polish

`POST /stores/:storeId/theme/polish`, rules only (no AI, no cost). Fixes, saved as one draft step:

- **Hierarchy:** the hero moves to the top when shown; New arrivals is turned back on, so products are always on the front page.
- **Spacing:** flat cards on a flat page get a border.
- **Contrast:** an accent that almost matches the background takes the main colour; then the full contrast guard.

Suggestions only (the owner's words are theirs): a headline over 48 characters (mobile), an about text over 450 characters (mobile), a long about text in the decorative font pair (fonts).

## 6. Drafts, versions and publishing

- Tables `StoreTheme` (one per store: `draft`, `published`, `publishedAt`, `history`, `cursor`) and `StoreThemeVersion` (one row per Publish). Migration `20261112134521_store_themes`, rollback in `backend/prisma/rollbacks/`. Both are tenant-scoped models in `lib/prisma.ts`.
- A store with no theme row gets one on the owner's first visit: Dark Lime with the store's existing colour.
- Saving a draft validates, guards, and pushes it onto `history` (at most 30). Undo and Redo move `cursor`. A new change after an Undo drops the steps ahead of it.
- Publish copies the draft to `published` and adds a version; only the newest 10 versions are kept. Restore loads a version into the draft (one Undo step); Publish makes it live again.
- Two windows editing at once: a write only succeeds if nobody changed the row since it was read; otherwise the owner is asked to reload.
- **Shoppers never get a draft.** The public store profile (`GET /stores/:storeId`) carries `theme: { theme, tokens }` for the **published** theme only, or null. The Studio preview gets the draft by `postMessage` from the owner's own Studio window; a storefront accepts it only when it is framed by `/admin/theme` on the same site (`frontend/src/lib/themePreview.ts`), and pages may be framed by the same site only (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`).

## 7. API endpoints

All under `/api/v1`, in `backend/openapi.yaml` (tag `themes`).

| Method and path | Who | What |
|---|---|---|
| `GET /stores/{storeId}/theme` | owner | draft, tokens, checks, published theme, undo/redo state |
| `GET /stores/{storeId}/theme/options` | owner | presets and font pairs |
| `PUT /stores/{storeId}/theme/draft` | owner | save the draft (`{ theme }`); returns corrections |
| `POST /stores/{storeId}/theme/undo`, `/redo` | owner | step through the draft |
| `POST /stores/{storeId}/theme/publish` | owner | make the draft live |
| `GET /stores/{storeId}/theme/versions` | owner | last 10 published versions |
| `POST /stores/{storeId}/theme/versions/{versionId}/restore` | owner | load a version into the draft |
| `POST /stores/{storeId}/theme/assistant` | owner | AI design assistant (quota, rate limits) |
| `POST /stores/{storeId}/theme/polish` | owner | Finish and polish |
| `GET /stores/{storeId}` | anyone | public profile, now with the published theme |
| `GET /stores/{storeId}/reviews/featured` | anyone | up to six recent published 4 and 5 star written reviews, for the reviews section |

## 8. Permissions

Every theme endpoint runs `requireAuth`, the tenant context and `requireOwner` on the server: a Manager, a cashier, a shopper and another store's owner all get 403, and no one signed in gets 401, before any AI call or quota use. The browser hides the sidebar entry from non-owners, but that is a convenience; the server is what refuses. Logo and banner files go through the existing image upload (owner or staff with the Products permission), but only the owner can put them in a theme.

## 9. Setup

1. `cd backend && npx prisma migrate deploy` (adds the two tables).
2. `cd frontend && npm install` (adds the six font packages).
3. In `backend/.env`, set **`ANTHROPIC_API_KEY`** to your own key from the Anthropic Console (`.env.example` has an empty placeholder). Never commit it; `.env` is git-ignored. Check it with `npm run ai:check` in `backend/`; it reports whether the key is accepted without printing it.
4. Optional: `RATE_LIMIT_THEME_AI_MAX`, `RATE_LIMIT_THEME_AI_STORE_MAX`.

Without a key, everything works except the assistant, which shows the "temporarily unavailable" message. The e2e server (`npx tsx scripts/e2e-server.ts` in `backend/`) has a stand-in AI that answers the design assistant, so the whole Studio can be tried without a key.

## 10. Tests

| Suite | Command | Covers |
|---|---|---|
| `backend/tests/unit/themes.test.ts` | `npx jest tests/unit/themes.test.ts` | schema (17 refusals), contrast arithmetic, the guard (presets, corrections, 400 random themes), token allowlist, fonts, default theme |
| `backend/tests/integration/themes.test.ts` | `npx jest tests/integration/themes.test.ts` | draft vs publish, undo/redo, 10 versions and restore, what a theme can carry, own-store images, SVG and oversize uploads refused, 401/403 for everyone but the owner, tenant isolation, featured reviews |
| `backend/tests/integration/theme-assistant.test.ts` | `npx jest tests/integration/theme-assistant.test.ts` | with a mocked AI provider: valid output applied and charged once, invalid output retried once, two failures charge nothing, injection ignored, AI down (no charge, controls work), polish, permissions |
| `frontend/tests/storeTheme.test.ts`, `themeStudio.test.ts`, `themeColours.test.ts`, `nginxConfig.test.ts` | `npm test` in `frontend/` | token allowlist, cache, before-paint script agrees with the app, preview message guard, logo colours, no hard-coded colours, same-origin framing |
| `frontend/e2e/store-themes.e2e.mjs` | `node e2e/store-themes.e2e.mjs` | three presets on a real storefront, AA in the browser, sections, draft not public, checkout themed, platform untouched, no flash |
| `frontend/e2e/theme-studio.e2e.mjs` | `node e2e/theme-studio.e2e.mjs` | the owner's whole journey, Manager refused, AI failure, phone bottom sheet; screenshots in `frontend/e2e/shots/theme-studio/` |

The browser suites need the e2e server and `npm run dev` in `frontend/`; run `npx tsx scripts/cleanup-test-data.ts` in `backend/` afterwards.

## 11. Known limits

- The assistant has not yet been tested against the real Anthropic API: the key in this environment is still rejected (HTTP 401). All AI tests use a stand-in provider.
- *Match my logo colors* reads a logo that was uploaded in this Studio session, or one served from a host that allows the browser to read it; otherwise the owner is asked to upload it again.
- The six font pairs cover Latin script only; Urdu text in a headline falls back to the device's own font.
- The draft history and versions are per store, not per person; two owners' windows editing at once get a "reload" message rather than a merge.
- Themes apply to the storefront and checkout. Stripe's own hosted payment page keeps Stripe's look.
- In one of 15 runs of `store-themes.e2e.mjs`, one check failed once and could not be reproduced in 12 further runs; which check it was is not known.
