import { Types } from "mongoose";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { env } from "../../config/env";
import { getRecommendationClient, type ScoredProduct } from "../../lib/recommendationClient";
import { productService } from "../products/product.service";

/**
 * Implementation_Plan.md Phase 6: "products like this one". Node owns the public endpoint, tenant
 * scoping, stock and ratings; the Python service only ranks by similarity. A recommendation is a
 * nicety, never a reason for a product page to fail, so every failure of the service (not
 * configured, down, slow, erroring) degrades to "no recommendations" instead of an error.
 */

const MAX_LIMIT = 12;
// Ask the service for more than is shown: sold-out products are filtered out afterwards, and a
// row of four should still be four when one candidate happens to be out of stock.
const OVERFETCH = 2;

interface CacheEntry {
  at: number;
  items: ScoredProduct[];
}
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = 500;

function cacheGet(key: string): ScoredProduct[] | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > env.recommendation.cacheSeconds * 1000) {
    cache.delete(key);
    return undefined;
  }
  return hit.items;
}

function cacheSet(key: string, items: ScoredProduct[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string); // oldest first
  cache.set(key, { at: Date.now(), items });
}

export const recommendationService = {
  /** Test hook: forget every cached list. */
  clearCache(): void {
    cache.clear();
  },

  async forProduct(storeId: string, productId: string, limit: number) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    // Checked here rather than left to the service, so an unknown product is a 404 even when the
    // service is down, and one store can never probe another's ids through this endpoint.
    if (!(await Product.exists({ _id: productId, storeId }))) throw Errors.notFound("Product");

    const wanted = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const candidates = wanted * OVERFETCH;
    const key = `${storeId}:${productId}:${candidates}`;

    let scored = cacheGet(key);
    if (!scored) {
      try {
        scored = (await getRecommendationClient().recommend(storeId, productId, candidates)) ?? [];
      } catch (err) {
        console.warn(`[recommendations] unavailable for product ${productId}: ${(err as Error).message}`);
        return []; // not cached, so it recovers the moment the service does
      }
      cacheSet(key, scored);
    }

    const products = await productService.getMany(storeId, scored.map((s) => s.productId));
    return products.filter((p) => p.id !== productId && p.stock > 0).slice(0, wanted);
  },
};
