# Phase 2.5: POS Frontend (register, receipts, history, returns, daily summary, team)

Status: complete and verified in a real browser (70 new checks; every earlier browser suite still passes).

Built from the wireframes in `design/wireframes/pos` on the existing design tokens, the shared UI parts (Button, Input, Dialog, Alert, Badge, Spinner) and the same auth and API client as the admin and storefront. Tablet first: large touch targets, and the register works from a phone width up.

## Screens and routes

| Route | Screen |
|---|---|
| `/pos` | Sends a signed-out person to the till sign-in; otherwise straight to their store (a chooser when they work at several) |
| `/pos/login` | Sign in to the register (same accounts as the admin) |
| `/pos/:storeId` | Register. With no open shift it shows "Open the register" (count the starting cash) |
| `/pos/:storeId/history` | Sales history: search by number or customer, page through, open a sale |
| `/pos/:storeId/summary` | Daily summary (managers and owners only; others are sent back to the register) |
| `/admin/team` | New admin page: add cashiers and managers, remove them, set the cashier discount limit |

Dialogs over the register: discount, customer picker (search or add), held sales, payment, sale complete with receipt, close shift, and return items (from a sale in history).

## What a cashier can do

- Scan a barcode (type and Enter adds the exact match straight to the sale) or search by name or SKU. The search field keeps focus so scanning never needs a click.
- Build a cart with quantity buttons. Totals come from the server on every change, so the screen shows exactly what will be charged. Asking for more than the shelf holds shows "Only N in stock" and blocks Charge.
- Give a discount as a percentage or an amount, with a reason. Over the cashier's limit it is refused with the limit explained.
- Attach a customer, or add one on the spot.
- Hold the sale and resume it later, on any till.
- Take payment: cash, card or other, with cash-received shortcuts and live change, or split across several payments. "Complete sale" stays disabled until the payments add up exactly. Pressing it twice, or retrying after a lost reply, cannot create two sales (one request id per payment dialog).
- Print the receipt. Printing uses a hidden copy of the receipt placed in the page body; the print stylesheet hides everything else and sizes it for an 80mm roll, so the paper gets only the receipt.
- Close the shift with a blind count: the cashier enters the cash counted, and only then sees the expected amount and whether the drawer is over, short or balanced.

A manager or owner can also take items back (choose units per line, refund method, reason, restock or not, with an estimate of the refund that the server then settles exactly) and read the daily summary (net sales, gross, refunds, sales count and average, discounts and tax, by payment method, by cashier, top items, and every shift with its variance). The summary uses the browser's own local day and can be printed.

## Other changes

- The product form now has SKU, barcode and a "charge sales tax" switch. Before this the register could not find anything by barcode from the UI.
- The admin header has an "Open register" link and the sidebar a "Team & register" page.
- `Dialog` gained a wider size. The cart survives a page reload (it is kept in session storage); the shift, held sales and everything else come from the server.

## Bugs found by the browser test and fixed

- Opening a sale from history crashed the page: the list returns order summaries without the store and cashier that a receipt needs. The full sale is now fetched when one is opened.
- On a phone the history page scrolled sideways: a screen-reader-only header cell is absolutely positioned and escaped the table's scroll box. The box is now positioned so it stays inside.
- A status line ("Sale held") stayed on screen indefinitely; it now clears after five seconds.

## Verification

`frontend/e2e/phase2_5-pos.e2e.mjs` (70 checks, real Chromium against the real backend and database): the owner adds a cashier and a manager through the admin UI and sets the discount limit; a person with no register access gets a clear message; the cashier signs in (wrong password first), opens a shift, scans a barcode, searches, hits the stock limit, is refused a 50% discount and accepted at 10%, adds a customer, holds and resumes, pays by split cash and card with change, sees the receipt (store, cashier, customer, items, discount with reason, tax, payments, change), prints, and closes the drawer 10.00 short; the manager signs in, returns one item (estimate 10.80), returns the rest (settles to 45.45), reads the summary and closes a balanced shift; tablet and phone widths fit. No console errors on any screen.

Browser checks now total 170 (phase 1: 24, phase 1 security: 5, phase 2 checkout: 49, real Stripe: 22, POS: 70). The real-Stripe suite was not re-run in this session because it needs the live webhook forwarder; nothing in the Stripe path changed apart from the order presenter fields.

To run it: start Redis, `npx tsx scripts/e2e-server.ts` in the backend, `npm run dev` in the frontend, then `node e2e/phase2_5-pos.e2e.mjs`, and finally `npx tsx scripts/cleanup-test-data.ts` in the backend.

## Not built

Email receipts (the wireframe showed a button; there is no mail service yet), a manager-PIN override at the till, cashier PIN sign-in, and offline mode. See the backend document for the full list of deferrals.
