import { Types, HydratedDocument } from "mongoose";
import { Product, ProductDocument } from "../../models/Product.model";
import { AiGeneratedContent } from "../../models/AiGeneratedContent.model";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { ratingsFor, reviewService } from "../reviews/review.service";
import type { ProductInput, ListProductsQuery } from "./product.validation";

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
  const { stock, costPrice, ...rest } = input;
  return { stock, catalog: { ...rest, ...(costPrice !== undefined ? { costPrice } : {}) } };
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

    let effective: Record<string, unknown> = filter;
    let mode: "none" | "text" | "partial" = "none";
    if (query.q) {
      const textFilter = { ...filter, $text: { $search: query.q } };
      if ((await Product.countDocuments(textFilter)) > 0) {
        effective = textFilter;
        mode = "text";
      } else {
        const contains = new RegExp(escapeRegex(query.q), "i");
        effective = { ...filter, $or: [{ title: contains }, { category: contains }] };
        mode = "partial";
      }
    }

    const wanted = query.sort ?? "relevance";
    const ranked = mode === "text" && wanted === "relevance";
    const sort: Record<string, 1 | -1 | { $meta: "textScore" }> = ranked
      ? { score: { $meta: "textScore" }, _id: -1 }
      : wanted === "price_asc"
        ? { price: 1, _id: 1 }
        : wanted === "price_desc"
          ? { price: -1, _id: -1 }
          : wanted === "title" || (mode === "partial" && wanted === "relevance")
            ? { title: 1, _id: 1 }
            : { createdAt: -1, _id: -1 };

    const [docs, total] = await Promise.all([
      Product.find(effective, ranked ? { score: { $meta: "textScore" } } : undefined)
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
  async suggest(storeId: string, q: string) {
    const startsWith = new RegExp(`(^|\\s)${escapeRegex(q)}`, "i");
    const docs = await Product.find({ storeId, title: startsWith }).sort({ title: 1 }).limit(8).select("title category");
    return docs.map((d) => ({ id: d._id.toString(), title: d.title, category: d.category }));
  },
  async create(storeId: string, input: ProductInput, userId?: string) {
    const { stock, catalog } = splitInput(input);

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
    return toPublicProduct(doc, stock);
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
    return toPublicProduct(doc, stock);
  },

  async remove(storeId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    const result = await Product.deleteOne({ _id: productId, storeId });
    if (result.deletedCount === 0) throw Errors.notFound("Product");
    // Reviews belong to the product: they go with it (unlike stock history, which past orders still need).
    await reviewService.removeForProduct(storeId, productId);
    // Inventory rows and the stock ledger are deliberately kept: past orders and audits
    // still reference this product id.
  },
};
