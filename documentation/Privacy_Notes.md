# Privacy Notes

Plain statements of how ZYRO uses data, to go into the product's privacy policy (there is no published policy page yet; this file is the source for one). Each section names the part of the system it describes, so it can be kept true as the code changes.

## Automated checks on your store's totals (Growth Advisor, Part C)

Once a week ZYRO runs automated checks on your store's own totals, such as sales over the last 30 days compared with the 30 days before, which products are running low, how many abandoned-cart reminders were sent, and how much of your plan you have used, to suggest one practical tip on your dashboard.

- The checks use **totals and your own catalog** (product names and stock levels). They never use your customers' names, emails, phone numbers, addresses or order details.
- When a tip is written by AI, only those totals are sent to the AI provider (Anthropic), and never any customer data. The cost is paid by ZYRO, not taken from your AI allowance.
- Your figures are never used to write another store's tips.
- You can switch tips off at any time from the dashboard ("Turn off tips"). When they are off, the checks do not run for your store.

## Platform view (Part A)

ZYRO's own operators can see per-store totals (plan, number of products and orders, sales and AI use) to run the service. They see no customer data and no store owner's email address on that view.

## AI features in general

Every AI feature sends the provider only what that feature needs (for example, a product's title and description to write its description). AI never handles payments or card data, and AI never decides a price or an amount.

## What shoppers search for (AI product suggestions, 2026-10-05)

When a shopper searches in a shop, ZYRO counts the words they searched for, so that the AI can
suggest product names and descriptions built on what people are really looking for rather than on
guesswork.

- **What is stored: the words searched for, which shop, the category filter, and the date. Nothing
  else.** No name, no account, no session, no device, no IP address, and no time of day.
- A word is counted once per shop per day, however many times it is searched, so the count cannot be
  used to follow one person through an afternoon.
- Anything that looks like a way to contact or identify somebody is **not stored at all**: an email
  address, a phone number in any of the ways people write one, or any run of seven or more digits
  (which also covers order numbers, card numbers and national id numbers). Very short terms and
  pasted sentences are not stored either.
- These counts are only ever read across many shops at once, and a word is only reported once at
  least five different shops have seen it. One shop can never read another shop's searches, and no
  shop is ever named.

## Your shop in the public directory (2026-10-05)

Shoppers arriving at ZYRO without a shop in mind see a list of shops.

- Only your **shop name, logo, theme colour, currency, category and the one line you write about
  your shop** appear there. Nothing about your sales, orders, plan, staff or the people who run the
  shop.
- The category shown is worked out from what your own products are in; you do not enter it.
- Listing is on by default and you can turn it off at any time from Settings ("List my store in the
  public directory"). An unlisted shop still works normally for anyone who has its link.
- A shop with fewer than three products is not listed, so half-finished shops are not advertised.

## Sales trends across shops (Product Scout, 2026-10-22)

Product Scout adds up paid orders across shops into totals per product type and category, in each currency separately, for owners and Managers deciding what to stock. Trend Scout does the same per category each week.

- **When a total is shown.** At least 3 different shops must have sold it, no single shop more than 60% of it, and no two shops more than 85% of it together (`SCOUT_MIN_STORES`, `SCOUT_MAX_STORE_SHARE`, `SCOUT_MAX_TOP_TWO_SHARE`). This is checked for every product type and category, in the current and the previous period. Anything that fails is hidden whole, never shown with some numbers missing.
- **No subtraction.** A total is held back when taking other shown totals away from it would reveal a figure that fails those rules.
- **What is never shown.** Shop names, ids, customers, orders, prices, and any one shop's own sales. Products are named from common title words.
- **The AI.** It is given only the totals, and every number it writes is checked against them.
- **Demo stores.** They are kept out of these totals entirely.
- **The owner's choice (2026-10-23).** "Include my shop's sales in shared platform trends" on the Settings page, on by default and owner-only. Off leaves the shop's orders out of every shared total (Product Scout and Trend Scout) from the next daily run; the shop still sees the trends. The Privacy Policy and the Terms describe it.

Details: `Product_Scout.md`.

