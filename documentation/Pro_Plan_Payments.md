# Pro plan payments by transfer

A store owner upgrades to Pro by paying the platform by bank or wallet transfer. The AI reads the
payment screenshot and prepares the decision, but a person always decides: only a platform admin whose
email is in `PLAN_APPROVER_EMAILS` can confirm that money arrived.

## The flow

1. The owner opens **Upgrade to Pro** (`/admin/upgrade`). They see the price in their billing currency,
   the payment details for that currency, and this notice: "Your payment is reviewed by a person. This
   usually takes 24 to 48 hours. Your money is safe, and you get a refund if the request is rejected."
2. **Get my reference code** opens a request with a code such as `ZY-AB12-K7Q2MX` (the end of the store
   id and a random part). The owner pays and puts the code in the transfer note.
3. The owner uploads the screenshot and enters the transaction ID. The file goes to private storage only.
   A transaction ID that any request already used is refused at once.
4. The AI reads the screenshot into a fixed set of fields. The server then checks those fields:
   - the amount and currency against the price table
   - the receiver against your own payment details
   - that the date is recent
   - that the transaction ID matches and has not been used before
   - any signs of editing

   The result is one of: all checks passed, needs a close look, or needs manual review (the AI could not
   be used).
5. Every approver gets a plain-text email with their own review link. The link only opens a page that
   needs the approver's own platform admin sign-in. Opening it never approves or rejects anything.
6. On that page, or in the queue at **Platform > Plan payments waiting for approval**, the approver
   approves or rejects. The first decision wins; anyone after that sees "already decided".
7. **Approve** gives Pro for 30 days from the approval date, through the same plan logic as the
   `set-plan` script. It writes an audit entry, locks the owner's billing currency, and emails the owner
   a receipt. If the store is already on Pro, renewing early keeps the days left.
8. **Reject** records the reason and emails the owner with the refund instructions.
9. Later, an approver can **Revoke** an approved plan (a refund or reversal) with a reason.

## Over time

A background job runs every 15 minutes:

- It reminds all approvers about a request still waiting after 24 hours, and again after 48 hours.
- It emails the owner 7 days and 1 day before a paid plan ends.
- It moves a plan past its end (plus the 24-hour grace) back to Free and tells the owner.
- It never deletes anything from a store, and leaves stores managed by Stripe alone.

## Provisional Pro (off until you switch it on)

With `PLAN_PROVISIONAL_ENABLED=true`, a payment whose every automatic check passes with high confidence
gets Pro at once for 48 hours, before anyone approves. It is shown as "Provisional" to the owner and in
the queue, and it has lower AI limits than full Pro.

- Each owner account gets it once, never once per store.
- It is never given while the AI is unavailable or switched off.
- At most `PLAN_PROVISIONAL_DAILY_CAP` grants are made a day across the platform.
- Approving turns it into the full 30 days from the approval date.
- Rejecting it, or 48 hours passing with no decision, puts the store back on Free. Nothing is deleted,
  and the owner is told. A request whose provisional time ran out is still waiting for a decision.

## Currencies and the price table

- Each owner account pays in one currency. Until the owner chooses, it follows their store: PKR stays
  PKR, anything else is USD. The owner can change it on the upgrade page until a payment is approved.
- After that it is locked, and only an approver can change it (with a reason, in the audit log).
- Prices come only from `PLAN_PRICES`. No exchange rate is ever applied, so the owner pays exactly the
  amount shown.
- The payment details shown for each currency come from `PLAN_PAYMENT_METHODS`.
- To add a currency, add it to both settings. It must be one the platform already supports for stores.

## Settings

Example values only. Enter the real ones on the host, never in the repository.

| Name | Example | What it does |
|---|---|---|
| `PLAN_PRICES` | `{"PRO":{"PKR":3000,"USD":12}}` | Price per plan and currency, in whole units |
| `PLAN_PAYMENT_METHODS` | `{"PKR":[{"label":"Bank transfer","accountTitle":"Your Name","accountNumber":"PK00BANK0000000000000000","bank":"Your Bank"},{"label":"JazzCash","accountTitle":"Your Name","accountNumber":"03000000000"}],"USD":[{"label":"Wise","accountTitle":"Your Name","accountNumber":"your-wise-details"}]}` | What the owner sees to pay you, per currency |
| `PLAN_APPROVER_EMAILS` | `you@example.com, second@example.com` | Who is asked to approve. Each must also be a platform admin (`npm run super-admin`) |
| `PLAN_REFUND_INSTRUCTIONS` | `Your payment will be returned within 7 working days.` | Sent with a rejection or a revoke |
| `PLAN_PERIOD_DAYS` | `30` | Length of a paid period |
| `PLAN_PROOF_MAX_AGE_DAYS` | `7` | Older payment dates are flagged |
| `PLAN_PROOF_MODEL` | `claude-haiku-4-5` | The AI model that reads screenshots (the cheap one by default) |
| `PLAN_PROVISIONAL_ENABLED` | `false` | Provisional Pro on or off |
| `PLAN_PROVISIONAL_HOURS` | `48` | How long provisional Pro lasts |
| `PLAN_PROVISIONAL_DAILY_CAP` | `5` | Most provisional grants per day, across the platform |
| `PLAN_PROVISIONAL_AI_GENERATIONS` | `40` | AI generations allowed while provisional |
| `PLAN_PROVISIONAL_AI_CHAT` | `150` | Assistant replies allowed while provisional |
| `PLAN_PROVISIONAL_MIN_CONFIDENCE` | `0.9` | How sure the screenshot reading must be |
| `RATE_LIMIT_PLAN_PAYMENT_MAX` | `10` | Uploads and submissions per store, and per person, per hour |

The feature needs email (`EMAIL_PROVIDER` and its key) to reach approvers. The screenshot check needs an
AI key, but without one every request still reaches you as "needs manual review".

## What is manual today, and what a gateway could automate

**Manual today:**
- The owner pays outside Zyro, by bank transfer, JazzCash, Easypaisa or an international transfer, to
  the details you configure.
- You check your own account and approve or reject.
- Refunds are made by you, outside Zyro. Zyro records the revoke and tells the owner.
- Conversion into rupees is done by your bank or payment provider. Zyro records what the owner paid
  (amount and currency) and, if you enter it, the rupee amount you received, for your own books.

**Not built:** no payment gateway is connected for plans. JazzCash, Easypaisa and Safepay are built for
shop checkout but not connected, and none of them confirms plan payments.

**What a gateway could do later:** plan activation goes through one function
(`backend/src/modules/billing/planActivation.ts`). A verified gateway webhook can call it without a
person, and it writes to the same audit log.

## Security

- **Server-side checks:** every endpoint checks access on the server. An owner sees and creates requests
  only for their own store, and only approvers decide.
- **Private proofs:** proofs are stored privately and shown only through signed links that expire.
- **Safe logs:** logs carry ids, never images, keys or personal details.
- **Untrusted text:** text inside a screenshot is treated as data. The AI is told to ignore instructions
  in it and to flag them. It never sees what the owner typed, and its reply must match a fixed shape
  exactly or it is discarded.
- **What never activates a plan:** an amount or currency mismatch (the approver must confirm the exact
  price arrived), a reused transaction ID, or an expired or used review link.
- **Review links:** they are random, only their hash is stored, they last about 24 hours, and they are
  used up by the decision.
- **AI controls:** the screenshot check respects the AI kill switch and the platform's daily AI limit.
  The platform pays for it, so a failed call never touches the store's AI allowance.

## For the viva

Owners pay by ordinary transfer, so there is no gateway fee and nothing to integrate. The system makes
that safe without the platform owner being online all the time:

1. **The AI only reads.** It turns the screenshot into a few fields and decides nothing. The server
   compares those fields with facts it controls (the price table and the platform's own accounts).
   That is why prompt injection in a screenshot cannot approve anything.
2. **A person confirms the money arrived.** Only a signed-in platform admin on the approver list can
   approve. The emailed link only opens the page, so mail scanners and forwarded emails cannot approve.
   The first decision wins, so two approvers can never double-activate a plan.
3. **Provisional access covers the offline time.** When switched on, a payment that passes every check
   gets 48 hours of limited Pro while waiting for a person. It is given once per owner and capped per
   day, and it ends by itself unless approved.
4. **One audited switch.** Approvals, provisional grants, expiries, revokes and the admin script all go
   through one function that records who, when, which request and how much. A future payment gateway
   can call the same function.
