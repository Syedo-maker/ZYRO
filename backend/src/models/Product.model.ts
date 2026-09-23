import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * Product catalog entry. Bounded fields (images, basic attributes) are embedded directly,
 * per the embed/reference framework: a product's own images/attributes are 1:1 or
 * 1:few and always accessed together with the product, so embedding avoids an extra
 * round trip. Reviews are NOT embedded here (see ProductReview.model.ts) because review
 * counts per product are unbounded and queried/paginated independently of the product
 * page (Implementation_Plan.md Phase 3).
 */
export interface ProductDocument {
  // Tenant.id from Postgres (a Prisma cuid string), NOT a Mongo ObjectId. Fixed during
  // Phase 1 Module 4: this field was originally typed as ObjectId, which would have
  // broken the moment a real cuid was stored in it.
  storeId: string;
  title: string;
  description: string;
  aiDescriptionId?: Types.ObjectId; // ref -> AiGeneratedContent, set once a draft/published description exists
  price: Types.Decimal128;
  images: string[]; // object-storage URLs only, never binary data (Implementation_Plan.md Phase 1)
  // Stock is NOT stored here. On-hand quantity lives in Postgres (InventoryLevel) so that
  // deducting it is atomic with order creation for both the online store and the POS.
  sku?: string;
  barcode?: string; // scanned at the POS
  taxable: boolean;
  costPrice?: Types.Decimal128; // enables margin analytics; never exposed to shoppers
  category: string;
  /** Set by the merchant, often from an AI auto-tag suggestion (Phase 4, Module 6); never
   *  written by the AI tool itself, which only ever returns a suggestion to accept or edit. */
  tags: string[];
  /** Meta title/description for the storefront product page's <title>/<meta description>,
   *  often from an AI SEO-metadata suggestion; same "suggest, never silently overwrite" rule. */
  seoTitle?: string;
  seoDescription?: string;
  /** A merchant-facing summary of this product's reviews (Phase 4, Module 6). Cached rather
   *  than recomputed on every read; `reviewCountAtGeneration` is compared against the live
   *  count to tell the admin UI when it has gone stale enough to offer regenerating. */
  reviewSummary?: {
    text: string;
    model: string;
    generatedAt: Date;
    reviewCountAtGeneration: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductDocument>(
  {
    storeId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 5000 },
    aiDescriptionId: { type: Schema.Types.ObjectId, ref: "AiGeneratedContent" },
    price: { type: Schema.Types.Decimal128, required: true },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 10,
        message: "A product may have at most 10 images.",
      },
    },
    sku: { type: String, trim: true, maxlength: 100 },
    barcode: { type: String, trim: true, maxlength: 100 },
    taxable: { type: Boolean, default: true },
    costPrice: { type: Schema.Types.Decimal128 },
    category: { type: String, required: true, index: true },
    tags: {
      type: [String],
      default: [],
      validate: { validator: (arr: string[]) => arr.length <= 10, message: "A product may have at most 10 tags." },
    },
    seoTitle: { type: String, trim: true, maxlength: 70 },
    seoDescription: { type: String, trim: true, maxlength: 160 },
    reviewSummary: {
      type: new Schema(
        {
          text: { type: String, required: true, maxlength: 2000 },
          model: { type: String, required: true },
          generatedAt: { type: Date, required: true },
          reviewCountAtGeneration: { type: Number, required: true },
        },
        { _id: false }
      ),
      required: false,
    },
  },
  { timestamps: true }
);

// Search (Implementation_Plan.md Phase 3, Module 1 remaining: Search & Reviews). A title match
// outranks a category match, which outranks a word buried in the description. Changing the
// weights of an existing text index needs `npm run sync-indexes` once (see scripts/sync-indexes.ts).
productSchema.index({ title: "text", category: "text", description: "text" }, { weights: { title: 10, category: 3, description: 1 }, name: "product_search" });

// Browsing/filtering by category within a store; storeId alone covers plain catalog listing
productSchema.index({ storeId: 1, category: 1 });
productSchema.index({ storeId: 1 });

// SKU and barcode are unique per store when present (partial index ignores products without one).
productSchema.index(
  { storeId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string" } } }
);
productSchema.index(
  { storeId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: "string" } } }
);

productSchema.plugin(tenantScopePlugin);

export const Product = model<ProductDocument>("Product", productSchema);
