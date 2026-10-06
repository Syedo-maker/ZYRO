# Separate Shopper and Owner Experiences, and AI Product Suggestions

Built 2026-10-05, after Part G and before Phase 7. Two fixes requested together, documented together
because they share one idea: the person using ZYRO should be shown the thing they came for, and told
the truth about where it came from.

Branch: `feature/roles-and-ai-ideas`.

---

## Part 1: the two experiences (Issue 2)

### The problem

ZYRO is two products on one commerce core: a shop's own counter and website, and a place to buy
things. Until now the front door did not know that. `/` sent every arrival to
`/admin/products`, so somebody who came to buy a lawn suit was shown a merchant dashboard for a shop
they do not own, which then failed to load because they have no shop. A signed-in shopper could sit
on the admin pages indefinitely, seeing an error in every panel.

### What was built

**A landing screen at `/`** asks once: shop, or open a store. The choice is remembered (in the
browser, and on the account once there is one), so a returning visitor is not asked again. A
signed-in visitor is never asked at all.

**A public shop directory at `/shop`.** A shopper arriving with no shop in mind has to be able to
find one. Three rules decide what is listed:

| Rule | Why |
|---|---|
| The owner can opt out (`Tenant.listedInDirectory`, on by default, one switch in Settings) | It is their shop. A shop that is not listed still works perfectly for anyone with its link. |
| A shop needs at least 3 products | This codebase has no "publish the shop" step and no draft products, so a shop is as real as its catalogue. It keeps half-finished and test shops off the front page without asking the owner to remember a checkbox. |
| Only public fields leave the server | Name, slug, logo, theme colour, currency, the owner's own one-line description, and a category worked out from the shop's own products. Nothing about orders, revenue, plan, staff or the owner. |

The owner is also told, in Settings, whether their shop is appearing right now and why not, because a
shop can be switched on and still be held back for having too few products.

**Separate navigation.** The admin shell is for people with a shop; the storefront and the directory
are for shoppers. Each has one clearly marked way across ("Browse shops" in the admin header, "All
shops" in a storefront header), so an owner who also buys things is not stuck.

### How roles are decided, and why not in the token

The JWT payload is still only `{ sub: userId }`. This was a deliberate decision from Phase 1
(documented in `backend/src/lib/jwt.ts`) and this work kept it, because **one person can be the owner
of one shop and a customer of another at the same time**. A role in the token would have to be a role
in which shop, and would go stale the moment they open a second shop or are added as staff.

So the role is worked out per request and per shop, from the data:

| Role | How the server decides |
|---|---|
| Owner | `Tenant.ownerId` is this user |
| Staff | A `StaffMember` row for this user and this shop, with its own permissions |
| Shopper | Neither of the above. Not a stored role: it is what being neither means. |

Every protected route goes through `requireAuth` and then `requireOwner` or
`requirePermission(...)`, which do that lookup. `User.preferredExperience` was added for routing
only, and the integration test proves it grants nothing: a shopper who sets it to `owner` is still
refused by every owner endpoint.

**The frontend hides, the server refuses.** Hiding a menu item is a courtesy, not a protection. The
`roles-and-ideas` integration suite calls eight owner endpoints with a shopper's own valid token and
requires every one to refuse.

### How the shopper flow works with many shops

Multi-tenancy stays exactly as it was, and the directory is where a shopper meets it:

- Each shop is its own tenant: its own products, prices, currency, delivery, discounts and basket.
- `/shop` lists shops. Opening one goes to `/store/:storeId`, and from that point everything belongs
  to that one shop.
- A basket does not follow a shopper from one shop to the next, for the same reason a trolley does
  not move between two shops on a high street. Carts are already per-store in Redis.
- A shopper account (`POST /auth/register-customer`) is a plain `User` with no tenant, and works at
  every shop. Orders are per-shop, and `/store/:storeId/account` shows that shop's orders.
- Buying needs no account at all: guest checkout was built in Phase 2 and is untouched.

### API changes

| Endpoint | Auth | What it does |
|---|---|---|
| `GET /stores` | public | The directory: listed shops, with `q`, `category`, `limit`, `offset` |
| `GET /stores/categories` | public | The categories listed shops actually sell, for the filter |
| `GET /stores/{storeId}/directory-listing` | owner | Whether this shop is listed, and if not, why |
| `PATCH /stores/{storeId}/branding` | owner | Now also takes `description` and `listedInDirectory` |
| `PATCH /users/me/preference` | any signed-in user | Remembers `shopper` or `owner`. Grants nothing. |
| `GET /users/me` | any signed-in user | Now also reports `preferredExperience` |

`GET /stores/{storeId}` (the public shop profile) gained `description` and deliberately did **not**
gain `listedInDirectory`: that is the owner's setting and no shopper's business.

### Schema changes

```prisma
model User   { preferredExperience String?  }  // routing hint only, never authorization
model Tenant { listedInDirectory Boolean @default(true)
               description       String?  }    // one public line, shown in the directory
```

Migrations `20261005000000_roles_and_search_terms` and `20261005010000_store_directory_description`.
Both are additive: two nullable columns and one boolean with a default, no drops, every existing shop
untouched and listed as before.

---

## Part 2: AI product suggestions grounded in real searches (Issue 1)

### The problem

Naming and describing a product is the part of adding one that small shop owners get stuck on. The
AI content tools built in Phase 4 all need a product to already exist, so they are no help on the
Add product form, which is exactly where the help is needed.

### What was built

On the Add product form the merchant chooses **"Write it myself"** or **"Write with AI"**. Writing it
themselves is what the form starts on; nothing changed for a merchant who wants to type.

Choosing AI gives four title and description pairs built around keywords real shoppers really use,
each one showing which of those keywords it actually contains ("Uses popular searches: lawn suit, 3
piece, summer"). The merchant can use one, edit it afterwards like any other text, or ignore all of
it.

### Where the keywords come from

Three providers behind one small interface (`backend/src/modules/ideas/keywords.sources.ts`), so
another can be added without touching the suggestion code. **Every one reports real data or
nothing.**

| Provider | Source | Privacy rule |
|---|---|---|
| `best_sellers` | Keywords Part D already computes from titles of products selling across shops | Part D's own rules were applied before these were ever stored: at least 5 shops, no shop over 60% of a figure |
| `google_trends` | The Google Trends CSV files a platform administrator imported in Part D | Public data about search interest, not about any shop |
| `shopper_searches` | What shoppers type into shop search boxes (new, see below) | A word is only reported once at least **5 different shops** have seen it |

The blended list is cached per market and category for a day, as asked. A word more than one
provider knows outranks a word only one knows, so something people both search for and buy rises to
the top. A failing provider is skipped rather than failing the request.

**There is no Google Trends API.** Google publishes no self-serve API for Trends; Part D already
handles this by letting a platform administrator import CSV exports, and this feature reads what Part
D imported rather than pretending to a live feed.

### The new search log, and what it does not keep

Counting what shoppers search for was built now even though it starts empty, so that it blends in
automatically once there is enough of it.

**What is stored: the term, the shop, the category filter, and the day. Nothing else.** No user id,
no session id, no IP address, and no timestamp finer than a day. A term is one row per shop per day
however many times it is searched, so even the count cannot be used to follow one person's
afternoon.

A search box is a free text field and people type things into it that do not belong in a log, so a
term is dropped before it is ever written if it:

- contains an email address anywhere in it;
- contains 7 or more digits in total, or a long run of digits and separators, which covers Pakistani
  mobiles in every way people write them (`03001234567`, `0300 1234567`, `+92 300 1234567`),
  landlines, foreign numbers, card fragments, order numbers and national id numbers;
- is shorter than 3 characters, longer than 60, or more than 5 words;
- is nothing but digits and spaces.

It is far better to drop a real search term than to keep somebody's phone number, so these rules are
deliberately broad. `tests/unit/search-terms.test.ts` holds each of them as a named test.

Counting a search never delays or fails a shopper's results: `recordSearchTerm` is called without
being awaited, and a failure is logged and dropped.

### How the AI is kept honest

| Rule | How it is enforced |
|---|---|
| One request is one AI call and **one generation** off the quota, not one per suggestion | All four come back in a single JSON reply from one `aiGenerate` call. The integration test asserts the AI was called once and the quota moved by one. |
| No invented trends | The prompt forbids claiming anything is trending, best selling or popular, and the keyword list is the only trend information the model is given. |
| The keyword attribution is a fact, not a claim | `creditedKeywords` credits a keyword only if it came from our own sources **and** is genuinely in the text the model wrote. A model that pads its `keywordsUsed`, or names a word nobody searched for, gets no credit for it. |
| No keyword stuffing | The prompt asks for the words worked in naturally and forbids repeating one to pad it out or using one that does not fit. At most 12 keywords ever reach the model. |
| Nothing is saved | The endpoint writes no product and no draft. The merchant picks one, edits it, and saves it through the ordinary create-product endpoint. |
| No separate AI path | It goes through the same orchestrator, quota, queue, model tiers and cache as every other AI feature. The only new thing is a prompt type, `product_ideas`. |

When a category has no trend data, the merchant still gets suggestions, built on the details they
entered, and is told plainly: "We do not have trend data for this category yet." When the shop's
monthly allowance is used up, the orchestrator's existing 402 is shown next to a note that they can
still write the listing themselves.

### API changes

| Endpoint | Auth | Cost |
|---|---|---|
| `POST /stores/{storeId}/product-ideas` | `products_write` | One AI generation |
| `GET /stores/{storeId}/product-ideas/keywords` | `products_write` | Nothing: reads the cached keyword list |

The free keyword endpoint exists so the form can show the merchant what shoppers are searching for
before they decide whether to spend a generation.

### Schema changes

```prisma
model SearchTermDaily {
  id String @id @default(cuid())
  tenantId String
  term String
  category String @default("all")
  day String
  count Int @default(1)
  createdAt DateTime @default(now())
  @@unique([tenantId, term, category, day])
  @@index([category, day])
}
```

Registered in `TENANT_SCOPED_MODELS`, so it cannot be read without a tenant context. Writes use a raw
`INSERT ... ON CONFLICT DO UPDATE` with `tenantId` written by hand, following Part B's counters: the
tenant-scoping extension refuses `upsert`, and two shoppers searching the same word in the same
instant must both count.

---

## Tests

| Suite | Kind | What it proves |
|---|---|---|
| `tests/unit/search-terms.test.ts` | unit, 18 tests | Every rule above about what the search log refuses, including each way a Pakistani mobile is written, and that the timestamp is a day and nothing finer |
| `tests/unit/ideas.test.ts` | unit, 18 tests | A malformed or hostile AI answer cannot reach the merchant as a suggestion, and the keyword attribution is checked rather than trusted |
| `tests/integration/roles-and-ideas.test.ts` | integration, 44 checks | End to end on real Postgres, MongoDB and Redis: shopper refused on every owner endpoint, the preference grants nothing, the directory's three rules and its public-fields-only shape, the search log's contents, one call and one generation, and a suggestion that over-claims keywords being stripped of them |
| `frontend/e2e/roles-and-ideas.e2e.mjs` | browser, 33 checks | The landing screen, the directory, a shopper bounced out of the admin pages, the opt-out switch, the two writing choices, suggestions with their keyword lines, and both pages at phone width |
| `tests/integration/role-enforcement.test.ts` | integration, 108 tests | Every endpoint the contract declares, called with no credentials at all. The ~96 that need a token answer 401 or 403; the 8 a guest session can satisfy hand back nothing; the 27 declared public are listed in the output so that list stays short and has to be justified when it grows |

Two defects were found by these tests and fixed in the code rather than in the test:

1. The shopper-search provider grouped by term alone and counted rows, but a row is one shop on one
   day, so one shop searching the same word on five days looked like five shops and would have had
   its own searches reported back. It now counts distinct shops.
2. The search log's all-digits filter missed a term with a space in it (`"12 34"`), which is a
   half-typed number and not a word anyone searches for.

The route audit also found a documentation defect rather than a code one. Six of Part E's
shopper-facing endpoints (placing a cash-on-delivery order, sending in a receipt, asking why a
payment failed) are deliberately open to a shopper with no account, guarded by the order itself
rather than by a token, but the contract still listed them as needing a bearer token. The contract
was overstating its own protection, which is worse than understating it, so they are now declared
`security: []` with the reason written beside each one. Nothing about the code changed.

One endpoint is a documented exception in that audit, with its own assertions rather than prose:
`cart_merge` does need a signed-in shopper and its handler refuses anyone else, but it sits on the
cart router, whose shared `resolveCartOwner` works out whose cart a request is about before any
route runs and turns away a caller carrying neither a token nor a guest session id with a 400. A
stranger is refused either way and no cart comes back; reordering a working, tested router to change
which refusal they see would be a poor trade.
