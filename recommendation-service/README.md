# ZYRO Recommendation Service

Standalone Python 3.11 + FastAPI microservice for Phase 6 of `documentation/Implementation_Plan.md`.
It embeds each product's text into a vector, stores the vector on the product's MongoDB document, and
ranks a store's products by cosine similarity. Only the Node backend calls it, over the internal
network; shoppers reach it through `GET /api/v1/stores/:storeId/products/:productId/recommendations`.

Full write-up, including the one deliberate deviation from the plan: `documentation/Phase6_AI_Recommendation_Service.md`.

## Set up

```powershell
cd recommendation-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Run

```powershell
$env:RECOMMENDATION_SERVICE_TOKEN = "the same value as in backend/.env"
$env:MONGODB_URI = "mongodb://localhost:27017/zyro"
$env:RECO_MODEL_CACHE = "model-cache"        # keep the downloaded model (about 65 MB) somewhere permanent
.\.venv\Scripts\python.exe -m uvicorn app.asgi:app --host 127.0.0.1 --port 8001
```

The first request that needs the model downloads it from Hugging Face once. Bind to `127.0.0.1` (as
above) so only this machine can reach the service; the token is a second lock, not a replacement.
Then set `RECOMMENDATION_SERVICE_URL="http://127.0.0.1:8001"` and the same token in `backend/.env`.

## Endpoints (all but `/health` need the `X-Internal-Token` header)

| Endpoint | What it does |
| --- | --- |
| `GET /health` | Liveness, and which embedder is active. |
| `POST /embed/product` `{storeId, productId}` | Compute one product's vector if its text changed. Node calls this after every product create and update, fire and forget. 404 if the product is not in that store. |
| `POST /reindex` `{storeId}` | Bring every product of a store up to date. |
| `GET /recommendations?storeId&productId&limit` | The products most similar to one product, best first, never the product itself. |
| `POST /search` `{storeId, query, limit}` | Products whose meaning is close to free text. Weak matches are dropped. Used by the shopping assistant. |

Vectors also repair themselves: every request first re-embeds any product whose stored fingerprint
(a hash of its text and the model name) no longer matches. A lost `/embed/product` call therefore
costs nothing but a slower first request.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest                  # 14 hermetic tests, no MongoDB, no download
.\.venv\Scripts\python.exe scripts\try_real_model.py  # manual: the real model ranks by meaning
```

The Node side is covered by `backend/scripts/verify-recommendations.ts`, which starts this service
against the real MongoDB.

## Limits

- Brute force: a store is capped at 5000 products (`MAX_PRODUCTS_PER_STORE`), and each request reads
  the store's vectors. Past that, replace `similarity.py` with an index; nothing else needs to change.
- Text only. Images, prices and purchase history do not influence similarity.
