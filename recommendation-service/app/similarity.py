"""Brute-force cosine similarity, as Implementation_Plan.md Phase 6 specifies.

Vectors arrive L2-normalized (see embedder.py), so cosine similarity is a plain matrix-vector
product. A per-store catalog is small enough (see MAX_PRODUCTS_PER_STORE in service.py) that
scoring every product on every request is cheap and needs no vector index.
"""
import numpy as np


def top_k(
    matrix: np.ndarray,
    query: np.ndarray,
    ids: list[str],
    k: int,
    exclude: set[str] | None = None,
    min_score: float | None = None,
) -> list[tuple[str, float]]:
    """The `k` rows of `matrix` most similar to `query`, best first, as (id, score)."""
    if k <= 0 or len(ids) == 0:
        return []
    scores = matrix @ query
    order = np.argsort(-scores, kind="stable")
    out: list[tuple[str, float]] = []
    for index in order:
        pid = ids[int(index)]
        if exclude and pid in exclude:
            continue
        score = float(scores[index])
        if min_score is not None and score < min_score:
            # Sorted best first, so nothing after this can qualify either.
            break
        out.append((pid, score))
        if len(out) == k:
            break
    return out
