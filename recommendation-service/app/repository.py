"""Reading products and writing their embeddings back, always scoped by storeId.

The plan stores each vector on the Product Mongo document itself (`embedding`, plus an
`embeddingHash` fingerprint) rather than in a separate vector store. Every query here carries
`storeId`, mirroring the Mongoose tenant-scope plugin on the Node side: this service reads and
writes the same collection, so it must keep the same isolation guarantee.
"""
from typing import Any, Protocol

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection

# Only what similarity needs. `price`, `costPrice` and the rest never leave the database here.
_PROJECTION = {"title": 1, "category": 1, "description": 1, "embedding": 1, "embeddingHash": 1}


class ProductRepository(Protocol):
    async def list_products(self, store_id: str, limit: int) -> list[dict[str, Any]]:
        """Each dict has `id` (str), title, category, description and, when present, embedding
        (list[float]) and embeddingHash."""

    async def get_product(self, store_id: str, product_id: str) -> dict[str, Any] | None: ...

    async def save_embeddings(self, store_id: str, rows: list[tuple[str, list[float], str]]) -> None:
        """Rows are (product_id, vector, hash)."""


def _to_object_id(value: str) -> ObjectId | None:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def _shape(doc: dict[str, Any]) -> dict[str, Any]:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    return doc


class MongoProductRepository:
    def __init__(self, uri: str) -> None:
        self._client = AsyncIOMotorClient(uri)
        db = self._client.get_default_database()
        self._products: AsyncIOMotorCollection = db["products"]

    async def list_products(self, store_id: str, limit: int) -> list[dict[str, Any]]:
        cursor = self._products.find({"storeId": store_id}, _PROJECTION).sort("_id", 1).limit(limit)
        return [_shape(doc) async for doc in cursor]

    async def get_product(self, store_id: str, product_id: str) -> dict[str, Any] | None:
        oid = _to_object_id(product_id)
        if oid is None:
            return None
        doc = await self._products.find_one({"_id": oid, "storeId": store_id}, _PROJECTION)
        return _shape(doc) if doc else None

    async def save_embeddings(self, store_id: str, rows: list[tuple[str, list[float], str]]) -> None:
        from pymongo import UpdateOne

        ops = []
        for product_id, vector, digest in rows:
            oid = _to_object_id(product_id)
            if oid is None:
                continue
            # storeId in the filter: never write a vector onto another tenant's product.
            ops.append(
                UpdateOne(
                    {"_id": oid, "storeId": store_id},
                    {"$set": {"embedding": vector, "embeddingHash": digest}},
                )
            )
        if ops:
            await self._products.bulk_write(ops, ordered=False)

    def close(self) -> None:
        self._client.close()
