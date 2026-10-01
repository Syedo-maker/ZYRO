# Part E: AI Payment and Trust

Status: built and tested. 90 unit tests (`payments`, `gateways`), 47 end-to-end tests (`payments`) and 19 browser checks (`partE-payments`); the full gate is listed at the end.

`find-skill`: installed **`pakistan-payments-stack`** (github.com/sickn33/antigravity-awesome-skills, 39 stars). It covers the gateway half of this part: provider adapters behind one payment boundary, webhook signature checks over the raw body, idempotency guards and daily reconciliation. Its rules match what ZYRO already does for Stripe, including "never mark succeeded from a client redirect alone". Security review: one file, no scripts, nothing sent anywhere, no credential reading, no safety overrides. Two candidates were rejected: `fintech-fraud-detection` (machine learning, 3DS2 and device fingerprinting, the opposite of the explainable rules this part needs, and its listing shows a YAML error) and the OCR skills (they install Python OCR engines locally, while ZYRO's rule is that every AI call goes through the orchestrator, which `claude-api` already covers).

## Why this part exists

Most online shopping in Pakistan is paid in cash when the parcel arrives. That is the opposite of a card payment: the merchant sends the goods out before being paid, and a refused parcel costs them the delivery both ways. Stripe also does not accept Pakistani businesses, so a real shop here needs local ways to take money. This part builds those, and the checks that make them safe enough to use.

## What was built

| Piece | What it does |
|---|---|
| **Cash on delivery** | A real order, placed without paying. The stock is held from the moment it is placed; the payment sits PENDING until a person records the cash as collected. |
| **COD Trust Agent** | Scores how likely a parcel is to be refused, in plain code, and tells the merchant every reason. |
| **Bank or wallet transfer** | The shopper sends the money themselves and uploads the receipt. |
| **Payment screenshot verifier** | The AI reads the receipt; the server compares what it read with the order; the merchant decides. |
| **Gateway adapter** | One seam for JazzCash, Easypaisa, Safepay and XPay, with a contract test every adapter must pass. |
| **Courier cash reconciliation** | Reads a courier's cash file and matches it against the store's own orders. |
| **Payment-failure helper** | Explains a failed payment in English, Urdu or Roman Urdu, and what to do next. |

## The rule that shapes the whole part

**The AI flags and explains. It never approves, refunds, or changes an amount.**

Every AI touch-point in Part E is deliberately built so that it *cannot* do those things, not merely told not to:

- The screenshot verifier is given **no order total and no expected reference**, so it has nothing to agree with. It is asked only "read this receipt" and replies with what is printed. The comparison happens afterwards in code (`proof.checks.ts`). A reply with extra fields such as `approved: true` is dropped by the parser, which keeps only the fields it knows. Tested.
- **A payment becomes SUCCEEDED in exactly two places**, both requiring a person: a merchant accepting a screenshot, and a merchant recording cash as collected. Both record which user decided.
- The **trust score never calls the AI at all.** It is rules, start to finish, and a test asserts no AI call happens while scoring.
- The **failure helper** may not say a payment succeeded, promise a refund, mention an amount, or carry a long number. Its sentence is checked against those before a shopper sees it, and a failing sentence is replaced with a written answer.
- **Importing a courier's file changes no payment.** A spreadsheet is evidence, not authority; it reports, and the merchant settles up.

## The COD Trust Agent

### What it may look at, and what it may not

The allowed inputs are a short, explicit list (`ALLOWED_INPUTS` in `cod.risk.ts`), and a test asserts the rules take exactly those and nothing else:

| Allowed | Why |
|---|---|
| Order total against the store's own average | More cash at risk if the parcel comes back |
| Number of items | A big parcel is expensive to send out unpaid |
| Whether a phone was given, and whether it looks like a real number | A courier that cannot ring ahead usually fails the delivery |
| Whether the address has a street, a city and a name | An incomplete address cannot be delivered |
| This store's own earlier cash deliveries to this shopper | The best signal there is, and the merchant's own data |
| A platform-wide count of refusals for that phone number | Catches someone who has done this at other shops |

**Never used, and the reasons matter:**

- **The shopper's name**, or anything read from it. Names carry ethnicity, religion and caste in Pakistan. Scoring on them would be discrimination, not risk measurement.
- **The area, city or postcode.** Whole neighbourhoods would be marked down for where people live, which is both unfair and a well-known way for a scoring system to become redlining.
- **Gender, age, or the language the shopper writes in.**
- **Device, IP or browser fingerprint.** Not collected, and a poor guide to a cash payment that someone else often hands over at the door.

### How a score is explained

Points are added, never multiplied, so the reasons shown to a merchant add up to the score exactly. Good history subtracts, so a regular customer stays low risk even on a large order. A merchant sees every line on the order:

> **+45** This shopper has refused 1 cash delivery from your store before.
> **+10** This order has 12 items, which is a large parcel to send out unpaid.
> **-20** This shopper has taken 4 cash deliveries from your store without trouble.

**A band is never shown without its reasons.** The browser test caught a case where no rule fired at all (a shopper with one clean delivery elsewhere and none at this store), leaving a bare "Low risk" with nothing behind it, which is exactly the unexplained number this part exists to avoid. A quiet order now says so in words, with zero points.

Bands: under 35 low, 35 to 64 medium, 65 and over high. What happens at each band is the merchant's setting, not ours: offer it to everyone, withhold it from high risk (the default), withhold from medium too, or ask for a deposit instead of refusing outright. **The shopper is never shown a score or a reason**, only that the option is not available: explaining it would teach anyone how to word an order around it.

### The platform-wide signal, and its privacy

A shop learning "this number has refused deliveries elsewhere" is the single most useful thing one shop can tell another. It is also the easiest thing to get wrong, so the shared table (`CodPhoneSignal`) holds exactly six columns: a hash, two counts, two timestamps and an id.

- The phone number is stored as **SHA-256 of its last 10 digits with a server-side pepper**. Without the pepper, every Pakistani mobile could be hashed and looked up, which would make the table reversible; with it, it is not.
- **No store id, no order id, no name, no readable number** is stored, and a test asserts the stored row contains none of them.
- A store sees only "this number has refused *n* cash deliveries at shops on ZYRO", never which shops. Tested.
- A refusal counted by the store's own history is **not counted again** from the platform signal, so one bad delivery is never punished twice.

## The payment screenshot verifier

1. The shopper uploads the receipt. The upload is open to guests, because a shopper is not logged in; what guards it is **the order**, which must exist in this store, have been placed as a bank transfer, and still be unpaid.
2. The image is loaded from our own uploads folder only. The URL must be one this server issued, and the file name must be a plain name, so a shopper cannot point it at another path on the server and have its contents sent to the AI.
3. The AI replies with JSON and nothing else. The parser keeps only the fields it knows, with the right types.
4. The server compares that with the order and records findings, each marked `ok`, `warning` or `problem`. The checks that need no AI (the amount the shopper typed, and a reference reused on another order) **run even when the AI is unavailable**.
5. The merchant accepts or rejects. Accepting is the only thing that pays the order.

A reused transfer reference is caught twice over: by a count that puts it in the findings, and by a unique key on (store, reference) that refuses the second one outright.

## The gateway adapter

`PaymentGateway` is a two-method interface: create a payment, and verify a callback. The contract every adapter must keep is written once (`gateway.contract.ts`) and run against each of them:

- The amount comes from the server, never the client.
- A redirect back is not a payment: only a verified callback may report one as paid.
- An unsigned, altered or re-used-signature message is rejected, never treated as unpaid-but-fine.
- The provider's payment id is stable, so a repeated notice is the same payment.
- No card details ever reach us.

**No real provider adapter ships yet, deliberately.** JazzCash and Easypaisa publish their exact field names, hash formulas and sandbox URLs only to merchants with an account. Guessing them would mean shipping code that has never run against the real thing, which the installed skill warns against in its own first rule and which this project's plan rules out too. What ships instead is a **working test gateway** that signs its callbacks with HMAC-SHA256 and rejects forged ones, so the whole flow around a gateway is built and tested now; it refuses to run unless `GATEWAY_MOCK_ENABLED=true`, so it cannot be left on in front of real shoppers. A real adapter is written from the merchant documents and must pass the same contract test before it is turned on.

## Courier cash reconciliation

Couriers in Pakistan (TCS, Leopards, M&P, Trax) each send their own spreadsheet. Rather than an adapter per courier, the reader finds the order and amount columns by the headings they actually use ("CN No", "COD Amount (PKR)", "Consignment", "Collected"), and reads amounts written as "1,250.00", "Rs. 1250" or "1250/-". A file whose columns cannot be found is refused with a message naming exactly which one was missing.

Each line comes back as `matched`, `amount_mismatch` (with how much short or over), `unknown_order`, `duplicate_in_file`, or `not_cod` (the courier collected for an order that was not cash on delivery). Importing changes nothing.

## The payment-failure helper

Seven common failures have written answers in English, Urdu script and Roman Urdu, so the helper works with **no AI call at all**, which is the usual case. The AI is asked only when a gateway sends a code we do not know, and only to turn the bank's own words into one plain sentence; the next step always comes from the table. Why Roman Urdu as well as Urdu script: many Pakistani shoppers read Urdu written in English letters more comfortably than Urdu script on a phone.

## What a merchant sees

A **Payments** page: the cash-on-delivery queue with a "Why this score?" on every order, the screenshots waiting to be checked beside what the AI read, and the courier-file import with its line-by-line result. **Settings** gains a "Ways to pay" panel for turning each method on, setting COD limits and how strict the trust check is, and the bank details shoppers are shown.

## API

Shopper: `POST /stores/{id}/payments/options`, `/orders`, `/orders/{orderId}/proof-image`, `/orders/{orderId}/proof`, `GET` the same proof, `POST /help`.
Merchant (`orders_write`): `GET /cod/pending`, `POST /cod/orders/{id}/outcome`, `GET /proofs`, `POST /proofs/{id}/review`, `GET|POST /remittances`, `GET /remittances/{runId}`.
Owner: `GET|PATCH /settings`.

Tables: `PaymentSettings`, `CodAssessment`, `CodPhoneSignal` (no tenant: it belongs to no store), `PaymentProof`, `CodRemittanceRun`, `CodRemittanceItem`. Migration `20261001000000_payment_and_trust`. All but `CodPhoneSignal` are registered as tenant-scoped.

## Tests

- **`payments` (unit, 75):** the allowed-inputs list, that a band always carries at least one reason, and that none of it is a name, area or device; what raises and lowers a score, and that the reasons add up to it exactly; the platform signal never naming a shop and never counted twice; Pakistani and foreign phone shapes; what each band does under each setting; the screenshot checks for a short amount, a reused reference, a backdated receipt, the wrong currency and an unreadable image, and that the server's own checks still run with no AI; every failure reason in three languages, and six kinds of AI sentence that are thrown away; courier files with four heading styles and four amount formats, and matching that catches short, over, duplicate, unknown and not-COD lines.
- **`gateways` (unit, 15):** the shared contract (tampered amount, flipped status, missing signature, a signature from another message, unreadable body, stable ids, no card fields), the registry, swapping a provider in, and that the test gateway refuses to run outside test mode.
- **`payments` (end to end, 47):** a COD order holding stock exactly as a paid order does; the shopper never seeing a score; the cash collected being what pays it; a short handover refused; a refused parcel restocking and cancelling; the phone signal's columns and irreversibility; the AI never called while scoring; limits and permissions; the screenshot flow start to finish including the AI being sent no totals, an AI reply trying to approve a payment, a reused reference, an unreachable AI, and a path-traversal image URL; a courier file reconciled line by line against hand-made rows; the Urdu answer with no AI call; and that no card number can reach an order or an AI prompt.

## Deliberate limits

- **No real local gateway yet**, for the reason above. The seam, the contract test and a working test provider are all in place.
- **CSV courier files only.** A PDF would need a parser or a vision call per page; the plan mentions PDF, and the CSV path covers what couriers actually email.
- **The deposit on a risky order is recorded but not yet collected separately.** The checkout says a deposit is required; taking it as a separate card payment belongs with the gateway work.
- **The trust score does not learn.** It is fixed rules with fixed points, on purpose: a merchant can read it, argue with it and predict it, which a trained model would not allow.

## Full gate (2026-10-01)

| Suite | Result |
|---|---|
| Backend (Jest and Supertest, `npm test`) | 34 suites, 1,327 tests pass (1,171 before Part E) |
| Python recommendation service (pytest) | 14 pass |
| Browser suites with the test server | 14 of 14 pass, including `partE-payments` (19) and `phase1-security` with rate limiting on |
| API contract | valid (`redocly lint`), and every new operation is in `Phase0_Traceability.md` (checked by `contract`) |
| Leftovers | none: test data cleaned, no payment rows left on real stores |

Two bugs were found by the gate rather than by writing it, and both are fixed here:

1. **The analytics suite carried a time bomb.** It seeded an order dated 1 September and assumed it would always fall inside a rolling "last 30 days" window. On 1 October it did not, and four checks failed. The test now works out what the window should contain instead of hardcoding it. This was pre-existing and nothing to do with Part E.
2. **A COD band could be shown with no reasons behind it** (see above). Caught by the browser test, which could not find the "Why this score?" button because there was nothing to show.
