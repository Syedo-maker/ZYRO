# Product catalogue: categories, three prices, quick stock, removed fields

Status: built and tested on branch `feature/product-listing` (2026-10-22). This is the supervisor's product-listing change. It has four parts:

1. Each store has its own **categories**, chosen from a dropdown on the product form.
2. Owners can **edit** every part of a product.
3. Every product has **three prices**: the actual price (MRP), an optional discount (an amount or a percentage), and the selling price customers pay (MRP minus the discount).
4. The **barcode** and the **haggling floor** are removed, and with the haggling floor, the whole bargaining feature.

`find-skill`: **nothing installed**. The installed skills already cover the work: `mongodb-schema-design` (the category model, the reference plus name copy, and online schema migration), `frontend-ui-engineering` (the form, the stock control and accessibility), and `writing-openapi-specs` (the contract). The one new candidate reviewed, a SuperTest API-testing skill, passed the security review but adds nothing the project's existing Jest and Supertest suites do not already do.

## Categories

### The rules

- A category belongs to one store. Every route is under `/stores/{storeId}/categories`, behind sign-in, the store's tenant context and the `products_write` permission, and every query names the store. The model's tenant plugin refuses a query that does not.
- **One name per store, whatever the capitals or spacing.** "Toys", "toys", " TOYS " and "Toys" with a tab are the same category. Each category stores two forms of its name:
  - `normalizedName`: Unicode NFKC, trimmed, inner runs of spaces collapsed to one, lower case.
  - `name`: the same without lower-casing, which is what the owner sees.
- MongoDB enforces the uniqueness with the unique index `category_name_per_store` on `{storeId, normalizedName}`, so two requests at once cannot both create "Toys". A duplicate is refused with 409, naming the category that already exists: `A category called "Toys" already exists in this store.`
- Two stores may each have a "Toys".
- **A rename reaches every product at once.**
  - A product points at its category by `categoryId`, which is the source of truth.
  - It also carries a copy of the name in `category`, because search, the storefront menu, the shop directory, Trend Scout, the AI prompts and the recommendation service all read a name.
  - Only the server writes that copy. A rename rewrites it on the category's products in the same request.
- **A category with products cannot be deleted.** The request is refused with 409 and says how many products to move: `"Toys" still has 3 products. Move them to another category first, then delete it.`
- **Disabled categories:**
  - A disabled category is not offered for new products.
  - Its products stay listed, and they can still be edited while staying in it.
  - No other product can move into it.

### The page and the form

- **Categories** is in the sidebar, between Products and Orders. The page lists each category with its product count and status, and offers add, rename, disable or enable, and delete. Every error shows the server's own explanation.
- The product form's category is a required dropdown of the store's active categories. There is no free typing.
- When the store has no categories yet, the form says so and links to the Categories page instead of showing an empty dropdown.
- The AI's suggested category is applied only when it matches one of the store's categories. Otherwise the form says so and leaves the choice alone.

### Older callers

API version 1 only ever gains fields. A caller written before categories existed still sends `category` as a name:

- The name is matched to the store's category with the same normalized name, and creates one only if the store has none.
- So "toys" from such a caller and "Toys" from the form are the same category.
- If two requests create the same new name at once, one insert wins the unique index and the other retries and finds it.

## Prices

The form shows all three prices together (discount modes, 2026-10-23):

1. **Price (MRP)**, typed.
2. **Discount (optional)**, typed, with an **Rs / %** switch beside it: money off, or a percentage off. The switch shows the store currency's own sign ("Rs", "$").
3. **Selling price (what customers pay)**, read-only. It fills in as the owner types: MRP minus the discount. It is never typed, so it can never disagree with the other two.

Under the selling price, one line spells out the sum, for example "Rs 1,000 minus 15% (Rs 150): customers pay Rs 850."

### The rule (`backend/src/lib/prices.ts`)

| Field | Meaning | Rule |
|---|---|---|
| `actualPrice` | The full price, the MRP | Required, above zero |
| `discountType` | `amount` (money off) or `percent` | Given with the value; absent when there is no discount |
| `discountValue` | The amount or the percentage | At least 0, less than the MRP (or less than 100%); 0 is no discount |
| `salePrice` | What customers pay | MRP minus the discount; must stay above zero |

- **Precision.** Every store currency keeps amounts in hundredths (`lib/currencies.ts`), so all of this is done in whole hundredths. Amounts are rounded to the hundredth; percentages are kept to two decimal places.
- **Percentages.** A percentage discount is first turned into money, rounded to the hundredth, and then taken off. So MRP minus the discount shown is always exactly the selling price. For example, 33.33% of Rs 999 is Rs 332.97, so customers pay Rs 666.03.
- **Stored and computed in one place.** The server computes the selling price (`computePrices`) and stores it with the discount type and value. The catalogue can therefore be sorted and filtered by it with an index (`{storeId, salePrice}`).
- **Same numbers everywhere.** The storefront, cart, checkout, register and orders all read those stored numbers through `priceOf()`.
- **The form's copy.** The form does the same arithmetic as the owner types (`frontend/src/lib/prices.ts`). Both copies are tested with the same cases; change them together.

### The Rs / % switch

- Switching converts the value; it never clears it. For example, Rs 150 off a 1,000 MRP becomes 15%, and 15% becomes Rs 150.
- Converting can round. Rs 333 off 999 is 33.33%, and 33.33% of 999 is Rs 332.97. So the form remembers what was typed: switching straight back, with nothing edited in between, restores exactly Rs 333.
- After an edit, or a new MRP, switching converts the new value instead.
- With no MRP yet there is nothing to convert against, so the number is kept as typed.

### Checks, display and voice

- **Where the rules are checked.**
  - The form checks them as the owner types and again on Save.
  - The server checks them again for every request.
- **Messages.**
  - "The price (MRP) must be more than zero"
  - "The discount cannot be below zero"
  - "The discount must be less than the price (MRP)"
  - "A percentage discount must be less than 100%"
  - "The selling price must stay above zero"
- **The cart, checkout, the register and every order charge the selling price**, read fresh from the product each time. A price edit therefore shows in an open cart at once.
- On an edit, leaving the discount empty (or 0) removes a discount the product had.
- **Display:**
  - Shoppers see the selling price prominently, the MRP struck through after it, and a badge in the owner's own terms: "Rs 200 off" for an amount, "15% off" for a percentage. This appears on the product card, on the product page and in the admin product list.
  - Screen readers hear "Now Rs 800, was Rs 1,000" rather than a strike they cannot see.
  - Without a discount, only the price is shown.
  - `discountPercent` (the whole percent off, whatever the mode) is still returned for the shopping assistant and older callers.
- A spoken price change (voice notes) sets the MRP with no discount. A spoken stock change keeps all three prices.

### What an order keeps

Each order line stores three numbers per unit at the time of sale: the price paid (`unitPrice`), the MRP (`unitMrpSnapshot`) and the product's own discount (`unitDiscountSnapshot`).

- **Written once.** The numbers are written when the order is created and never changed. Editing a product later does not change a past order. Tests change the discount, end it and raise the MRP after a sale, and read the order back unchanged.
- **Checked by the database.** A check constraint (`OrderItem_price_snapshot_adds_up`) refuses any line where MRP minus discount is not the price paid, or where the discount is negative.
- **Responses.** They give `unitMrp` and `unitDiscount` per item, and `savings` per order: the discount per unit times the units bought.
- **Where "you saved" shows.**
  - The register receipt, which also shows the MRP beside a discounted line.
  - The card checkout confirmation, and the cash on delivery and bank transfer "order placed" page.
  - The shopper's account order page.
  - The order panel in the admin ("Saved on product discounts").
- **Not the same as an order discount.** `savings` is separate from `discountAmount`, which is a discount code or a manual discount at the register.
- **Migration.** `20261023100000_order_item_price_snapshot` adds the two columns and backfills every existing line as MRP = price paid, discount 0. Old receipts therefore read exactly as before.
- **Rollback.** `prisma/rollbacks/20261023100000_order_item_price_snapshot.down.sql` drops the constraint and the columns and removes the migration row. The price paid is untouched.
- **Checked on the dev database.** All 492 existing lines were backfilled unchanged, the database matches the schema, and the rollback round trip works.

### Compatibility

- **Requests.**
  - A request may still send the single `price` from before; it is read as the MRP.
  - A request may still send `discountPrice` (the discounted price itself) from before the discount modes; it is read as an amount off. A request sends either that or a type and value, not both.
- **Responses.** They still include `price` (the selling price) and `discountPrice` (the selling price when discounted, otherwise null). Both are marked deprecated in `openapi.yaml`.
- **Products stored in an older shape.** Such a product, not yet migrated, has only `price`, or the older `discountPrice`. Every reader goes through `priceOf()`, so it still shows and sells at its price. `scripts/migrate-product-fields.ts` (via `src/modules/products/product.migration.ts`) converts it:
  - a single price becomes the MRP with no discount;
  - an old discounted price becomes an amount off (MRP minus that price);
  - customers pay exactly what they paid before.
- **Sorting before the migration.** Sorting and the price filter read the stored selling price, so until the migration runs a single-price product sorts first and falls outside a price filter. The development database had no products in an older shape on 2026-10-23.

## Quick stock update

- Each row of the products list has a stock control: a minus button, the count and a plus button.
- Changing the count shows a **Save** button. Enter also saves, and Escape puts the saved count back. The row says "Saved" when it is done.
- The product form uses the same control.
- `PATCH /stores/{storeId}/products/{productId}/stock` with `{ "stock": 7 }` sets the on-hand count and nothing else:
  - It is behind sign-in, the tenant context and `products_write`.
  - It accepts only a whole number from 0.
  - It is recorded as a stock adjustment by the user who made it, as a full edit that changes the stock would be.
- The shop, the cart and the register read stock live, so the new count applies at once. At 0 the product is sold out.

## Removed

- **Barcode.** The field is gone from the form, validation, the model, the types, the API and the register. The unique per-store barcode index is dropped. The register finds a product by its SKU, scanned or typed, or by part of its name. A barcode an older caller still sends is ignored, not stored.
- **"Lowest price you will accept when haggling"**, and with it **the whole bargaining feature**:
  - the offer box on the product page;
  - the bargaining endpoints and their service;
  - the `BargainSession` table;
  - the bargaining AI prompt type;
  - its unit, end-to-end and browser tests.

  Deal codes that bargaining had issued are ordinary single-use discount codes that expired within minutes, so they were left alone. The voice-note store manager from the same Part G stays, and its tests continue as `voice.test.ts` and `partG-voice.e2e.mjs`.

A search of the code, tests and contract finds no other mention of either field. The one exception is a test that checks the barcode field is gone. Dated phase records (for example `Phase2_5_POS_Frontend.md` and the POS wireframes) still describe the barcode as it was at the time. The current-state documents say it was removed: `SCOPE_UPDATES.md`, `Implementation_Plan.md`, `PartG_Voice_And_Bargaining.md` and `Phase_Gates_Checklist.md`.

## Migrations

Run them in this order, each first without `--apply` to see what it would do. All of them are idempotent: a second run changes nothing.

| Step | Command | What it does |
|---|---|---|
| 1 | `npx tsx scripts/migrate-categories.ts --apply` | Turns each store's free-text categories into category records. Spellings that normalize the same become one category, named by the most-used spelling. Products with no category go in "Uncategorised". Every product is linked by id. |
| 2 | `npx tsx scripts/migrate-product-fields.ts --apply` | Copies a product's single `price` into `actualPrice` and `salePrice` (no discount, so customers pay what they paid before) and removes `price`. Deletes `barcode` and `bargainMinPrice` from every product and drops the barcode index. Lists any product priced at 0, which the form now refuses, so its owner can set a price. |
| 3 | `npx prisma migrate deploy` | Applies `20261022000000_remove_bargaining`, which drops the `BargainSession` table. In Azure this runs as the migration job in the release script. |

All three were applied to the development databases:

- 4 products in 3 stores were linked to 4 new categories.
- The same 4 products were converted to the three prices.
- No product had a barcode or a floor. The barcode index was dropped.
- The bargaining table was dropped.

## Tests

| Suite | What it proves |
|---|---|
| `categories.test.ts` (24) | Uniqueness across `toys`, `TOYS`, ` TOYS `, `tOyS` and a trailing tab. Inner spaces. The database itself refuses a duplicate. Another store may use the same name. Another store's owner gets 403, and a category id from another store is not found. Cashiers and signed-out callers are refused. A product needs a category from its own store. Disabled categories. A legacy name finds the existing category. Moving a product. Rename reaches products. A rename collision. A blocked delete, then a delete once the products have moved. |
| `product-prices.test.ts` (24) | Each price rule is refused through the API with its reason, in both modes. A discount of 0 is none. An amount off and a percentage off, stored with their type, with the selling price, the amount off and the whole percent. An older caller's single price and discounted price. An edit that adds a discount, switches it from Rs to % and removes it; a percentage that follows a new MRP. A product stored before the change, still bought at its price. Sorting and filtering by the selling price. **The migration**: a single price, an old discounted price and an old "discount" equal to the MRP converted, customers paying the same, and a second run changing nothing. The cart charges the selling price and follows an edit. The register and an online (cash on delivery) order keep the price paid, the MRP and the discount per line after the owner changes the discount, ends it and raises the MRP, with the order's savings. The database refuses a line that does not add up. |
| `tests/unit/product-prices.test.ts` (64) | The calculation in both modes (Rs and %), with rounding to the hundredth and to two places, the three always adding up. The rules and their messages, at and around each limit. **The Rs / % conversion** both ways, never reaching 100%, and keeping the selling price within a hundredth or two. The request rules (type without value and the reverse, both old and new discount fields). Every stored shape read the same way. What an order line keeps, including a checkout priced before the change. |
| `frontend/tests/prices.test.ts` (27, `npm test`, in CI) | The form's copy of the calculation with the same cases, the form's live prices and messages, and **the switch**: converting instead of clearing, restoring exactly what was typed when switching straight back, converting afresh after an edit or a new MRP. |
| `product-stock.test.ts` (12) | 11 to 7, shown everywhere. The adjustment record (-4, by the owner). Nothing else changes. The cart limit. Sold out at 0. Negative, fractional, text and missing counts are refused. Signed out, cashier, another store and an unknown product are refused. |
| `pos.test.ts`, `voice.test.ts` | The register finds products by SKU, and a barcode sent with a product is not stored. Voice notes are unchanged. |
| Browser: `categories`, `product-prices`, `product-stock`, `partG-voice` | The same journeys in Chromium: the sidebar, the empty-category prompt, the duplicate message, the dropdown, rename and blocked delete; the three prices on Add Product and Edit (MRP, the discount with its Rs / % switch converting and restoring, the read-only selling price), the live sum line, the rules as typed and on Save, "15% off" and "Rs 200 off" badges, the struck MRP and badge on the list, card and product page, a cash on delivery order saying "You saved Rs 400" and the admin order showing it; the stepper, Save, Enter, Escape, the shop seeing the new count, the form's stepper; no offer box, no haggling or barcode field. |

Existing suites updated for the change:

- Browser tests that typed a category now create one on the Categories page and choose it.
- Tests that read the stock figure now read the stepper.
- The register test scans a SKU.
