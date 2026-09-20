# Phase 3, Module 7 (part): Discount Codes (backend)

Status: complete and verified (103 new backend checks plus 4 in the security suite, and 16 checks against real Stripe). The other half of Module 7, the analytics dashboard, is a separate item in the plan and has not been started. The screens for entering a code and for managing codes belong to the Phase 3 frontend item and are not built here.

## What it does

A merchant creates codes; a shopper or a cashier applies one; the order records it. The plan's rules were kept: a code is a percentage or a fixed amount, it has an optional expiry and usage limit, and there are no stacked codes and no partial discounts (one code per order, applied to the whole order or refused). One addition beyond the plan: an optional minimum spend, which nearly every real promotion needs.

- Codes are stored upper-case and matched ignoring case and stray spaces, and are unique within a store (two stores can both have SAVE10).
- The discount comes off the subtotal only. Shipping is never discounted, and tax is worked out on the discounted amount, so a discount also lowers the tax, the same way manual POS discounts already did.
- A fixed amount larger than the subtotal takes off the subtotal, not more. Refunds do not give a use back (otherwise a refund and reorder would reuse a limited code).

## Endpoints (documented in `openapi.yaml`)

| Route | Who | Purpose |
|---|---|---|
| `GET`, `POST /stores/{id}/discount-codes` | owner or `discounts_write` | List (with status and use counts) and create |
| `PATCH /stores/{id}/discount-codes/{codeId}` | owner or `discounts_write` | Switch on or off, change limit, expiry, minimum. The code, type and value are fixed after creation so past orders stay explainable |
| `POST /stores/{id}/discount-codes/validate` | any shopper (guest or account) | "Code accepted, you save X" before checkout. Advisory; checkout checks again |
| `POST /checkout/quote`, `POST /checkout/session` | any shopper | Now accept `discountCode`; the quote returns the applied code |
| `POST /pos/quote`, `POST /pos/sales` | staff with `pos_sell` | Now accept `discountCode` |

Orders now show `discountCode`. The old refusal ("Discount codes are not available yet") is gone.

## The hard parts, and how they were solved

**Stripe charges what we tell it, and the webhook refuses an order whose charged amount differs from the priced total.** A discount therefore has to reach Stripe as a real coupon. The line items carry full prices and the tax already worked out on the discounted subtotal, and a fixed-amount coupon (created once per name, amount and currency, then reused) takes off exactly the discount, so Stripe's total equals ZYRO's to the cent. This was verified against the real Stripe sandbox, not just fakes: the session total, the coupon, a real test-card payment, the real webhook, the resulting order, the payment intent amount and a refund all agree at 27.50 (see below).

**A limited code must not be overspent while people are mid-payment.** A pending checkout holds one use of the code. The hold is simply the pending checkout itself: it counts against the limit while it is pending and not yet expired, and it stops counting the moment it is paid (then the use is counted), fails, expires, or reaches its 31-minute end. There is no release job to forget, and nothing can leak. Creating the checkout locks the code's row first, so five shoppers starting checkout at once for a one-use code get exactly one 201 and four clear "used up" answers (tested). A shopper retrying their own checkout is not blocked by their own abandoned page.

**In-store sales use the code atomically.** At the register a single statement counts the use and checks in the same breath that the code is still active, unexpired and under its limit (counting checkouts in progress). Two tills racing for the last use get one sale and one refusal (tested), and a sale that fails for another reason, such as stock, leaves the count untouched because it is one transaction.

**A shopper who already paid keeps their discount.** If the merchant switches a code off, or lowers its limit, between the shopper starting checkout and paying, the order is still recorded with the discounted price (the money was already taken) and the use is counted (tested). Only in-store sales, which are paid on the spot, refuse a code that stopped being usable.

**Codes cannot be guessed.** Wrong codes are rate limited per address (default 20 per 15 minutes, `RATE_LIMIT_DISCOUNT_MAX`) on the validate endpoint and on checkout. Accepted codes and requests with no code are never counted, so real shoppers and normal checkouts are unaffected. An unknown code, another store's code and a mistyped code all get the same answer.

**A discount must not make an order unpayable.** Stripe cannot charge zero or less than about 0.50, so online checkout refuses a code that would make the total free or tiny, with a clear reason. The quote still shows what the code would do. In-store there is no such limit except that a sale must have something to charge.

## POS behaviour

A cashier can apply a store code instead of a manual discount (both together are refused, no stacking). A store code is set by the merchant, so it is not held to the cashier's manual-discount percentage limit. The receipt shows `Discount (Code SAVE10)` automatically.

## Data changes (migration `20260920000000_discount_codes`)

`DiscountCode` gains `minSubtotal`; `CheckoutSession` gains `discountCodeId` (with an index) so pending checkouts can hold a use. Database constraints back up the API: codes must be upper-case and match the format, the value must be positive, a percentage cannot exceed 100, the usage limit must be at least 1 and the count never negative, the minimum cannot be negative. Row-Level Security for `DiscountCode` already existed.

## Verification

- `backend/scripts/verify-discounts.ts`: 103 checks against real Postgres, MongoDB and Redis through the real HTTP API. The pure rules in isolation (percentage, fixed, capping, rounding, expiry boundary, limits with holds, minimum, check order); merchant management and permissions; validation; quote, Stripe session parameters (lines + tax - discount + shipping equals the stored total), fulfilment and idempotent webhooks; holds, releases (expiry event, lapse by time, Stripe failure); the five-shopper race; honouring a paid discount after the code was switched off; POS use, no stacking, the two-till race, held-use protection, atomic rollback; returns; database constraints; and tenant isolation.
- `verify-security.ts`: 4 new checks for guessing codes, 31 in total.
- `frontend/e2e/stripe-discount.e2e.mjs`: 16 checks against the real Stripe sandbox and Stripe's real hosted page and webhooks: 25.00 of mugs, 20% off, 5.50 shipping and 10% tax gives 27.50; Stripe holds a 5.00 fixed coupon named after the code, charges exactly 2750 cents, the order and the counted use appear from the real webhook, a second checkout reuses the same coupon, a switched-off code never reaches Stripe, and a refund returns exactly the 2750 actually charged. The earlier real-Stripe suite (22 checks) also still passes.
- All earlier backend suites re-run: commerce core 21, checkout 62, orders 63, phase 1 80, POS 120. Backend total 480 checks, all passing.

## Not built (kept out on purpose)

Automatic discounts with no code, buy-one-get-one and other product-level rules, per-customer limits, codes limited to a channel or a product, scheduled start dates, free shipping codes, and stacking. Stripe's own promotion codes are not used because the discount has to be computed by ZYRO (the POS and the order record need the same number). Held POS carts do not keep a store code (they keep a manual discount); re-enter it on resume.

## Notes for the frontend item

The storefront checkout needs a code field that calls `validate` for the "you save X" message and passes `discountCode` to `quote` and `session`. The admin needs a discounts page over the list, create and patch endpoints. Both belong to the Phase 3 frontend item.
