# Part F: Search

Status: built and tested. 38 unit tests (`search`), 28 end-to-end tests (`search`), and the existing 86 `search-reviews` checks still pass; the full gate is listed at the end.

`find-skill`: **nothing installed**, and that is the finding rather than a gap. Two real candidates were examined and both rejected:

- **`mongodb-search-and-ai`** (MongoDB's own, Apache-2.0, clean security review, genuinely good work). It is entirely about **Atlas Search**, **Vector Search** and `$rankFusion`, driven through the MongoDB MCP server. ZYRO runs self-hosted MongoDB 8.3.11, where `$search` and `$vectorSearch` are refused outright: *"Using $search and $vectorSearch aggregation stages requires additional configuration"*. Worse, the skill states plainly: **"NEVER recommend `$regex` or `$text` for search use cases."** `$text` is the only full-text option this deployment has. Installing it would plant that instruction in every future session and push work toward a platform the project cannot run.
- **`search-relevance-expert`** (AceHack/Zeta): Elasticsearch, Solr and Lucene only, no MongoDB coverage at all. Its BM25 `k1`/`b` tuning, `function_score` and eDisMax guidance has no equivalent in MongoDB's `$text`, which exposes no scoring parameters. It also ships without YAML frontmatter and installs through a third-party CLI rather than a plain file download.

Installing either would have misled future work rather than helped it.

## What was already there

Search was not starting from nothing. Phase 3 built a MongoDB text index with field weights (title 10, category 3, description 1), relevance ranking by `textScore`, a contains fallback for partial words, filters for category, price and stock, five sort orders, pagination, prefix suggestions and category counts, covered by 86 tests including cross-store isolation.

## What was actually wrong

Three failures, all of which show up the moment a real shopper in Pakistan uses it on a phone:

1. **A typo found nothing.** `$text` matches whole words, so "ceramik" matched no document, and the contains fallback only helps when the typo happens to be a prefix or substring. "kettel" returned an empty page.
2. **Roman Urdu found nothing.** A shopper types what they say: "ketli", "piyali", "chaye", "joota", "bartan". The products are titled "Kettle", "Cup", "Tea", "Shoes", "Utensil". Not one character matches, so the shop looks empty to the customer most likely to be using it.
3. **Suggestions gave up too early.** Typing a word part in the middle, or misspelling it, left the box empty.

None of that needs a model. It needs a dictionary and an edit distance.

## The search ladder

`q` now walks a ladder and stops at the first rung that finds anything. Every rung is plain code:

| Rung | What it tries | Example |
|---|---|---|
| `exact` | the words as typed | "ceramic mug" |
| `synonym` | plus known meanings | "ketli" also looks for "kettle" |
| `corrected` | plus spelling fixes | "ceramik" becomes "ceramic" |
| `partial` | a contains match | "cer" inside "Ceramic" |
| `semantic` | products close in meaning | "insulated bottle for hiking" finds a flask |

The words typed are **always tried first**, so a shopper who knows exactly what they want is never second-guessed. When a rung other than `exact` answers, the response carries an `interpretation` and the storefront says so: *"Showing results for ceramic. Search for 'ceramik' instead"*, with a link that really does take them literally (`exact=1`), skipping correction, synonyms and meaning alike.

### Typo correction against the store's own words

Corrections are made against **a vocabulary built from that store's own titles and categories**, not an English dictionary. So "ceramik" maps to a word the store actually sells, a shop selling Urdu-titled goods gets Urdu corrections for free, and a store can never be corrected into another store's words (tested: "teapo" finds the teapot only in the store that sells one).

How far a word may be out depends on its length: a 3-letter word is never corrected (**"cup" and "cap" are different products, not a typo**), 4 to 6 letters may be one out, longer words two. The list is cached in Redis for ten minutes and dropped the moment a product is added, changed or removed, so a merchant finds their new product by a typo straight away. If Redis is down it is built on the spot: slower, but search still works, which is the point.

### The Roman Urdu dictionary

About forty entries covering the categories small shops here actually sell: tea and kitchen (ketli, chaye, piyali, bartan, handi, degchi, chamach, thali), clothes and shoes (kapra, joota, chappal, kurta, dupatta), and everyday goods (kitab, qalam, ghari, batti, pankha, sabun). British and American spellings map to each other in both directions, because both are written here.

It is a written list rather than a transliteration algorithm on purpose. Roman Urdu has no fixed spelling, and an algorithm would produce far more wrong answers than right ones; a list is predictable, testable and easy for the team to extend. The mapping is one-way: searching "kettle" does not drag in everything mapped to it.

## Keyword search never touches the AI

This is the part's own rule, and it is enforced rather than asserted:

- Nothing in `search.query.ts` imports anything at all; a unit test strips the comments and fails if the file ever gains an import or mentions a model.
- The end-to-end suite installs an AI provider that **throws on every call**, so any search path that reached a model would fail the suite rather than quietly work.
- A test reads the store's AI usage before and after a run of searches and asserts both counters are unchanged.

## Semantic search: the last resort, and only that

The stretch. When every keyword rung has failed, the existing Python recommendation service is asked for products whose meaning is close to the query. "insulated bottle for hiking" finds a vacuum flask, which no amount of spelling correction would.

It runs **only after** keyword search has had its say, so keyword never waits on it and never depends on it. If the service is slow, down or not configured, the shopper gets the empty result they would have had anyway, with no error. Its answers are re-filtered against the store and the shopper's own filters, so an id from another store is thrown away even if the service returned one (tested). The service ranks by closeness and `$in` does not preserve that order, so those few results are ordered in code. It costs nothing from the store's AI allowance: the embeddings are computed locally by the Python service, not by Anthropic.

## API

`GET /stores/{storeId}/products` gains `exact` and may return `interpretation`. `GET .../products/suggest` now falls back to the ladder when no title starts with what was typed.

## Tests

- **`search` (unit, 38):** normalising what was typed, including Urdu and Arabic digits and keeping Urdu letters; every Roman Urdu mapping; the typed word always ranking first; one-way mapping; edit distance and its short-circuit; why a 3-letter word is never corrected; correcting against a store's vocabulary and refusing to correct a word the store sells; stable results whatever order the vocabulary is in; the ladder's rungs for a plain query, a Roman Urdu word and a typo; an empty query planning nothing; and a guard that the query path has no imports and no mention of a model.
- **`search` (end to end, 28):** an AI provider that throws on every call and an untouched AI allowance; typos, Roman Urdu and plain words; `exact=1` refusing to correct, expand or search by meaning; never crossing stores in results, corrections or suggestions; an empty page rather than an error; regex characters as plain text; a new product findable by typo immediately; search surviving Redis being down; semantic search only as a last resort, never asked when the words worked, degrading silently when the service is down, discarding an out-of-store id and rubbish ids, and still obeying the shopper's filters.
- **`search-reviews` (86, existing):** all still pass, with one deliberately updated: suggestions for a word part in the middle used to find nothing and now fall back to the ladder.

## A bug found while testing

The new suggest path normalises the query before building its prefix pattern. A query of only punctuation, such as `(.*[`, normalises to an empty string, and an empty prefix pattern matches **every** title, so the shopper would have been handed the whole shop. Caught by an existing test, fixed with a guard that returns nothing for a query with no letters or digits.

## Deliberate limits

- **No Atlas Search.** It is not available on this deployment, and requiring it would tie a free product for small shops to a paid cluster. If ZYRO ever moves to Atlas, the ladder's rungs are the natural place to swap `$text` for `$search`.
- **No synonyms per store.** The dictionary is shared. A merchant-editable list is a sensible next step, and nothing in the design prevents it.
- **Facet counts are not filtered by the current query.** The categories endpoint still counts the whole catalogue.
- **The dictionary is small.** Forty entries covers the common cases; it is a list in one file and is meant to grow.

## Full gate (2026-10-03)

| Suite | Result |
|---|---|
| Backend (Jest and Supertest, `npm test`) | 36 suites, 1,398 tests pass (1,327 before Part F) |
| Python recommendation service (pytest) | 14 pass |
| Browser suites with the test server | 15 of 15 pass, including `partF-search` (15) and `phase1-security` with rate limiting on |
| API contract | valid (`redocly lint`), 16 warnings as before, no new operations so the traceability table is unchanged |
| Leftovers | none: test data cleaned, 9 real stores untouched |

`responsive` reported one console error during the batch run and then passed three times in a row on its own, so it was a flake in the batch rather than anything this part changed.
