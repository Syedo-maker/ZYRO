import { z } from "zod";

// Mirrors the checkout request bodies in backend/openapi.yaml.
export const quoteSchema = z.object({
  shippingZoneId: z.string().min(1).optional(),
});
export type QuoteInput = z.infer<typeof quoteSchema> & { discountCode?: string };

export const createSessionSchema = quoteSchema.extend({
  discountCode: z.string().min(1).max(30).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
