import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";
import { computePrices, DISCOUNT_TYPES, type Discount, type DiscountType } from "../lib/prices";

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
  /**
   * Three prices (the supervisor's product-listing change). The owner sets the actual price (the MRP)
   * and, optionally, a discount: an amount off or a percentage off (`discountType`, `discountValue`,
   * 2026-10-23). The sale price is what the customer pays, MRP minus the discount, computed by the
   * server (lib/prices.ts) and stored, so the three can never disagree and cart, checkout and orders
   * read only it (see priceOf below). No discount: neither discount field is set.
   */
  actualPrice?: Types.Decimal128;
  discountType?: DiscountType;
  discountValue?: Types.Decimal128;
  salePrice?: Types.Decimal128;
  /**
   * Older shapes, read only as a fallback until scripts/migrate-product-fields.ts has converted a
   * product, and never written any more: the single price from before the three prices, and the
   * discounted price (what customers paid) from before the discount modes.
   */
  price?: Types.Decimal128;
  discountPrice?: Types.Decimal128;
  images: string[]; // object-storage URLs only, never binary data (Implementation_Plan.md Phase 1)
  // Stock is NOT stored here. On-hand quantity lives in Postgres (InventoryLevel) so that
  // deducting it is atomic with order creation for both the online store and the POS.
  sku?: string;
  taxable: boolean;
  costPrice?: Types.Decimal128; // enables margin analytics; never exposed to shoppers
  /** The store's own category (Category.model.ts). The source of truth for which category this is. */
  categoryId?: Types.ObjectId;
  /**
   * A copy of the category's name, written only by the server (on create, on edit, and when the
   * category is renamed). Search, the storefront menu, the shop directory, Trend Scout and the AI
   * prompts read a name, and a text index cannot reach into another collection, so the name is kept
   * here as well. Products listed before categories existed have only this, until
   * scripts/migrate-categories.ts links them.
   */
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
  /** Written by the Python recommendation service (Phase 6), never by Node. Excluded from every
   *  query by default (select: false): a 384-number vector has no business in an API response. */
  embedding?: number[];
  /** Fingerprint of the text and model `embedding` was computed from; see recommendation-service/app/text.py. */
  embeddingHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductDocument>(
  {
    storeId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 5000 },
    aiDescriptionId: { type: Schema.Types.ObjectId, ref: "AiGeneratedContent" },
    actualPrice: { type: Schema.Types.Decimal128 },
    discountType: { type: String, enum: DISCOUNT_TYPES },
    discountValue: { type: Schema.Types.Decimal128 },
    salePrice: { type: Schema.Types.Decimal128 },
    price: { type: Schema.Types.Decimal128 },
    discountPrice: { type: Schema.Types.Decimal128 },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 10,
        message: "A product may have at most 10 images.",
      },
    },
    sku: { type: String, trim: true, maxlength: 100 },
    taxable: { type: Boolean, default: true },
    costPrice: { type: Schema.Types.Decimal128 },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
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
    // default: undefined so a new product does not store an empty [] that would look "embedded".
    embedding: { type: [Number], select: false, default: undefined },
    embeddingHash: { type: String, select: false },
  },
  { timestamps: true }
);

// Search (Implementation_Plan.md Phase 3, Module 1 remaining: Search & Reviews). A title match
// outranks a category match, which outranks a word buried in the description. Changing the
// weights of an existing text index needs `npm run sync-indexes` once (see scripts/sync-indexes.ts).
productSchema.index({ title: "text", category: "text", description: "text" }, { weights: { title: 10, category: 3, description: 1 }, name: "product_search" });

// Browsing/filtering by category within a store; storeId alone covers plain catalog listing
productSchema.index({ storeId: 1, category: 1 });
// Counting a category's products (the Categories page, and refusing to delete one still in use).
productSchema.index({ storeId: 1, categoryId: 1 });
productSchema.index({ storeId: 1 });

// A SKU is unique per store when present (partial index ignores products without one). The register
// finds a product by its SKU.
productSchema.index(
  { storeId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string" } } }
);

// Sorting and filtering a store's catalogue by what customers pay.
productSchema.index({ storeId: 1, salePrice: 1 });

productSchema.plugin(tenantScopePlugin);

/** The fields a price is read from, in any of the shapes a product may be stored in. */
export type PriceFields = Pick<ProductDocument, "actualPrice" | "discountType" | "discountValue" | "salePrice" | "price" | "discountPrice">;

/** The discount a product has, from whichever shape it is stored in; null for none. */
export function discountOf(doc: PriceFields): Discount | null {
  const num = (d?: Types.Decimal128) => (d === undefined || d === null ? undefined : Number(d.toString()));
  if (doc.discountType && doc.discountValue !== undefined && doc.discountValue !== null) return { type: doc.discountType, value: num(doc.discountValue)! };
  // Before the discount modes: the discounted price itself, read as an amount off the MRP.
  const discounted = num(doc.discountPrice);
  const actual = num(doc.actualPrice) ?? num(doc.price);
  if (discounted !== undefined && actual !== undefined && discounted < actual) return { type: "amount", value: Math.round((actual - discounted) * 100) / 100 };
  return null;
}

/**
 * A product's prices as numbers, from whichever shape it is stored in. Every reader of a price goes
 * through this, so a product not yet converted by the migration (only `price`, or the older
 * `discountPrice`) still sells at its price instead of failing, and the rest of the code has one
 * place to look. The stored sale price is what customers pay; the rest is worked out the same way the
 * server worked it out when the product was saved.
 */
export function priceOf(doc: PriceFields) {
  const num = (d?: Types.Decimal128) => (d === undefined || d === null ? undefined : Number(d.toString()));
  const computed = computePrices(num(doc.actualPrice) ?? num(doc.price) ?? 0, discountOf(doc));
  const sale = num(doc.salePrice) ?? computed.sale;
  const off = Math.max(0, Math.round((computed.actual - sale) * 100)) / 100;
  const percent = off > 0 && computed.actual > 0 ? Math.round((off / computed.actual) * 100) : 0;
  return {
    actual: computed.actual,
    /** The discount as the owner set it (an amount or a percentage), or null. */
    discount: off > 0 ? computed.discount : null,
    /** The amount off the MRP, in money; 0 for none. */
    discountAmount: off,
    sale,
    /** Whole percent off, whatever the mode; null when there is none to show (no discount, or under 0.5%). */
    percentOff: percent > 0 ? percent : null,
  };
}

export const Product = model<ProductDocument>("Product", productSchema);
