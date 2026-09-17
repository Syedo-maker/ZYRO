import { Types, HydratedDocument } from "mongoose";
import { Product, ProductDocument } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import type { ProductInput, ListProductsQuery } from "./product.validation";

function toPublicProduct(doc: HydratedDocument<ProductDocument>) {
  return {
    id: doc._id.toString(),
    storeId: doc.storeId,
    title: doc.title,
    description: doc.description,
    price: Number(doc.price.toString()),
    stock: doc.stock,
    category: doc.category,
    images: doc.images,
    aiDescriptionStatus: null as "draft" | "published" | null, // wired up once Module 6 (AI Content Tools) exists
  };
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

    return {
      data: docs.map(toPublicProduct),
      pagination: { total, limit: query.limit, offset: query.offset },
    };
  },

  async create(storeId: string, input: ProductInput) {
    const doc = await Product.create({ storeId, ...input });
    return toPublicProduct(doc);
  },

  async get(storeId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    const doc = await Product.findOne({ _id: productId, storeId });
    if (!doc) throw Errors.notFound("Product");
    return toPublicProduct(doc);
  },

  async update(storeId: string, productId: string, input: ProductInput) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    // findOneAndUpdate (not findByIdAndUpdate/findUnique-style) so storeId is part of the
    // filter, not assumed; the same discipline as the Prisma tenant-scoping middleware.
    const doc = await Product.findOneAndUpdate({ _id: productId, storeId }, input, { new: true });
    if (!doc) throw Errors.notFound("Product");
    return toPublicProduct(doc);
  },

  async remove(storeId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
    const result = await Product.deleteOne({ _id: productId, storeId });
    if (result.deletedCount === 0) throw Errors.notFound("Product");
  },
};
