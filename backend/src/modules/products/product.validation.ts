import { z } from "zod";
import { DISCOUNT_TYPES, priceProblem, type Discount } from "../../lib/prices";

// Mirrors ProductInput in backend/openapi.yaml.
export const productInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  /**
   * Prices (the supervisor's product-listing change). The owner sets the actual price (the MRP) and,
   * optionally, a discount: an amount off or a percentage off. The selling price the customer pays is
   * computed from them (lib/prices.ts), never sent.
   */
  actualPrice: z.number().positive("The price must be more than zero").max(10_000_000).optional(),
  /** "amount" (money off) or "percent"; null or absent with the value: no discount. */
  discountType: z.enum(DISCOUNT_TYPES).nullable().optional(),
  /** The amount or the percentage; 0 means no discount. */
  discountValue: z.number().min(0, "The discount cannot be below zero").max(10_000_000).nullable().optional(),
  /** Before the discount modes: the discounted price itself, read as an amount off. Kept for older callers. */
  discountPrice: z.number().positive("A discounted price must be more than zero").max(10_000_000).nullable().optional(),
  /** The single price of the API before the three; read as the actual price. Kept for older callers. */
  price: z.number().positive("The price must be more than zero").max(10_000_000).optional(),
  /** Target on-hand quantity at the store's default location; stored in inventory, not on the product. */
  stock: z.number().int().min(0),
  sku: z.string().trim().min(1).max(100).optional(),
  taxable: z.boolean().optional().default(true),
  costPrice: z.number().min(0).optional(),
  /** The store's category (the product form always sends this). */
  categoryId: z.string().trim().min(1).optional(),
  /**
   * A category by name, for API callers written before categories existed (voice notes among them).
   * It is matched to the store's category with the same normalized name, which is created if the
   * store has none; the product still ends up referencing that category by id.
   */
  category: z.string().trim().min(1).max(60).optional(),
  images: z.array(z.string().url()).max(10).optional().default([]),
  /** Often filled from an AI auto-tag suggestion (Phase 4, Module 6), but only once the
   *  merchant saves the form; the suggestion endpoint itself never writes to the product. */
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional().default([]),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(160).optional(),
}).refine((v) => v.actualPrice !== undefined || v.price !== undefined, {
  message: "The price is required",
  path: ["actualPrice"],
}).refine((v) => v.discountPrice === undefined || v.discountPrice === null || v.discountPrice <= (v.actualPrice ?? v.price ?? 0), {
  message: "The discounted price cannot be more than the actual price",
  path: ["discountPrice"],
}).refine((v) => (v.discountType ?? null) === null || (v.discountValue ?? null) !== null, {
  message: "Give the discount as well as whether it is an amount or a percentage",
  path: ["discountValue"],
}).refine((v) => (v.discountValue ?? 0) === 0 || (v.discountType ?? null) !== null, {
  message: "Say whether the discount is an amount or a percentage",
  path: ["discountType"],
}).refine((v) => (v.discountType ?? null) === null || v.discountPrice === undefined || v.discountPrice === null, {
  message: "Send the discount either as a type and value or as a discounted price, not both",
  path: ["discountPrice"],
}).superRefine((v, ctx) => {
  const problem = priceProblem(v.actualPrice ?? v.price ?? 0, discountFromInput(v));
  if (problem) ctx.addIssue({ code: "custom", message: problem, path: [problem.includes("MRP) must") ? "actualPrice" : "discountValue"] });
}).refine((v) => v.categoryId !== undefined || v.category !== undefined, {
  message: "Choose a category",
  path: ["categoryId"],
});
export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * The discount a request asks for: its type and value, or an older caller's discounted price read as
 * an amount off the MRP. Null for none (absent, or zero).
 */
export function discountFromInput(v: Pick<ProductInput, "actualPrice" | "price" | "discountType" | "discountValue" | "discountPrice">): Discount | null {
  if (v.discountType && v.discountValue !== undefined && v.discountValue !== null) return v.discountValue > 0 ? { type: v.discountType, value: v.discountValue } : null;
  const mrp = v.actualPrice ?? v.price;
  if (v.discountPrice !== undefined && v.discountPrice !== null && mrp !== undefined) {
    const off = Math.round((mrp - v.discountPrice) * 100) / 100;
    return off > 0 ? { type: "amount", value: off } : null;
  }
  return null;
}

/** An empty box in a search form arrives as "": treat it as not given rather than as an error. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** The quick stock control on the products list: only the on-hand count. */
export const stockUpdateSchema = z.object({
  stock: z.number().int("Stock is a whole number").min(0, "Stock cannot be below zero").max(1_000_000),
});
export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;

export const PRODUCT_SORTS = ["relevance", "newest", "price_asc", "price_desc", "title"] as const;

export const listProductsQuerySchema = z
  .object({
    q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
    category: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
    minPrice: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(10_000_000).optional()),
    maxPrice: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(10_000_000).optional()),
    /** Only products with stock on hand. */
    inStock: z.preprocess(blankToUndefined, z.enum(["true", "false"]).optional()).transform((v) => v === "true"),
    /**
     * Take the search words literally (Part F): no spelling correction, no Roman Urdu alternatives
     * and no search by meaning. Behind the "search for what I typed instead" link.
     */
    exact: z.preprocess(blankToUndefined, z.enum(["true", "false", "1", "0"]).optional()).transform((v) => v === "true" || v === "1"),
    /** `relevance` ranks search matches best first; without a search it means newest. */
    sort: z.preprocess(blankToUndefined, z.enum(PRODUCT_SORTS).optional()),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
  })
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
    message: "minPrice cannot be more than maxPrice",
  });
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(60),
});
