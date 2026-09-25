"""Embedding and similarity, tied together.

Vectors are kept current lazily: every request first compares each product's stored fingerprint
with the fingerprint of its current text and embeds only the ones that differ. So the
fire-and-forget calls Node makes on product create/update are an optimization (they warm the
vector before a shopper asks), not a correctness dependency: if one is lost, or the service was
down at the time, the next recommendation request repairs it.
"""
import asyncio
from dataclasses import dataclass
from typing import Any

import numpy as np

from .embedder import Embedder
from .repository import ProductRepository
from .similarity import top_k
from .text import embedding_text, fingerprint

#: Brute-force cosine similarity is fine at this size (a few thousand 384-float rows). Past it the
#: plan's approach should give way to an index, so the cap is explicit instead of silently slow.
MAX_PRODUCTS_PER_STORE = 5000


@dataclass
class Scored:
    product_id: str
    score: float


class RecommendationService:
    def __init__(self, embedder: Embedder, repo: ProductRepository, search_min_score: float) -> None:
        self._embedder = embedder
        self._repo = repo
        self._search_min_score = search_min_score

    async def _embed_stale(self, store_id: str, products: list[dict[str, Any]]) -> int:
        """Embed (and persist) whichever of `products` has a missing or out-of-date vector, filling
        the vectors into the dicts in place. Returns how many were computed."""
        stale: list[tuple[dict[str, Any], str, str]] = []
        for p in products:
            text = embedding_text(p)
            digest = fingerprint(self._embedder.name, text)
            p["_text"], p["_hash"] = text, digest
            if not text:
                # Nothing to embed (an untitled draft). It simply never matches anything.
                p["embedding"] = None
                continue
            if p.get("embeddingHash") != digest or not p.get("embedding"):
                stale.append((p, text, digest))
        if not stale:
            return 0
        # CPU-bound and sync: off the event loop so health checks and other requests keep moving.
        vectors = await asyncio.to_thread(self._embedder.embed_documents, [t for _, t, _ in stale])
        rows = []
        for (p, _text, digest), vec in zip(stale, vectors):
            as_list = [float(x) for x in vec]
            p["embedding"], p["embeddingHash"] = as_list, digest
            rows.append((p["id"], as_list, digest))
        await self._repo.save_embeddings(store_id, rows)
        return len(stale)

    async def _store_matrix(self, store_id: str) -> tuple[list[str], np.ndarray]:
        products = await self._repo.list_products(store_id, MAX_PRODUCTS_PER_STORE)
        await self._embed_stale(store_id, products)
        embedded = [p for p in products if p.get("embedding")]
        if not embedded:
            return [], np.zeros((0, 0), dtype=np.float32)
        ids = [p["id"] for p in embedded]
        matrix = np.array([p["embedding"] for p in embedded], dtype=np.float32)
        return ids, matrix

    async def embed_product(self, store_id: str, product_id: str) -> bool:
        """Compute (if needed) one product's vector. False when the product does not exist in this
        store, which the API reports as a 404 rather than pretending it worked."""
        product = await self._repo.get_product(store_id, product_id)
        if product is None:
            return False
        await self._embed_stale(store_id, [product])
        return True

    async def reindex(self, store_id: str) -> dict[str, int]:
        products = await self._repo.list_products(store_id, MAX_PRODUCTS_PER_STORE)
        computed = await self._embed_stale(store_id, products)
        return {"products": len(products), "embedded": computed}

    async def recommendations(self, store_id: str, product_id: str, limit: int) -> list[Scored] | None:
        """Products most similar to `product_id`, or None when that product is not in the store."""
        ids, matrix = await self._store_matrix(store_id)
        if product_id not in ids:
            source = await self._repo.get_product(store_id, product_id)
            if source is None:
                return None
            # Exists but has nothing to embed (empty text): nothing to compare against.
            return []
        query = matrix[ids.index(product_id)]
        hits = top_k(matrix, query, ids, limit, exclude={product_id})
        return [Scored(pid, score) for pid, score in hits]

    async def search(self, store_id: str, query: str, limit: int) -> list[Scored]:
        """Products whose meaning is close to a free-text query, dropping weak matches: unlike a
        recommendation, a search for something the store does not sell should return nothing."""
        query = query.strip()
        if not query:
            return []
        ids, matrix = await self._store_matrix(store_id)
        if not ids:
            return []
        qvec = await asyncio.to_thread(self._embedder.embed_query, query)
        hits = top_k(matrix, qvec, ids, limit, min_score=self._search_min_score)
        return [Scored(pid, score) for pid, score in hits]
