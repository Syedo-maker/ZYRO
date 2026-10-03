"""HTTP surface of the recommendation service (Implementation_Plan.md Phase 6).

Only Node's backend calls this, over the internal network; shoppers never do. Every endpoint but
/health requires the shared secret in X-Internal-Token, and the Node side is what enforces who may
see which store, so `storeId` here is trusted input from an authenticated caller.
"""
import hmac
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from .embedder import Embedder, build_embedder
from .transcriber import MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, Transcriber, build_transcriber
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
    transcriber: Transcriber | None = None,
) -> FastAPI:
    """Arguments exist so tests can inject an in-memory repository; production passes none."""
    settings = settings or load_settings()
    embedder = embedder or build_embedder(settings.embedder, settings.model, settings.cache_dir)
    own_repo = repo is None
    repo = repo or MongoProductRepository(settings.mongodb_uri)
    service = RecommendationService(embedder, repo, settings.search_min_score)
    transcriber = transcriber or build_transcriber(settings.whisper_enabled, settings.whisper_model, settings.cache_dir)

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

    @app.post("/transcribe", dependencies=[Depends(require_token)])
    async def transcribe(file: UploadFile = File(...)):
        """Part G: a merchant's voice note, as text. Anthropic does not accept audio, so this runs
        locally with faster-whisper. Only Node calls it, and only for a store it has already
        authorised; nothing about the store is needed here, because nothing is stored."""
        audio = await file.read()
        if not audio:
            raise HTTPException(status_code=400, detail="The audio file is empty")
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail=f"The recording is larger than {MAX_AUDIO_BYTES // (1024 * 1024)} MB")
        try:
            result = await transcriber.transcribe(audio, file.filename or "note.webm")
        except RuntimeError as exc:
            # Whisper is not installed or not enabled: a clear 503, so Node can say so plainly.
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if result.duration_seconds > MAX_AUDIO_SECONDS:
            raise HTTPException(status_code=400, detail=f"The recording is longer than {MAX_AUDIO_SECONDS} seconds")
        return {
            "text": result.text,
            "language": result.language,
            "confidence": result.confidence,
            "durationSeconds": result.duration_seconds,
        }

    return app
