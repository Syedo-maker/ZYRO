import { Schema, model } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * A store's own product category (the supervisor's product-listing change, 2026-10-21).
 *
 * Each store defines its categories before listing products, and a product points at one by id, so
 * renaming a category renames it everywhere. `storeId` is the tenant (Tenant.id from Postgres), as on
 * every other catalogue document.
 *
 * `name` is kept exactly as the owner typed it, for display. `normalizedName` is what makes two names
 * the same category: trimmed, lower-cased, inner spaces collapsed, so "Toys", "toys" and " TOYS " are
 * one category, and the unique index below makes the database refuse a second.
 */
export interface CategoryDocument {
  storeId: string;
  name: string;
  normalizedName: string;
  /** A disabled category keeps its products but cannot be chosen for a new or edited product. */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The comparison form of a category name. Exported so the service and the migration agree exactly. */
export function normalizeCategoryName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The display form: what the owner typed, with the edges trimmed and inner runs of spaces made one. */
export function tidyCategoryName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

const categorySchema = new Schema<CategoryDocument>(
  {
    storeId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 60 },
    normalizedName: { type: String, required: true, maxlength: 60 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// One category per name per store, whatever the case or spacing. The database is the real guard:
// two owners pressing Save at the same moment cannot both get through.
categorySchema.index({ storeId: 1, normalizedName: 1 }, { unique: true, name: "category_name_per_store" });

categorySchema.plugin(tenantScopePlugin);

export const Category = model<CategoryDocument>("Category", categorySchema);
