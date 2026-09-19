# Phase 2: Frontend (storefront cart, checkout, confirmation, admin orders and shipping)

**Status:** complete and verified in real Chromium against the real frontend, backend, PostgreSQL, MongoDB and Redis. Stripe's hosted payment page was replaced by a stand-in, so the real Stripe page has **not** been exercised (see "What is not verified").
**Wireframes implemented:** `Cart.dc.html`, `Checkout.dc.html`, `OrderConfirmation.dc.html`, `AdminOrders.dc.html`.

**Skill search:** `find-skill` was run first. One candidate was installed after confirmation: `frontend-ui-engineering` (addyosmani/agent-skills), a stack-agnostic quality checklist (keyboard access, loading, empty and error states, responsive checks, no "AI look"). The stack-specific candidates (shadcn, Next.js) would have conflicted with the design tokens already in place, so they were skipped. Its checklist drove the accessibility and responsive work below.

## Where the wireframes and the real backend disagreed

Comparing the wireframes with the backend before building found gaps that matter for a real business. Each was resolved rather than copied:

| Wireframe | Reality | Decision |
|---|---|---|
| Checkout shows inline email, address and card fields | The plan chose Stripe-hosted checkout (less PCI exposure). ZYRO never touches card data. | The ZYRO page handles shipping method and the summary; Stripe's page collects email, address and card. |
| Admin order shows a shipping address | The backend never collected or stored one, so a merchant could not actually ship an order. | **Backend fix:** Stripe collects the address (countries from `SHIPPING_COUNTRIES`), the webhook saves it on the order (new `Order.shippingName` and `shippingAddress`). |
| Order confirmation shows the order right after redirect | The webhook creates the order, so it can lag the redirect. | **Backend addition:** `GET /checkout/sessions/{sessionId}` reports pending, completed, refunded, failed or expired. The page polls until it knows, and tells a shopper whose last unit sold out that they were refunded. |
| Totals shown on checkout | Tax and shipping math already exists on the server. | **Backend addition:** `POST /checkout/quote` reuses the same pricing as the real session, so the browser never re-implements it and the shown total is by construction the charged total. |
| Discount code box and "SAVE10 applied" | Discounts arrive in Phase 3. | The box is visible but disabled with "coming soon", like the disabled sidebar items in Phase 1. |
| "Estimated delivery" and "Track my order" | There is no delivery estimate data, and no customer order history yet. | Left out rather than faked. |
| Admin tabs All, Processing, Fulfilled, Cancelled | The real statuses also include Completed (POS) and Refunded, and there are two channels. | Six tabs with live counts plus a channel filter and search. |

Also added to the backend for the frontend: the cart response and the public store profile now include the store `currency` so prices format correctly, and the Stripe success and cancel URLs now point at the real storefront routes.

## What was built

- **Storefront** (`/store/:storeId`): header with a live cart badge; cart page (quantity stepper capped at stock, remove, per-item warnings when stock dropped, subtotal); checkout page (shipping method from the public zone list, server-priced totals, Pay button that redirects to Stripe); confirmation page (waiting state, confirmed, refunded because sold out, expired or failed, timeout, unknown link). A guest cart is tied to a random id kept in the browser; a logged-in shopper's cart is tied to their account.
- **Storefront home** is a deliberately minimal product grid so the cart can be reached and demonstrated. It is a placeholder for the real Phase 3 storefront (Main, Category, Product Detail).
- **Admin Orders** (`/admin/orders`): status tabs with counts, search by order number or email (debounced), channel filter, paging, order detail panel (items, totals, payment method, shipping address, refund history), Mark fulfilled, Cancel (confirmation dialog), Refund (dialog with a restock choice defaulting to off for shipped orders and a reason), shipment section (carrier, tracking, Mark shipped, Mark delivered), and a shipping zones panel (add, edit, delete).
- **Shared UI:** `Alert`, `Spinner`, and a `Dialog` built on the native `<dialog>` element, so the browser traps focus, closes on Escape and restores focus.

Accessibility and responsiveness followed the installed skill's checklist: every interactive element is a real button or link with an accessible name, errors use `role="alert"` and confirmations `role="status"`, dialogs trap focus, tables use headers and `scope`, and the storefront was checked at 320px.

## Verification (real browser)

`frontend/e2e/phase2-checkout.e2e.mjs` (49 checks, passing on two consecutive runs) drives Chromium through: a guest adding items, the stock cap, cart edits and survival across a full reload; checkout totals (45.00 + 5.50 shipping + 4.50 tax = 55.00); redirect to the payment page; the confirmation page waiting while the webhook has not yet arrived and then updating by itself; the header cart badge clearing; the merchant seeing the order, the collected address, shipping it, delivering it and refunding it; an item selling out while the shopper is paying (automatic refund and the explanatory page); cancelling with Escape dismissing the dialog first; search and filters; adding to cart using only the keyboard; no horizontal scroll at 320px on shop, cart and checkout; and no console errors or uncaught exceptions.

I also looked at the screenshots, not just the assertions. That review found three things a passing test would not: the header cart badge stayed stale after an order, payment methods were lowercase ("Paid by stripe"), and the admin action buttons wrapped awkwardly. All were fixed. The browser run itself found one real bug: on a 320px phone the cart row's price and remove icon overflowed the card, fixed by letting that row wrap and shrinking the thumbnail.

The three backend suites still pass: 62 checkout checks (extended for the address, quote and status lookup), 63 orders, and 21 foundation.

## What is not verified

- **The real Stripe hosted page and real Stripe address collection.** The page was a stand-in and webhooks were signed with a test secret. Once a Stripe sandbox and keys exist, do one real purchase with card `4242 4242 4242 4242` and confirm the address arrives on the order.
- **Real email.** Stripe sends receipts only if that is enabled in the Stripe Dashboard; ZYRO sends no emails yet.

## Decisions and known limits

- **Shipping countries are one list for every store** (`SHIPPING_COUNTRIES`, default US, CA, GB, AU, DE, FR, PK, AE). It belongs in per-store settings later.
- **Every anonymous visit makes one 401 request** (the silent login restore finds no cookie). It is harmless and expected, but it shows as a red line in the browser network log. A cleaner answer would be a 204 from a dedicated session-check endpoint.
- **After a sold-out refund the cart is kept**, with the sold-out item flagged, so the shopper can adjust and try again.
- **Not built yet:** a shopper's order history, a "track my order" page, and guest cart merge on login. A buyer can already fetch a single order they placed (`GET /orders/{id}`), but there is no endpoint that lists their orders.
- **The admin layout is desktop-first;** the order table scrolls horizontally on narrow screens rather than reflowing.
- **`SHIPPING_COUNTRIES` and `STOREFRONT_URL`** are new environment variables (see `backend/.env.example`).
