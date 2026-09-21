import { z } from "zod";

// Mirrors ProductInput in backend/openapi.yaml.
export const productInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  price: z.number().min(0),
  /** Target on-hand quantity at the store's default location; stored in inventory, not on the product. */
  stock: z.number().int().min(0),
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().trim().min(1).max(100).optional(),
  taxable: z.boolean().optional().default(true),
  costPrice: z.number().min(0).optional(),
  category: z.string().min(1),
  images: z.array(z.string().url()).max(10).optional().default([]),
});
export type ProductInput = z.infer<typeof productInputSchema>;

/** An empty box in a search form arrives as "": treat it as not given rather than as an error. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const PRODUCT_SORTS = ["relevance", "newest", "price_asc", "price_desc", "title"] as const;

export const listProductsQuerySchema = z
  .object({
    q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
    category: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
    minPrice: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(10_000_000).optional()),
    maxPrice: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(10_000_000).optional()),
    /** Only products with stock on hand. */
    inStock: z.preprocess(blankToUndefined, z.enum(["true", "false"]).optional()).transform((v) => v === "true"),
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
