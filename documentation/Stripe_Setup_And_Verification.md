# Stripe: setup and real-world verification (2026-09-19)

Until now the Stripe integration had only been tested against a stand-in. This records how a real Stripe **test sandbox** was set up, what was verified against the real thing, and the one defect only real Stripe could expose.

**Skill:** `find-skill` found that the already-installed `stripe-best-practices` skill covers this, so nothing new was installed. Its rules were followed: keys only in the gitignored `.env`, a restricted key rather than a secret key, signature verification before anything else, and no `payment_method_types` on the session.

## What is set up

| Piece | State |
|---|---|
| Stripe test sandbox | Created with the official Stripe CLI (`stripe sandbox create --email finalyear860@gmail.com`). Test mode only, no real money. |
| `STRIPE_SECRET_KEY` | In `backend/.env` (gitignored, confirmed by `git check-ignore`). A restricted key (`rkcs_test_...`). |
| `STRIPE_WEBHOOK_SECRET` | In `backend/.env`; verified to be the same secret the webhook forwarder signs with. |
| Webhook forwarding | `npx --yes @stripe/cli listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to localhost:5000/api/v1/webhooks/stripe` (must be running whenever you test payments locally). |

To repeat on another machine: install nothing globally, run `npx --yes @stripe/cli sandbox create --email <your email>`, copy the test key it saves (the CLI keeps it in `~/.config/stripe/config.toml`) into `backend/.env` as `STRIPE_SECRET_KEY`, run `npx --yes @stripe/cli listen --print-secret` and put that value in `STRIPE_WEBHOOK_SECRET`, then start the forwarder as above.

## Verified against real Stripe (22 checks, three full runs in a row)

`frontend/e2e/stripe-real.e2e.mjs` drives real Chromium through Stripe's real hosted page with Stripe's test card, and reads Stripe's own records afterwards. It refuses to run against a live key.

- **Payment:** real Checkout Session created by my code; paid on Stripe's page with `4242 4242 4242 4242`; Stripe redirected back to the storefront.
- **Webhook:** Stripe itself delivered the event (through the CLI), the signature verified, and the order appeared and the confirmation page updated on its own.
- **The order is exactly right:** total 33.00 = 25.00 items + 5.50 shipping + 2.50 tax; the shipping address typed on Stripe's page (name, street, city, state, postcode, country) was saved on the order; the customer email came from Stripe; stock dropped by 2.
- **Stripe's side agrees:** session paid and complete, charged 3300 cents in USD, the payment intent succeeded for exactly that amount, and our payment record points at it.
- **Declined card (`4000 0000 0000 0002`):** Stripe refuses on its own page, no order is created, stock untouched.
- **Merchant refund:** through `POST /orders/{id}/refund`; Stripe shows exactly one succeeded refund for the full 3300 cents, our record stores Stripe's refund id, stock is restored, and a second refund is refused with 409 while Stripe still shows one refund.
- **Sold out mid-payment:** with the shopper sitting on Stripe's page, the stock was taken; after paying, the shopper was told they were refunded, Stripe really refunded the full amount automatically, and no order was created.

## The defect only real Stripe could show

Stripe's real page displayed a **"Choose currency" switch (PKR or USD)**. This is Stripe's Adaptive Pricing, which offers shoppers a converted local price. ZYRO prices, taxes and records orders in the store's currency, and the webhook deliberately refuses to create an order when the charged amount or currency differs from what was priced. So a shopper who picked the converted currency could have been charged with no order created. Fixed by sending `adaptive_pricing: { enabled: false }`; the page now shows a single total in the store currency, and the test asserts it (`usd 3300`). The earlier stand-in had no such switch, which is exactly why a fake could not catch it.

## Things worth knowing

- **Stripe lists the payment methods it offers** (this run showed Card, Cash App Pay, Bank and Klarna for a US buyer), chosen from Dashboard settings because the code deliberately does not restrict them. Card was tested. Bank and other delayed methods complete later through the `async_payment_succeeded` event, which the webhook handles and the fake tests cover, but a real delayed payment was not run.
- **Tax appears on Stripe's page as its own line ("Tax, Qty 1")** and the subtotal shown there includes it. That is correct arithmetic but slightly unusual to read. It follows from ZYRO computing tax itself; Stripe Tax would replace it but needs a tax registration.
- **The connection to Stripe's site occasionally reset** from this machine before their page loaded (2 of the first 3 attempts). It is on the network path, not in the code; the test retries the redirect up to twice and none of the three final runs needed a retry.
- **The webhook forwarder must be running** for local payments to become orders. Without it the shopper pays but no order appears (the page eventually says the order is taking longer than usual). In production, register the endpoint in the Stripe Dashboard instead and use its signing secret.

## Security notes for the key

- **The key was printed once in this project's working session.** My output filter did not recognise this sandbox key's `rkcs_test_` prefix, so it appeared in the terminal transcript. It belongs to a temporary test sandbox with no real money, and it was never committed. Treat it as exposed: **claim the sandbox, then create your own restricted key and replace this one.**
- **Claim the sandbox before 2026-09-26** or it expires. Stripe emailed a claim link to finalyear860@gmail.com, or run `npx --yes @stripe/cli sandbox claim`.
- After claiming, in the Stripe Dashboard create a **restricted key with only what ZYRO needs** (Checkout Sessions: write, Payment Intents: read, Refunds: write) and put it in `backend/.env`. Use different keys for development and production, never put a key in source code, and only ever use `sk_test_` or `rk_test_` keys until the store is ready for real money.
- For production: enable a webhook endpoint in the Dashboard, restrict the key with an access policy, and consider adding a pre-commit check that blocks key-shaped strings.

## Not covered

Disputes and chargebacks (`charge.dispute.*` events) are not handled, and there are no partial refunds; both matter once real money flows. Stripe's own receipt emails were not checked in the sandbox. A real delayed payment method (bank debit) was not run.
