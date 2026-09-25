# Phase 6: AI Recommendation Service

Status: complete and verified. 14 pytest tests for the Python service, 31 backend checks in `verify-recommendations.ts` (which runs the real Python service against the real MongoDB), and 14 browser checks in `phase6-recommendations.e2e.mjs`. The existing suites are unchanged in what they check; the full regression is listed at the end.

A `find-skill` search found no skill worth installing: nothing installed covers a Python service, and the one third-party FastAPI skill offered was declined by the project owner as unnecessary for a service this small.

## What was built

A separate Python 3.11 + FastAPI process, `recommendation-service/`, beside `backend/` and `frontend/`:

- **Embeddings.** Each product's text becomes a 384-number vector (model `BAAI/bge-small-en-v1.5`, run locally through ONNX, no PyTorch). The vector is written onto the product's own MongoDB document (`embedding`, plus `embeddingHash`) by the Python service through `motor`, as the plan specifies.
- **Similarity.** Brute-force cosine similarity in NumPy over one store's products at request time. Vectors are stored L2-normalized, so cosine similarity is one matrix-vector product.
- **Node stays the public face.** `GET /stores/:storeId/products/:productId/recommendations` lives in Node (tenant scoping, stock, ratings, the same `Product` shape as the catalog) and proxies to Python over HTTP with a shared-secret header. The frontend never talks to Python.
- **Indexing.** Node's product create and update call the service after a successful write, fire and forget, never on the request's critical path and never able to fail it.
- **Shopping assistant.** Keyword matches from the Phase 3 text index stay first; if fewer than five, meaning-based matches from the service fill the remaining slots, so a shopper asking "something to drink my morning brew from" is shown the mug. If the service is off or down, the assistant is exactly the Phase 5 keyword search.
- **Storefront.** "You might also like" on the product page and "Recommended for you" on the home page (based on the last product this shopper opened in this browser, kept in `localStorage` only).

## The one deliberate deviation from the plan (please read)

The plan says the Python service must not call an AI provider directly and instead calls Node's orchestrator through a new `POST /internal/ai/embed`, so embedding calls are quota-accounted. **That is not what was built.** Embeddings are computed locally inside the Python service. Reasons, decided with the project owner:

1. Anthropic has no embeddings API (its own documentation points to Voyage AI), so `/internal/ai/embed` would need a second AI vendor, a second account and a second secret before anything could run.
2. No API key is configured anywhere in this project yet (the Phase 4 features answer 503 for the same reason), so the plan's route could not be tested end to end.
3. A local model has no per-call cost, so there is nothing for quota accounting to protect. The cross-cutting rule "every LLM call goes through the orchestrator" exists to control spend; this call has none.

What is kept: the model sits behind a tiny `Embedder` interface (`embed_documents`, `embed_query`, a `name`). Replacing it with a call to Node's orchestrator later means writing one class; storage, similarity and every endpoint stay as they are. The plan text itself was left untouched. If the supervisor requires the orchestrator route, that is the follow-up, and it is small.

## Design decisions worth knowing

- **Vectors repair themselves.** Every request first compares each product's stored `embeddingHash` (a hash of its text plus the model name) with its current text, and re-embeds only the ones that differ. The fire-and-forget call from Node is therefore a speed-up, not something correctness depends on: if it is lost, or the service was down when a product was edited, the next request fixes it. Switching model re-embeds everything the same way.
- **Category is part of the embedded text**, not only title and description as the plan says. A product with a thin description ("Blue one, size M") carries almost no signal otherwise, and category is the one other field every product must have. Tags are left out because they may be an unreviewed AI suggestion.
- **A recommendation is never worth an error page.** If the service is not configured, is down, is slow (4 s timeout), rejects the token or errors, the endpoint returns `200` with an empty list and the storefront shows nothing. An unknown product is still `404`, decided in Node so it holds even when the service is down. Failures are not cached, so recovery is immediate.
- **Sold-out products are not recommended.** Node asks for twice as many candidates as it shows and filters afterwards, so a row of four stays four.
- **Results are cached for 60 seconds in Node** (per store, product and size, at most 500 entries), because the endpoint is public and each miss makes Python read a whole store's vectors. The cost is that an edit can take up to a minute to change a recommendation. `RECOMMENDATION_CACHE_SECONDS` tunes it.
- **Search has a floor, recommendations do not.** Measured with `scripts/try_real_model.py`: related text scores about 0.6 to 0.8 and unrelated text about 0.45 to 0.5, so free-text search (the assistant) drops anything under 0.55. "Products like this one" always shows the closest few, because something similar-ish beats an empty box there.
- **Security.** The Python service refuses to start without `RECOMMENDATION_SERVICE_TOKEN`; every endpoint but `/health` requires it (constant-time comparison); it should bind to `127.0.0.1`. Every MongoDB read and write carries `storeId`, including the vector write, so a request for one store can never touch another's products. Vectors are `select: false` on the Mongoose schema and never appear in any API response; the service reads only title, category, description and its own two fields, never prices or costs.

## Verification

- `pytest` (14 tests, no MongoDB, no download): ranking, the product itself excluded, store isolation, 404s, vectors stored once and recomputed only when text changes, `/embed/product`, `/reindex`, search with and without matches, empty-text products, input limits, missing/wrong token on every endpoint, the token being mandatory at startup.
- `verify-recommendations.ts` (31 checks): starts the real service with the deterministic hashing embedder against real MongoDB. Creating a product really gets it embedded in the background; editing it changes its hash; ranking, sold-out and self exclusion; no vector or cost price in any response; limits; 404s and cross-store probing; the service's own token wall; and degradation: wrong token, service killed (answers in 32 ms with an empty list), product creation still succeeding with the service down. Plus the assistant: a question sharing no words with any product still suggests the semantic match, keyword matches stay first, no duplicates, another store's product never shown, and a failing service falls back to keywords.
- Real model, once by hand (`scripts/try_real_model.py`): "something to drink my morning coffee from" finds the ceramic mug, "shoes for a marathon" finds the trail running shoes, "music on the go" finds the earbuds, "quantum physics textbook" scores everything below the floor.
- Browser (`phase6-recommendations.e2e.mjs`): the row on the product page (closest first, never itself, never sold out, real prices, add to cart from the row, opening one reloads its own row), the home page (absent for a first-time visitor, present after viewing a product and based on it), no empty box for a one-product store, no horizontal scroll at 375 px, no console errors.

## Deliberate limits

- Text only: images, prices and purchase history do not affect similarity. There is no interaction data to learn from, which is the plan's own reason for choosing embeddings over a trained model.
- Brute force is capped at 5000 products per store (`MAX_PRODUCTS_PER_STORE`); beyond that the service should get a real index.
- The home page's recommendations follow the single last product viewed, in this browser. A shopper who signs in elsewhere starts fresh; nothing is stored on the server.
- Model files are downloaded from Hugging Face on first use. On the development machine Python's HTTPS connection to huggingface.co was reset for small files, so the missing tokenizer files were fetched with `curl` into the cache folder and the service run from there. A normal network does not need this; the README's `RECO_MODEL_CACHE` keeps the download permanent.
- Docker Compose for the service belongs to Phase 8 and was not started. Phase 7's "pytest" item was not ticked: the 14 tests exist already, but Phase 7 as a whole was not started.
