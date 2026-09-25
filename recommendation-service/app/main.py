"""HTTP surface of the recommendation service (Implementation_Plan.md Phase 6).

Only Node's backend calls this, over the internal network; shoppers never do. Every endpoint but
/health requires the shared secret in X-Internal-Token, and the Node side is what enforces who may
see which store, so `storeId` here is trusted input from an authenticated caller.
"""
import hmac
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from .embedder import Embedder, build_embedder
from .repository import MongoProductRepository, ProductRepository
from .service import RecommendationService


class EmbedProductBody(BaseModel):
    storeId: str = Field(min_length=1, max_length=100)
    productId: str = Field(min_length=1, max_length=100)


class ReindexBody(BaseModel):
    storeId: str = Field(min_length=1, max_length=100)


class SearchBody(BaseModel):
    storeId: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=20)


def create_app(
    settings: Settings | None = None,
    embedder: Embedder | None = None,
    repo: ProductRepository | None = None,
) -> FastAPI:
    """Arguments exist so tests can inject an in-memory repository; production passes none."""
    settings = settings or load_settings()
    embedder = embedder or build_embedder(settings.embedder, settings.model, settings.cache_dir)
    own_repo = repo is None
    repo = repo or MongoProductRepository(settings.mongodb_uri)
    service = RecommendationService(embedder, repo, settings.search_min_score)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if own_repo:
            repo.close()  # type: ignore[attr-defined]

    app = FastAPI(title="ZYRO Recommendation Service", version="1.0.0", lifespan=lifespan)

    def require_token(x_internal_token: str | None = Header(default=None)) -> None:
        # compare_digest: constant-time, so the token cannot be guessed byte by byte from timing.
        if not x_internal_token or not hmac.compare_digest(x_internal_token, settings.token):
            raise HTTPException(status_code=401, detail="Invalid or missing internal token")

    @app.get("/health")
    async def health():
        return {"status": "ok", "embedder": embedder.name}

    @app.post("/embed/product", dependencies=[Depends(require_token)])
    async def embed_product(body: EmbedProductBody):
        if not await service.embed_product(body.storeId, body.productId):
            raise HTTPException(status_code=404, detail="Product not found in this store")
        return {"ok": True}

    @app.post("/reindex", dependencies=[Depends(require_token)])
    async def reindex(body: ReindexBody):
        return await service.reindex(body.storeId)

    @app.get("/recommendations", dependencies=[Depends(require_token)])
    async def recommendations(
        storeId: str = Query(min_length=1, max_length=100),
        productId: str = Query(min_length=1, max_length=100),
        limit: int = Query(default=4, ge=1, le=20),
    ):
        hits = await service.recommendations(storeId, productId, limit)
        if hits is None:
            raise HTTPException(status_code=404, detail="Product not found in this store")
        return {"items": [{"productId": h.product_id, "score": h.score} for h in hits]}

    @app.post("/search", dependencies=[Depends(require_token)])
    async def search(body: SearchBody):
        hits = await service.search(body.storeId, body.query, body.limit)
        return {"items": [{"productId": h.product_id, "score": h.score} for h in hits]}

    return app
