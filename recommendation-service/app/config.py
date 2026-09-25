"""Settings, read once from the environment (Implementation_Plan.md Phase 6)."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str
    #: Shared secret Node sends as X-Internal-Token. There is no default on purpose: the service
    #: reads and writes another service's catalog, so it refuses to start without one.
    token: str
    #: "fastembed" (a real local model) or "hashing" (deterministic, no download; tests only).
    embedder: str
    model: str
    cache_dir: str | None
    #: A search result must be at least this similar to the query to be returned at all.
    search_min_score: float


def load_settings() -> Settings:
    token = os.environ.get("RECOMMENDATION_SERVICE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("RECOMMENDATION_SERVICE_TOKEN is not set; refusing to start without a shared secret")
    embedder = os.environ.get("RECO_EMBEDDER", "fastembed").strip().lower()
    if embedder not in ("fastembed", "hashing"):
        raise RuntimeError("RECO_EMBEDDER must be 'fastembed' or 'hashing'")
    # bge-small scores related text around 0.6 to 0.8 and unrelated text around 0.45 to 0.5 (measured
    # with scripts/try_real_model.py), so 0.55 sits in the gap. Other models need their own value.
    default_min = "0.2" if embedder == "hashing" else "0.55"
    return Settings(
        mongodb_uri=os.environ.get("MONGODB_URI", "mongodb://localhost:27017/zyro"),
        token=token,
        embedder=embedder,
        model=os.environ.get("RECO_MODEL", "BAAI/bge-small-en-v1.5"),
        cache_dir=os.environ.get("RECO_MODEL_CACHE") or None,
        search_min_score=float(os.environ.get("RECO_SEARCH_MIN_SCORE", default_min)),
    )
