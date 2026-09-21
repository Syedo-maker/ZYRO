# Phase 3 frontend: storefront, customer account, admin dashboard and marketing

Status: complete and verified in real Chromium (91 checks in the new browser suite `frontend/e2e/phase3-storefront-admin.e2e.mjs`, 30 new backend checks in `verify-customers.ts`). All earlier suites still pass: 647 backend checks in total, and the browser suites phase 1 (24), phase 2 checkout (49) and POS (70). The phase 1 rate-limit browser suite (5 checks) was not re-run because the login limiter was not touched; it needs a separately started rate-limited backend.

The screens follow the wireframes `Main`, `CategoryListing`, `ProductDetail`, `AdminDashboard` and `AdminMarketing`. One addition was agreed with the project team: a customer page (sign-up, login, My account, review form), because without it a shopper could not leave a review or look at an old order.

## Storefront

- **Home.** Store name and a short welcome, the eight newest products with price, star rating and Add to cart, and a tile for every category showing how many products it holds. A category bar sits under the header on every storefront page.
- **Category and search.** Everything the shopper chooses (words, category, price range, in stock only, sort, page) lives in the address, so a result page can be bookmarked, shared and reached with the back button. Twelve products a page, with paging. While a new page loads the old results stay on screen, dimmed, so the page does not flash empty. Sorting offers most relevant (only when searching), newest, price both ways and name. On a phone the filters fold into a "Filters" section.
- **Search box.** A proper combobox: suggestions appear as the shopper types (partial words work), the arrow keys move through them and are announced to screen readers, Enter opens the product or runs the search.
- **Product page.** Large image, price, stock state, quantity and Add to cart, and the reviews section: the average, the one-to-five-star breakdown, every published review with a "Verified purchase" badge and the store's reply, and the review form (star picker, title, comment). A shopper sees their own review with Edit and Delete, and is told when the store has hidden it.
- **Cart and checkout.** The checkout page gained the discount code box (Apply, Remove, a reason when a code is refused; a code that stops working while the shopper is on the page is dropped with the reason). The total always comes from the server. The cart page no longer shows the disabled "coming soon" code box; it points to checkout.

## Customer account

- **Sign up and log in** at `/store/:id/account/register` and `/account/login`. Accounts are not tied to one store: the same email works in every ZYRO storefront. Buying still does not need an account.
- **Guest cart is kept on sign in.** Signing in used to lose a cart built as a guest. The backend now has `POST /stores/:id/cart/merge` (the guest cart is claimed atomically, quantities are capped at stock, deleted products are skipped, repeating it does nothing) and the cart context calls it whenever the sign-in state changes.
- **My account** lists the shopper's orders in that store, newest first, and each order opens to its items, totals, discount, shipment and refunds. The shopper view of an order leaves out staff fields (cashier, shift, location, customer id, manual-discount reason).

## Admin

- **Dashboard.** Four tiles (net sales, orders, average order, refunds) each compared with the previous period, a sales-per-day stacked chart split into online and in-store (colours checked with the dataviz validator for colour-blind safety; hover tooltip, legend, and a "View as table" for screen readers), where sales come from, top products, recent orders, and new customers, discounts given, tax collected and product margin. Seven, 30 and 90 day views. Figures come from the analytics endpoint and match the POS daily report by definition.
- **Marketing.** The discount code table (code, type, value, uses, status, dates), create, edit, duplicate, and an on/off switch. A code that is switched off is refused at checkout (tested end to end).
- **Reviews.** Every review in the store with filters by status, hide and show, and a public reply.
- **Layout.** Below the large breakpoint the sidebar becomes a scrolling top bar, so the admin is usable on a phone. Navigation now enables Dashboard, Reviews and Marketing; Settings remains disabled.

## What the browser suite covers (91 checks)

Storefront browsing, the combobox, filters, sorting and paging, the product page, customer sign-up, login and logout, the review lifecycle (create, edit, delete, hide by the store, reply), a checkout with a discount code through the stood-in hosted page and a signed webhook, the account order page with the verified badge, the dashboard (tiles, chart, tooltip, table view, period switch, channel split), marketing (create, duplicate, switch off, edit, refused at checkout), phone layouts with no sideways scrolling, and no console errors.

## Defects found by testing and fixed

- Signing in lost the guest cart (cart merge added).
- Partly filled rating stars were squashed (the star row now keeps its width).
- The admin was unusable on phones (responsive navigation).
- The old checkout tests relied on the placeholder product grid, the disabled code box and a ten-key tab limit; they were updated to the real screens.

## Deliberate limits

- No filter or sort by rating: ratings are computed on read, as the plan specifies, so the catalog cannot order by them (see the search and reviews document for the small change that would allow it).
- The abandoned-cart and AI-usage tiles from the dashboard wireframe are left out: the first belongs to the Phase 3 abandoned cart module and the second to the AI module, neither built yet.
- After login the merchant still lands on Products (`/admin/products`), not the new Dashboard, to keep the earlier tests and habits stable. Dashboard is one click away.
- Product images are still placeholders (a letter tile) when a product has none.
