import { Types, HydratedDocument } from "mongoose";
import { Product, ProductDocument } from "../../models/Product.model";
import { AiGeneratedContent } from "../../models/AiGeneratedContent.model";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { indexProductInBackground } from "../../lib/recommendationClient";
import { planService } from "../billing/plan.service";
import { inventoryService } from "../inventory/inventory.service";
import { ratingsFor, reviewService } from "../reviews/review.service";
import type { ProductInput, ListProductsQuery } from "./product.validation";
import { forgetVocabulary, runLadder, semanticIds, type SearchOutcome } from "../search/search.service";
import { normalise } from "../search/search.query";

interface Rating {
  averageRating: number;
  reviewCount: number;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toPublicProduct(doc: HydratedDocument<ProductDocument>, stock: number, rating?: Rating, aiDescriptionStatus: "draft" | "published" | null = null) {
  return {
    id: doc._id.toString(),
    storeId: doc.storeId,
    title: doc.title,
    description: doc.description,
    price: Number(doc.price.toString()),
    stock,
    sku: doc.sku ?? null,
    barcode: doc.barcode ?? null,
    taxable: doc.taxable !== false,
    category: doc.category,
    images: doc.images,
    tags: doc.tags ?? [],
    seoTitle: doc.seoTitle ?? null,
    seoDescription: doc.seoDescription ?? null,
    // Computed on read from the published reviews (never stored on the product).
    averageRating: rating?.averageRating ?? null,
    reviewCount: rating?.reviewCount ?? 0,
    // Only resolved for a single product (get()); a plain null in list() avoids an extra
    // lookup per row on a page of results, and the catalog grid has nowhere to show it anyway.
    aiDescriptionStatus,
  };
}

/** The one place this reads AiGeneratedContent, so a list page never pays for N extra lookups. */
async function aiDescriptionStatusOf(doc: HydratedDocument<ProductDocument>): Promise<"draft" | "published" | null> {
  if (!doc.aiDescriptionId) return null;
  const content = await AiGeneratedContent.findOne({ _id: doc.aiDescriptionId, storeId: doc.storeId }).select("status");
  return content?.status ?? null;
}

/** Splits the API payload into the catalog fields (MongoDB) and the stock target (Postgres). */
function splitInput(input: ProductInput) {
  const { stock, costPrice, bargainMinPrice, ...rest } = input;
  return { stock, catalog: { ...rest, ...(costPrice !== undefined ? { costPrice } : {}), ...(bargainMinPrice !== undefined ? { bargainMinPrice } : {}) } };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

async function setStock(
  storeId: string,
  productId: string,
  target: number,
  type: "INITIAL" | "ADJUSTMENT",
  userId?: string
) {
  await prisma.$transaction(async (tx) => {
    const locationId = await inventoryService.getDefaultLocationId(tx, storeId);
    await inventoryService.setQuantity(tx, { tenantId: storeId, locationId, productId, target, type, userId });
  });
}

export const productService = {
  /**
   * Browse and search the public catalog.
   * - `q` searches with MongoDB's text index (title outranks category outranks description) and
   *   ranks by relevance. If the text search finds nothing (a partial word such as "cer" for
   *   "Ceramic", where text search only matches whole words), it falls back to a case-insensitive
   *   "contains" match on title and category, ordered by title.
   * - Filters: category, price range, and in-stock only (stock lives in Postgres, so the ids with
   *   stock are looked up there first). Sorting: relevance, newest, price, or title.
   * - Each product carries its average rating and review count, computed on read for the page.
   */
  async list(storeId: string, query: ListProductsQuery) {
    const filter: Record<string, unknown> = { storeId };
    if (query.category) filter.category = query.category;
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const price: Record<string, Types.Decimal128> = {};
      if (query.minPrice !== undefined) price.$gte = Types.Decimal128.fromString(query.minPrice.toFixed(2));
      if (query.maxPrice !== undefined) price.$lte = Types.Decimal128.fromString(query.maxPrice.toFixed(2));
      filter.price = price;
    }
    if (query.inStock) {
      const rows = await prisma.inventoryLevel.groupBy({
        by: ["productId"],
        where: { tenantId: storeId },
        _sum: { quantity: true },
        having: { quantity: { _sum: { gt: 0 } } },
      });
      filter._id = { $in: rows.filter((r) => Types.ObjectId.isValid(r.productId)).map((r) => new Types.ObjectId(r.productId)) };
    }

    // Part F: a typo or a Roman Urdu word is tried against the store's own vocabulary before
    // giving up, so "ceramik" and "ketli" find something. No AI is involved at any rung.
    let effective: Record<string, unknown> = filter;
    let outcome: SearchOutcome | null = null;
    /** For a semantic search: the order the service ranked them in, which `$in` does not preserve. */
    let semanticOrder: string[] | null = null;
    if (query.q) {
      outcome = await runLadder(storeId, query.q, filter, { exact: query.exact });
      if (outcome.filter) {
        effective = outcome.filter;
      } else if (query.exact) {
        effective = { ...filter, _id: { $in: [] } }; // taken literally: no meaning search either
      } else {
        // The words found nothing. Last resort: products that mean something like the query. The
        // ids are re-filtered against this store below, so a wrong answer still cannot cross stores.
        const ids = (await semanticIds(storeId, query.q))?.filter((id) => Types.ObjectId.isValid(id)) ?? [];
        effective = ids.length > 0 ? { ...filter, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } } : { ...filter, _id: { $in: [] } };
        if (ids.length > 0) {
          outcome = { ...outcome, step: "semantic" };
          semanticOrder = ids;
        }
      }
    }

    const wanted = query.sort ?? "relevance";
    const ranked = Boolean(outcome?.ranked) && wanted === "relevance";
    const sort: Record<string, 1 | -1 | { $meta: "textScore" }> = ranked
      ? { score: { $meta: "textScore" }, _id: -1 }
      : wanted === "price_asc"
        ? { price: 1, _id: 1 }
        : wanted === "price_desc"
          ? { price: -1, _id: -1 }
          : wanted === "title" || (outcome !== null && !outcome.ranked && wanted === "relevance")
            ? { title: 1, _id: 1 }
            : { createdAt: -1, _id: -1 };

    // A semantic answer is already ranked by how close the meaning is, and `$in` does not keep that
    // order, so those few results are ordered here instead. Any other sort the shopper picked wins.
    const keepSemanticOrder = semanticOrder !== null && wanted === "relevance";
    const [docs, total] = await Promise.all([
      keepSemanticOrder
        ? Product.find(effective)
            .collation({ locale: "en", strength: 2 })
            .then((found) => {
              const rank = new Map(semanticOrder!.map((id, i) => [id, i]));
              return found
                .sort((a, b) => (rank.get(a._id.toString()) ?? Infinity) - (rank.get(b._id.toString()) ?? Infinity))
                .slice(query.offset, query.offset + query.limit);
            })
        : Product.find(effective, ranked ? { score: { $meta: "textScore" } } : undefined)
            .collation({ locale: "en", strength: 2 })
            .sort(sort)
            .skip(query.offset)
            .limit(query.limit),
      Product.countDocuments(effective),
    ]);

    const ids = docs.map((d) => d._id.toString());
    const [stock, ratings] = await Promise.all([inventoryService.getTotals(prisma, storeId, ids), ratingsFor(storeId, ids)]);

    return {
      data: docs.map((d) => toPublicProduct(d, stock.get(d._id.toString()) ?? 0, ratings.get(d._id.toString()))),
      pagination: { total, limit: query.limit, offset: query.offset },
      // Only present for a search, and only when the words searched for were not the words typed,
      // so the storefront can say "Showing results for ..." rather than quietly changing the query.
      ...(outcome && (outcome.correctedTo || outcome.alsoSearched.length > 0 || outcome.step === "semantic")
        ? { interpretation: { step: outcome.step, correctedTo: outcome.correctedTo, changes: outcome.changes, alsoSearched: outcome.alsoSearched } }
        : {}),
    };
  },

  /** The store's categories with how many products each holds: biggest first, then by name. For category navigation. */
  async categories(storeId: string) {
    const rows = await Product.aggregate<{ _id: string; count: number }>([
      { $match: { storeId } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]);
    return rows.map((r) => ({ name: r._id, count: r.count }));
  },

  /** Search-box suggestions: products with a title word that starts with what was typed. */
  /**
   * Search-as-you-type. A prefix match first, because that is what someone half-way through a word
   * wants. Only if nothing starts with what they typed does it try the full ladder, so a shopper who
   * typed "ketli" or misspelt a word still sees suggestions instead of an empty box (Part F).
   */
  async suggest(storeId: string, q: string) {
    const present = (docs: { _id: Types.ObjectId; title: string; category: string }[]) =>
      docs.map((d) => ({ id: d._id.toString(), title: d.title, category: d.category }));

    // A query of only punctuation normalises to nothing. Without this guard the prefix pattern would
    // be an empty one, which matches every title, so a shopper typing "(.*" would get the whole shop.
    const cleaned = normalise(q);
    if (!cleaned) return [];

    const startsWith = new RegExp(`(^|\\s)${escapeRegex(cleaned)}`, "i");
    const prefix = await Product.find({ storeId, title: startsWith }).sort({ title: 1 }).limit(8).select("title category");
    if (prefix.length > 0) return present(prefix);

    const outcome = await runLadder(storeId, q, { storeId });
    if (!outcome.filter) return [];
    const docs = await Product.find(outcome.filter, outcome.ranked ? { score: { $meta: "textScore" } } : undefined)
      .sort(outcome.ranked ? { score: { $meta: "textScore" }, _id: -1 } : { title: 1 })
      .limit(8)
      .select("title category");
    return present(docs);
  },
  async create(storeId: string, input: ProductInput, userId?: string) {
    const { stock, catalog } = splitInput(input);
    await planService.assertCanAddProduct(storeId);

    let doc;
    try {
      doc = await Product.create({ storeId, ...catalog });
    } catch (err) {
      if (isDuplicateKey(err)) throw Errors.validation("SKU or barcode is already used by another product");
      throw err;
    }

    try {
      await setStock(storeId, doc._id.toString(), stock, "INITIAL", userId);
    } catch (err) {
      // Catalog and inventory live in different databases, so undo the product rather than
      // leave one that has no stock record.
      await Product.deleteOne({ _id: doc._id, storeId });
      throw err;
    }
    indexProductInBackground(storeId, doc._id.toString());
    // A new product should be findable by a typo straight away, not after the word list expires.
    void forgetVocabulary(storeId);
    return toPublicProduct(doc, stock);
  },

  /**
   * Several products by id, in the order the ids were given (similarity order for callers such as
   * recommendations), with stock and rating like a catalog row. Ids that do not exist in this
   * store, or are not valid ids, are simply absent from the result.
   */
  async getMany(storeId: string, ids: string[]) {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return [];
    const docs = await Product.find({ _id: { $in: valid }, storeId });
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));
    const found = valid.filter((id) => byId.has(id));
    const [stock, ratings] = await Promise.all([inventoryService.getTotals(prisma, storeId, found), ratingsFor(storeId, found)]);
    return found.map((id) => toPublicProduct(byId.get(id)!, stock.get(id) ?? 0, ratings.get(id)));
  },

  async get(storeId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    const doc = await Product.findOne({ _id: productId, storeId });
    if (!doc) throw Errors.notFound("Product");
    const [stock, rating, aiDescriptionStatus] = await Promise.all([
      inventoryService.getTotals(prisma, storeId, [productId]),
      ratingsFor(storeId, [productId]),
      aiDescriptionStatusOf(doc),
    ]);
    return toPublicProduct(doc, stock.get(productId) ?? 0, rating.get(productId), aiDescriptionStatus);
  },

  async update(storeId: string, productId: string, input: ProductInput, userId?: string) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    const { stock, catalog } = splitInput(input);

    // findOneAndUpdate (not findByIdAndUpdate/findUnique-style) so storeId is part of the
    // filter, not assumed; the same discipline as the Prisma tenant-scoping middleware.
    let doc;
    try {
      doc = await Product.findOneAndUpdate({ _id: productId, storeId }, catalog, { new: true });
    } catch (err) {
      if (isDuplicateKey(err)) throw Errors.validation("SKU or barcode is already used by another product");
      throw err;
    }
    if (!doc) throw Errors.notFound("Product");

    await setStock(storeId, productId, stock, "ADJUSTMENT", userId);
    indexProductInBackground(storeId, productId);
    void forgetVocabulary(storeId);
    return toPublicProduct(doc, stock);
  },

  async remove(storeId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    const result = await Product.deleteOne({ _id: productId, storeId });
    if (result.deletedCount === 0) throw Errors.notFound("Product");
    // Reviews belong to the product: they go with it (unlike stock history, which past orders still need).
    await reviewService.removeForProduct(storeId, productId);
    void forgetVocabulary(storeId);
    // Inventory rows and the stock ledger are deliberately kept: past orders and audits
    // still reference this product id.
  },
};
