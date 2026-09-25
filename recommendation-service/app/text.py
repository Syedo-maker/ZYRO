"""What text represents a product, and how to tell whether a stored vector is still current."""
import hashlib
from typing import Any


def embedding_text(product: dict[str, Any]) -> str:
    """The plan says title + description. Category is added on purpose: a product with a thin
    description ("Blue one, size M") would otherwise carry almost no signal, and category is the
    one other field every product is required to have. Tags are left out because they are often
    an AI suggestion the merchant may not have reviewed."""
    parts = [
        str(product.get("title") or "").strip(),
        str(product.get("category") or "").strip(),
        str(product.get("description") or "").strip(),
    ]
    return "\n".join(p for p in parts if p)


def fingerprint(model_name: str, text: str) -> str:
    """Stored next to each vector. A vector is reused only when this still matches, so editing a
    product's text, or switching the embedding model, re-embeds it, and nothing else does."""
    return hashlib.sha256(f"{model_name}\n{text}".encode("utf-8")).hexdigest()
