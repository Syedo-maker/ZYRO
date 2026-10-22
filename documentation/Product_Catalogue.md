# Product catalogue: categories, three prices, quick stock, removed fields

Status: built and tested on branch `feature/product-listing` (2026-10-22). This is the supervisor's product-listing change. It has four parts:

1. Each store has its own **categories**, chosen from a dropdown on the product form.
2. Owners can **edit** every part of a product.
3. Every product has **three prices**: the actual price (MRP), an optional discounted price, and the sale price customers pay.
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

The owner sets two prices on the form: **Price (MRP)** and **Discounted price (optional)**. The third is computed and never typed:

| Field | Meaning | Rule |
|---|---|---|
| `actualPrice` | The full price, the MRP | Required, above zero |
| `discountPrice` | The discounted price | Optional; above zero; at most the actual price |
| `salePrice` | What customers pay | The discounted price when there is one, otherwise the actual price |
| `discountPercent` | For the "% off" badge | Whole percent below the MRP, rounded; null when there is no discount or it rounds to 0 |

- The sale price is computed in one place (`salePriceFor` in `Product.model.ts`) and stored, so the catalogue can be sorted and filtered by it with an index (`{storeId, salePrice}`).
- **The cart, checkout, the register and every order charge the sale price**, read fresh from the product each time. A price edit therefore shows in an open cart at once.
- **Order items keep the price they were sold at** (`unitPrice` and `lineTotal` on the order item). Editing a product later does not change a past order. A test sells at 850, raises the price to 1200 and reads the sale back at 850.
- The form shows what customers will pay as the owner types, for example "Customers pay Rs 800, 20% off the MRP". It refuses a discount above the MRP before sending, and the server refuses it again if a request gets through.
- On an edit, leaving the discounted price empty removes a discount the product had.
- **Display:**
  - Shoppers see the sale price prominently, the MRP struck through after it, and a "20% off" badge. This appears on the product card, on the product page and in the admin product list.
  - Screen readers hear "Now Rs 800, was Rs 1,000" rather than a strike they cannot see.
  - Without a discount, only the price is shown.
- A spoken price change (voice notes) sets the MRP with no discount. A spoken stock change keeps all three prices.

### Compatibility

- A request may still send the single `price` from before. It is read as the actual price.
- Responses still include `price`, holding the sale price. Both are marked deprecated in `openapi.yaml`.
- A product stored before the change and not yet migrated has only `price`. Every reader goes through `priceOf()`, so such a product still shows and sells at its price. Sorting and the price filter read the stored sale price, so until the migration runs such a product sorts first and falls outside a price filter.

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
| `product-prices.test.ts` (15) | Each price rule is refused with its reason. The sale price, with and without a discount. A legacy `price` request. Adding and removing a discount on edit. A product stored before the change. Sorting and filtering by the sale price. The cart charges the sale price and follows an edit. The register charges it and the sale keeps it after the price changes. |
| `product-stock.test.ts` (12) | 11 to 7, shown everywhere. The adjustment record (-4, by the owner). Nothing else changes. The cart limit. Sold out at 0. Negative, fractional, text and missing counts are refused. Signed out, cashier, another store and an unknown product are refused. |
| `pos.test.ts`, `voice.test.ts` | The register finds products by SKU, and a barcode sent with a product is not stored. Voice notes are unchanged. |
| Browser: `categories`, `product-prices`, `product-stock`, `partG-voice` | The same journeys in Chromium: the sidebar, the empty-category prompt, the duplicate message, the dropdown, rename and blocked delete; the two price inputs with the live "customers pay" line, the refused discount, the struck MRP and badge on the list, card and product page; the stepper, Save, Enter, Escape, the shop seeing the new count, the form's stepper; no offer box, no haggling or barcode field. |

Existing suites updated for the change:

- Browser tests that typed a category now create one on the Categories page and choose it.
- Tests that read the stock figure now read the stepper.
- The register test scans a SKU.
