import { Types, HydratedDocument } from "mongoose";
import { Product, ProductDocument } from "../../models/Product.model";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import type { ProductInput, ListProductsQuery } from "./product.validation";

function toPublicProduct(doc: HydratedDocument<ProductDocument>, stock: number) {
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
    aiDescriptionStatus: null as "draft" | "published" | null, // wired up once Module 6 (AI Content Tools) exists
  };
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
  async list(storeId: string, query: ListProductsQuery) {
    const filter: Record<string, unknown> = { storeId };
    if (query.category) filter.category = query.category;
    if (query.q) filter.$text = { $search: query.q };

    const [docs, total] = await Promise.all([
      Product.find(filter).skip(query.offset).limit(query.limit).sort({ createdAt: -1 }),
      Product.countDocuments(filter),
    ]);

    const stock = await inventoryService.getTotals(
      prisma,
      storeId,
      docs.map((d) => d._id.toString())
    );

    return {
      data: docs.map((d) => toPublicProduct(d, stock.get(d._id.toString()) ?? 0)),
      pagination: { total, limit: query.limit, offset: query.offset },
    };
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
    const stock = await inventoryService.getTotals(prisma, storeId, [productId]);
    return toPublicProduct(doc, stock.get(productId) ?? 0);
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
    // Inventory rows and the stock ledger are deliberately kept: past orders and audits
    // still reference this product id.
  },
};
