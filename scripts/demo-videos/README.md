# Walkthrough videos

Code-made walkthrough videos of ShopMind AI (ZYRO), one per role: Owner, Manager, Cashier and
Customer. Every scene is filmed with Playwright from the running app, in a demo store with demo
accounts. Captions, title cards and the end card are added with ffmpeg. No AI video generation is
used, and the videos are silent, ready for a voiceover.

## What you need

- **The app running locally:**
  - `npm run dev` in `frontend/`;
  - Redis, MongoDB and Postgres.
- **The backend**, with the showcase store allowed into the shop directory (development only):

  ```powershell
  cd backend
  $env:DIRECTORY_SHOWCASE_DEMO_SLUG = "demo-scout-video-showcase"; npm run dev
  ```

- **The recommendation service** with speech to text on, for the voice notes chapter:
  - `WHISPER_ENABLED=true`, and optionally `WHISPER_MODEL=base`;
  - `faster-whisper` installed in its `.venv`.
- **The Stripe CLI forwarding webhooks**, for the card payment chapter.
- **ffmpeg:**
  - a full build (the one bundled with Playwright is too small to make the videos);
  - by default the scripts use `D:\FYP\tools\ffmpeg\bin\ffmpeg.exe`;
  - set `FFMPEG` and `FFPROBE` to use another one.
- **The demo data** (development only; your own stores are never touched):

  ```bash
  cd backend
  npm run demo:scout:add     # the Product Scout demo stores (the trending panel's demo data)
  npm run demo:videos:add    # "Demo: Chai & Clay Co." with staff, products, reviews and a month of sales
  ```

## Making the videos

From the repository root:

```bash
node scripts/demo-videos/make-assets.mjs        # product pictures, receipt, voice note, title and end cards
node scripts/demo-videos/record.mjs owner       # films the chapters not filmed yet
node scripts/demo-videos/assemble.mjs owner     # output/shopmind-ai-owner-walkthrough.mp4 + chapter list
node scripts/demo-videos/check.mjs owner        # frames and contact sheets to look at
```

Do the same for `manager`, `cashier` and `customer`.

## Filming again after a UI change

Each chapter is filmed on its own, so one can be filmed again without the rest:

```bash
node scripts/demo-videos/record.mjs owner --only orders,team    # just these
node scripts/demo-videos/record.mjs owner --redo orders         # the missing ones, and this one again
node scripts/demo-videos/assemble.mjs owner
```

- **A chapter that worked is kept.** So the AI chapters (the Owner's five AI tools, the Customer's
  shopping assistant) call the AI once, not on every run.
- **Changing a caption doesn't need refilming.** Captions are kept as text in
  `output/clips/<chapter>.json` and burned in by `assemble.mjs`: edit them there and in the role's
  script, then assemble again.

## Showing what is clicked

The videos are made for someone who has never seen the app, so every action is shown on screen.

- **A drawn cursor.**
  - Playwright's videos don't show the system pointer, so `overlay.js` draws one.
  - It glides to each target and keeps its place across page loads and in-app route changes.
- **Every action is announced:**
  - an orange outline around the element;
  - an arrow;
  - a label held for about a second before the action, such as "Click: Add product",
    "Type: product name", "Select: category → Home decor", "Upload: product photo" or
    "Scroll down ↓ Save";
  - a ripple where each click lands.
- **The overlay never changes the app.**
  - It is one fixed layer with `pointer-events: none` and the highest z-index.
  - It is also a manual popover, so it stays above modal dialogs.
  - The label moves to whichever side of the element has room, so it is never cut off at a screen
    edge.
- **The helpers.**
  - Chapters call the film helpers in `lib.mjs`, never Playwright's plain `click` or `fill`:
    `click`, `type`, `select`, `choose`, `upload`, `press`, `hover`, `scrollTo`, `scrollBy`,
    `fields` (shows each field of a form before it is filled) and `result` (outlines what an
    action produced and holds it on screen).
  - An element below the fold is scrolled to with an announced scroll first.
- **Captions.**
  - Each chapter opens with its path ("Path: Sidebar > Products > + Add product"), reached by
    clicking, never by typing an address.
  - Then come plain "Step N:" captions. The band under the page names the role and chapter.
- **Checking.**
  - `check.mjs` saves a frame just after every announced action, as well as two frames per
    chapter, in `output/frames/<role>/`.
  - Look through the `sheet-actions-*.png` contact sheets: every frame should show the cursor,
    the outline, the arrow and a readable label.

## Where things are

| Path | What |
|---|---|
| `roles/*.mjs` | The chapters of each video: what is clicked and typed, and the captions. |
| `lib.mjs` | The recorder, the film helpers, the demo accounts and the title card text. |
| `overlay.js` | The drawn cursor, ripple, outline, arrow and label (loaded into every filmed page). |
| `assets/` | Product pictures, a demo bank receipt and the spoken voice note, all made by `make-assets.mjs`. |
| `output/` (not committed) | Clips, the finished MP4s, the chapter lists and the check frames. |
| `../../backend/scripts/demo-videos.ts` | The demo store: `add`, `remove`, `remove-signups`. |

## Keeping it clean

- **Accounts and stores.**
  - Every account is `video-…@demo.zyro.local` (not a real domain).
  - The store's address starts with `demo-scout-`, so its sales stay out of every real figure:
    the platform page, Trend Scout, the Growth Advisor and Product Scout's live numbers.
- **The shop directory.**
  - It shows the showcase store only when `DIRECTORY_SHOWCASE_DEMO_SLUG` names it, and never in
    production.
  - In the Customer video, every other shop card is blurred.
- **The Owner video's sign-up.**
  - The store it signs up live can't carry the demo prefix.
  - `record.mjs` removes it straight after filming (`npm run demo:videos:remove-signups`).
- **Removing everything:** `npm run demo:videos:remove` in `backend/`. Your real stores and users
  are counted before and after, and the scripts stop if they change.
- **Nothing secret is shown.** No `.env` value is read into a page or a video. The Stripe payment
  uses the test card in Stripe's sandbox.
