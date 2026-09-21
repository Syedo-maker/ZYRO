# Phase 3, Module 1 (remaining): Search and Reviews (backend)

Status: complete and verified (86 new backend checks and 3 in the security suite; all earlier suites still pass, 617 backend checks in total). The storefront search box, category pages, product page and review screens belong to the Phase 3 frontend item and are not built here.

Design followed the installed `mongodb-schema-design` skill: reviews are an unbounded one-to-many, so they live in their own collection; the reviewer's display name is copied onto each review so listing reviews never looks users up; the rating average is a value computed from the reviews rather than typed in.

## Search

Search stays a part of `GET /stores/{id}/products` (a search is a filtered list; this was the contract's earlier decision), and gains what a real storefront needs.

- **Ranking.** MongoDB's text index over title, category and description, with weights 10, 3 and 1: a word in the title outranks one in the category, which outranks one in the description. With `q` and no sort, best match first.
- **Partial words.** Text search only matches whole words, so "cer" would find nothing for "Ceramic". When the text search finds nothing, it falls back to a case-insensitive "contains" match on title and category, ordered by title. Regex characters in the query are plain text (tested with `(.*[`).
- **Filters:** category, price range (inclusive at both ends), and in stock only (stock lives in Postgres, so the ids with stock are looked up there first). They combine with each other and with search.
- **Sorting:** relevance, newest (the default), price low to high and high to low, and title. Ties break by id, so paging never repeats or skips a product. Prices sort as numbers.
- **Suggestions:** `GET /products/suggest?q=` gives up to 8 products with a title word starting with what was typed, for a type-ahead box.
- **Guards:** an empty search box means browse rather than an error, a query over 100 characters is 400, and a minimum above the maximum price is 400. Only the store's own products are ever searched.

Every product in a list or detail carries `averageRating` (or null) and `reviewCount`.

One operational step: changing the weights of an existing MongoDB text index needs a one-off `npm run sync-indexes` (added as a script and run on this machine). A fresh deployment gets the right index automatically, but an existing database needs this once. The verification script checks the weights and says so if they are missing.

## Reviews

**Who may review.** Any signed-in account, once per product per store (a database unique index backs this up). The store's owner and its staff cannot review their own products (403), since that would be a fake review. Reviews are read by anyone.

**Verified purchase.** A review is marked verified when the reviewer has a paid order in this store that includes the product and was not refunded or cancelled. It is checked once, when the review is written. A shopper who paid as a guest, or who bought in the shop, is not linked to an account, so their review is not marked verified (they can still review).

**Privacy.** Shoppers see the reviewer only as a short display name ("Sam O.", a single name as it is, or "Customer"). The reviewer's id and email never appear in any public response (tested).

**The rating.** Average, count and the one-to-five-star breakdown are computed on read from the published reviews, as the plan specifies, and are never stored on the product, so there is nothing to fall out of sync. Product cards get theirs from one aggregation per page. The consequence, stated plainly: the catalog cannot be sorted or filtered by rating, because that needs a stored average. If that is wanted later it is a small, deliberate change (store the count and sum, recomputed from the reviews after every review change).

**Their own review.** A signed-in shopper reading a product's reviews also gets their own review back, even if hidden, so the page can offer edit and delete. They can edit it (keeps its place and verified badge) or delete it, and can then write a new one.

**Moderation** (owner, or staff with `products_write`):
- A merchant list of every review in the store, hidden ones included, newest first, filterable by status, product and stars.
- Hide or show a review. A hidden review is kept, but not shown and not counted in the average, and its author cannot post another one (otherwise hiding would just invite a repost). The reviewer's own words are never edited by the store.
- A public reply from the store, with the time, which can be changed or removed.

**Abuse limits.** At most 10 review writes (create, edit, delete) per person per hour, keyed on the account so changing address does not help (`RATE_LIMIT_REVIEW_MAX`); reading reviews is never limited. Text is trimmed, control characters removed, and stored as plain text (the page must show it escaped, which React does). Titles are limited to 100 characters and comments to 2,000.

**Housekeeping.** Deleting a product deletes its reviews. Other stores can see none of them, and the tenant-scoping guard on the review collection is exercised.

## Data changes

`ProductReview` gains `authorName`, `title`, `verifiedPurchase`, `status`, `merchantReply` and `merchantRepliedAt`, a whole-number rating check, and indexes for the product page and the moderation list. `Product`'s text index changes as described. No Postgres changes.

## Verification

`backend/scripts/verify-search-reviews.ts` (86 checks against real MongoDB, Postgres and Redis, through the real HTTP API): index weights; ranking (title above description, category searched, plural matching); the partial-word fallback; regex characters; blank and over-long queries; other stores invisible; every sort; filters and their edges (inclusive prices, in stock, combined with search); three pages of 30 products with no repeats; suggestions; then reviews: who may and may not write one (401, owner and staff 403, unknown product 404), validation, no data saved by rejected attempts, the verified badge for a buyer and its absence for a non-buyer and for a refunded order, display names, no id or email leaked, text cleaning, duplicates (409, also by direct database insert), the average and star breakdown, filters and paging, ratings on the catalog cards, editing and deleting your own, moderation and replies with the average following, hidden reviews staying hidden, permissions, cross-store attempts, and the cascade on product delete. The security suite adds three checks for the review limit.

## Not built

Helpful votes and "was this helpful", review photos, reporting a review, email requests to review after delivery, sorting or filtering the catalog by rating (see above), typo-tolerant or synonym search (a dedicated search engine, out of scope per the plan), search across several stores, and search within reviews.

## Notes for the frontend item

Send the shopper's token when loading reviews so `myReview` comes back. Show `authorName` and a "Verified purchase" mark, and always render review text as plain text. Use `suggest` for the search box with a short delay between keystrokes. A page of `productId`s from search results can show stars from `averageRating` and `reviewCount` without another request.
