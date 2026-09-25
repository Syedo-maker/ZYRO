"""Turning text into vectors.

Implementation_Plan.md Phase 6 wants embeddings, not a trained model. The plan routes them through
Node's AI orchestrator, but Anthropic has no embeddings endpoint, so on the project owner's call the
vectors are computed locally with a small ONNX model (fastembed): no API key, no per-call cost, no
network after the first model download. Everything else depends only on the `Embedder` interface,
so the plan's route (a provider behind Node's orchestrator) can replace this later without touching
similarity search or storage.
"""
import hashlib
import re
import threading
from typing import Protocol

import numpy as np


class Embedder(Protocol):
    #: Identifies the model. It is part of every stored vector's fingerprint, so switching model
    #: re-embeds the catalog instead of comparing vectors from two different vector spaces.
    name: str

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        """Shape (n, dims), rows L2-normalized, so a dot product is the cosine similarity."""

    def embed_query(self, text: str) -> np.ndarray:
        """Shape (dims,), L2-normalized."""


def _normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    norms[norms == 0] = 1.0
    return (matrix / norms).astype(np.float32)


class HashingEmbedder:
    """Deterministic bag-of-words hashing into a fixed number of dimensions. Not semantic (it only
    knows shared words), but needs no download and gives the same vector for the same text every
    time, which is what the tests need."""

    def __init__(self, dims: int = 256) -> None:
        self.dims = dims
        self.name = f"hashing-{dims}"

    def _vector(self, text: str) -> np.ndarray:
        vec = np.zeros(self.dims, dtype=np.float32)
        for token in re.findall(r"[a-z0-9]+", text.lower()):
            digest = hashlib.md5(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "little") % self.dims
            vec[index] += 1.0 if digest[4] % 2 == 0 else -1.0
        return vec

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dims), dtype=np.float32)
        return _normalize(np.stack([self._vector(t) for t in texts]))

    def embed_query(self, text: str) -> np.ndarray:
        return _normalize(self._vector(text)[None, :])[0]


class FastEmbedEmbedder:
    """A real sentence-embedding model run locally through ONNX (no torch). The model is loaded on
    first use, so importing this module and starting the service stay fast."""

    def __init__(self, model: str, cache_dir: str | None = None) -> None:
        self.name = model
        self._model_name = model
        self._cache_dir = cache_dir
        self._model = None
        # Requests run this in worker threads; without a lock two first requests would both
        # start loading (and possibly downloading) the model.
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding

                self._model = TextEmbedding(model_name=self._model_name, cache_dir=self._cache_dir)
            return self._model

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 0), dtype=np.float32)
        return _normalize(np.array(list(self._load().embed(texts)), dtype=np.float32))

    def embed_query(self, text: str) -> np.ndarray:
        # query_embed adds the retrieval prefix this model family was trained to expect on queries.
        return _normalize(np.array(list(self._load().query_embed([text])), dtype=np.float32))[0]


def build_embedder(kind: str, model: str, cache_dir: str | None) -> Embedder:
    if kind == "hashing":
        return HashingEmbedder()
    return FastEmbedEmbedder(model, cache_dir)
