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

export const listProductsQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
