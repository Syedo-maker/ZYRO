import { Types } from "mongoose";
import { Category, normalizeCategoryName, tidyCategoryName, type CategoryDocument } from "../../models/Category.model";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import type { CreateCategoryInput, UpdateCategoryInput } from "./category.validation";

/**
 * A store's own categories. Every query names the store: the Category model's tenant plugin refuses
 * one that does not, so a category can never be read or changed from another store.
 *
 * Products point at a category by id (`categoryId`). They also carry a copy of its name (`category`),
 * written only by the server, because search, the storefront menu, the shop directory, Trend Scout
 * and the AI prompts all read a name; renaming a category rewrites that copy on its products in the
 * same request, so the new name shows everywhere at once.
 */

type CategoryRow = CategoryDocument & { _id: Types.ObjectId };

function present(c: CategoryRow, productCount: number) {
  return {
    id: c._id.toString(),
    name: c.name,
    active: c.active,
    productCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

/** Names the category that already exists, as its owner wrote it, not the clash just typed. */
async function duplicate(storeId: string, name: string) {
  const existing = await Category.findOne({ storeId, normalizedName: normalizeCategoryName(name) }).lean<CategoryRow>();
  return Errors.conflict(
    `A category called "${existing?.name ?? name}" already exists in this store. Names are compared without regard to capitals or spaces.`
  );
}

async function find(storeId: string, categoryId: string): Promise<CategoryRow> {
  if (!Types.ObjectId.isValid(categoryId)) throw Errors.notFound("Category");
  const category = await Category.findOne({ _id: categoryId, storeId }).lean<CategoryRow>();
  if (!category) throw Errors.notFound("Category");
  return category;
}

/** How many of this store's products are in each category, by category id. */
async function productCounts(storeId: string): Promise<Map<string, number>> {
  const rows = await Product.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { storeId, categoryId: { $exists: true } } },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

export const categoryService = {
  /** Every category in the store, active first, then by name, each with how many products it holds. */
  async list(storeId: string) {
    const [categories, counts] = await Promise.all([
      Category.find({ storeId }).sort({ active: -1, normalizedName: 1 }).lean<CategoryRow[]>(),
      productCounts(storeId),
    ]);
    return categories.map((c) => present(c, counts.get(c._id.toString()) ?? 0));
  },

  async create(storeId: string, input: CreateCategoryInput) {
    const name = tidyCategoryName(input.name);
    try {
      const created = await Category.create({ storeId, name, normalizedName: normalizeCategoryName(name), active: true });
      return present(created.toObject() as CategoryRow, 0);
    } catch (err) {
      if (isDuplicateKey(err)) throw await duplicate(storeId, name);
      throw err;
    }
  },

  /** Rename, enable or disable. A rename reaches every product in the category in the same request. */
  async update(storeId: string, categoryId: string, input: UpdateCategoryInput) {
    const current = await find(storeId, categoryId);
    const set: Partial<CategoryDocument> = {};
    if (input.name !== undefined) {
      set.name = tidyCategoryName(input.name);
      set.normalizedName = normalizeCategoryName(input.name);
    }
    if (input.active !== undefined) set.active = input.active;

    let updated: CategoryRow | null;
    try {
      updated = await Category.findOneAndUpdate({ _id: current._id, storeId }, { $set: set }, { new: true }).lean<CategoryRow>();
    } catch (err) {
      if (isDuplicateKey(err)) throw await duplicate(storeId, set.name!);
      throw err;
    }
    if (!updated) throw Errors.notFound("Category");

    if (set.name !== undefined && set.name !== current.name) {
      await Product.updateMany({ storeId, categoryId: current._id }, { $set: { category: set.name } });
    }
    const counts = await productCounts(storeId);
    return present(updated, counts.get(updated._id.toString()) ?? 0);
  },

  /** Refused while any product is in it: the owner moves them to another category first. */
  async remove(storeId: string, categoryId: string) {
    const current = await find(storeId, categoryId);
    const inUse = await Product.countDocuments({ storeId, categoryId: current._id });
    if (inUse > 0) {
      throw Errors.conflict(
        `"${current.name}" still has ${inUse} product${inUse === 1 ? "" : "s"}. Move ${inUse === 1 ? "it" : "them"} to another category first, then delete it.`
      );
    }
    await Category.deleteOne({ _id: current._id, storeId });
  },

  /**
   * The category a product goes in, from what the request named: an id (the product form), or a name
   * from an older API caller. A name is matched to the store's category with the same normalized name
   * and creates it only when the store has none, so "toys" from a caller and "Toys" from the form are
   * the same category. Either way the category must be active.
   */
  async resolveForProduct(
    storeId: string,
    input: { categoryId?: string; category?: string },
    /** The product's category before an edit: it may stay there even if that category is disabled. */
    currentCategoryId?: string
  ): Promise<{ id: Types.ObjectId; name: string }> {
    if (input.categoryId !== undefined) return this.assertAssignable(storeId, input.categoryId, input.categoryId === currentCategoryId);
    const name = tidyCategoryName(input.category ?? "");
    if (!name) throw Errors.validation("categoryId: choose a category");
    const normalizedName = normalizeCategoryName(name);
    const findOrCreate = () =>
      Category.findOneAndUpdate(
        { storeId, normalizedName },
        { $setOnInsert: { storeId, name, normalizedName, active: true } },
        { upsert: true, new: true }
      ).lean<CategoryRow>();
    let category: CategoryRow | null;
    try {
      category = await findOrCreate();
    } catch (err) {
      // Two requests creating the same new name at once: one insert wins, the other finds it.
      if (!isDuplicateKey(err)) throw err;
      category = await findOrCreate();
    }
    if (!category!.active && category!._id.toString() !== currentCategoryId) throw Errors.validation(`categoryId: "${category!.name}" is disabled; enable it or choose another category`);
    return { id: category!._id, name: category!.name };
  },

  /**
   * The category a product is being put in: it must be one of this store's, and active (unless the
   * product is already in it). Returns the id and the name to copy onto the product.
   */
  async assertAssignable(storeId: string, categoryId: string, alreadyIn = false): Promise<{ id: Types.ObjectId; name: string }> {
    if (!Types.ObjectId.isValid(categoryId)) throw Errors.validation("categoryId: choose one of this store's categories");
    const category = await Category.findOne({ _id: categoryId, storeId }).lean<CategoryRow>();
    if (!category) throw Errors.validation("categoryId: choose one of this store's categories");
    if (!category.active && !alreadyIn) throw Errors.validation(`categoryId: "${category.name}" is disabled; enable it or choose another category`);
    return { id: category._id, name: category.name };
  },
};
