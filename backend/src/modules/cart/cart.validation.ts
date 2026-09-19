import { z } from "zod";

// Mirrors the cart request bodies in backend/openapi.yaml.
export const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
});

export const updateItemSchema = z.object({
  quantity: z.number().int().min(1).max(999),
});
