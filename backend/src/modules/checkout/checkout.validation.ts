import { z } from "zod";
import { discountCodeField } from "../discounts/discount.validation";

// Mirrors the checkout request bodies in backend/openapi.yaml.
export const quoteSchema = z.object({
  shippingZoneId: z.string().min(1).optional(),
  /** One code per order; checked against the store, the cart and the code's own rules. */
  discountCode: discountCodeField.optional(),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const createSessionSchema = quoteSchema;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;