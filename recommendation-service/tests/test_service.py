"""Hermetic tests: an in-memory repository and the deterministic hashing embedder, no MongoDB and no
model download. The Node side's verify-recommendations.ts covers the real MongoDB path."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.embedder import HashingEmbedder
from app.main import create_app
from app.similarity import top_k
from app.text import embedding_text, fingerprint

TOKEN = "test-token"
H = {"X-Internal-Token": TOKEN}


class MemoryRepo:
    """Enforces storeId on every access, like the Mongo one, so isolation tests mean something."""

    def __init__(self, products):
        self.products = {p["id"]: dict(p) for p in products}
        self.saves = 0

    async def list_products(self, store_id, limit):
        return [dict(p) for p in self.products.values() if p["storeId"] == store_id][:limit]

    async def get_product(self, store_id, product_id):
        p = self.products.get(product_id)
        return dict(p) if p and p["storeId"] == store_id else None

    async def save_embeddings(self, store_id, rows):
        for pid, vec, digest in rows:
            p = self.products.get(pid)
            if p and p["storeId"] == store_id:
                p["embedding"], p["embeddingHash"] = vec, digest
                self.saves += 1


def product(pid, store, title, category, description=""):
    return {"id": pid, "storeId": store, "title": title, "category": category, "description": description}


CATALOG = [
    product("p1", "s1", "Red running shoes", "Footwear", "Lightweight running shoes for road runners"),
    product("p2", "s1", "Blue running shoes", "Footwear", "Cushioned running shoes for long road runs"),
    product("p3", "s1", "Ceramic coffee mug", "Kitchen", "Stoneware mug that keeps coffee warm"),
    product("p4", "s1", "Espresso coffee mug", "Kitchen", "Small ceramic mug for espresso coffee"),
    product("p5", "s2", "Red running shoes", "Footwear", "Another store selling the same thing"),
]


@pytest.fixture
def repo():
    return MemoryRepo(CATALOG)


@pytest.fixture
def client(repo):
    settings = Settings("unused", TOKEN, "hashing", "unused", None, 0.2)
    return TestClient(create_app(settings, HashingEmbedder(), repo))


def test_health_needs_no_token(client):
    assert client.get("/health").json()["status"] == "ok"


def test_other_endpoints_reject_missing_and_wrong_token(client):
    url = "/recommendations?storeId=s1&productId=p1"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"X-Internal-Token": "nope"}).status_code == 401
    assert client.post("/reindex", json={"storeId": "s1"}).status_code == 401
    assert client.post("/search", json={"storeId": "s1", "query": "mug"}).status_code == 401
    assert client.post("/embed/product", json={"storeId": "s1", "productId": "p1"}).status_code == 401


def test_similar_products_rank_first_and_source_is_excluded(client):
    items = client.get("/recommendations?storeId=s1&productId=p1&limit=3", headers=H).json()["items"]
    ids = [i["productId"] for i in items]
    assert "p1" not in ids
    assert ids[0] == "p2"  # the other running shoe beats the mugs
    assert items[0]["score"] > items[-1]["score"]


def test_recommendations_never_cross_stores(client):
    ids = [i["productId"] for i in client.get("/recommendations?storeId=s1&productId=p1&limit=20", headers=H).json()["items"]]
    assert "p5" not in ids
    # Asking store s2 about a product of store s1 is a 404, not a leak.
    assert client.get("/recommendations?storeId=s2&productId=p1", headers=H).status_code == 404


def test_unknown_product_is_404(client):
    assert client.get("/recommendations?storeId=s1&productId=zzz", headers=H).status_code == 404
    assert client.post("/embed/product", json={"storeId": "s1", "productId": "zzz"}, headers=H).status_code == 404


def test_vectors_are_stored_and_only_recomputed_when_text_changes(client, repo):
    client.get("/recommendations?storeId=s1&productId=p1", headers=H)
    assert repo.saves == 4  # every s1 product embedded once, s2 untouched
    assert "embedding" not in repo.products["p5"]
    stored = repo.products["p1"]
    assert stored["embeddingHash"] == fingerprint("hashing-256", embedding_text(stored))

    client.get("/recommendations?storeId=s1&productId=p1", headers=H)
    assert repo.saves == 4  # second request reuses them

    repo.products["p3"]["title"] = "Steel travel flask"
    client.get("/recommendations?storeId=s1&productId=p1", headers=H)
    assert repo.saves == 5  # only the edited product


def test_embed_product_and_reindex(client, repo):
    assert client.post("/embed/product", json={"storeId": "s1", "productId": "p2"}, headers=H).json() == {"ok": True}
    assert "embedding" in repo.products["p2"] and "embedding" not in repo.products["p1"]
    result = client.post("/reindex", json={"storeId": "s1"}, headers=H).json()
    assert result == {"products": 4, "embedded": 3}  # p2 was already done


def test_search_returns_matches_and_drops_unrelated_queries(client):
    hits = client.post("/search", json={"storeId": "s1", "query": "coffee mug", "limit": 5}, headers=H).json()["items"]
    assert {h["productId"] for h in hits} >= {"p3", "p4"}
    assert hits[0]["productId"] in ("p3", "p4")
    none = client.post("/search", json={"storeId": "s1", "query": "quantum chromodynamics lecture", "limit": 5}, headers=H).json()
    assert none["items"] == []


def test_search_is_store_scoped(client):
    hits = client.post("/search", json={"storeId": "s2", "query": "running shoes"}, headers=H).json()["items"]
    assert [h["productId"] for h in hits] == ["p5"]


def test_product_with_no_text_is_skipped_not_fatal(repo):
    repo.products["p9"] = product("p9", "s1", "", "", "")
    settings = Settings("unused", TOKEN, "hashing", "unused", None, 0.2)
    c = TestClient(create_app(settings, HashingEmbedder(), repo))
    assert c.get("/recommendations?storeId=s1&productId=p9", headers=H).json() == {"items": []}
    ids = [i["productId"] for i in c.get("/recommendations?storeId=s1&productId=p1&limit=20", headers=H).json()["items"]]
    assert "p9" not in ids


def test_validation_limits(client):
    assert client.get("/recommendations?storeId=s1&productId=p1&limit=0", headers=H).status_code == 422
    assert client.get("/recommendations?storeId=s1&productId=p1&limit=21", headers=H).status_code == 422
    assert client.post("/search", json={"storeId": "s1", "query": ""}, headers=H).status_code == 422


def test_top_k_min_score_and_exclusion():
    matrix = np.array([[1, 0], [0.6, 0.8], [0, 1]], dtype=np.float32)
    q = np.array([1, 0], dtype=np.float32)
    assert [p for p, _ in top_k(matrix, q, ["a", "b", "c"], 3)] == ["a", "b", "c"]
    assert [p for p, _ in top_k(matrix, q, ["a", "b", "c"], 3, exclude={"a"})] == ["b", "c"]
    assert [p for p, _ in top_k(matrix, q, ["a", "b", "c"], 3, min_score=0.5)] == ["a", "b"]
    assert top_k(matrix, q, [], 3) == []


def test_hashing_embedder_is_deterministic_and_normalized():
    e = HashingEmbedder()
    a, b = e.embed_documents(["red shoes", "red shoes"])
    assert np.allclose(a, b)
    assert abs(float(np.linalg.norm(a)) - 1.0) < 1e-5
    assert np.allclose(e.embed_query("red shoes"), a)


def test_settings_require_a_token(monkeypatch):
    from app.config import load_settings

    monkeypatch.delenv("RECOMMENDATION_SERVICE_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        load_settings()
