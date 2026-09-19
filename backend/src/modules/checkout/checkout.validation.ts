import { z } from "zod";

// Mirrors the checkout_session_create request body in backend/openapi.yaml.
export const createSessionSchema = z.object({
  discountCode: z.string().min(1).max(30).optional(),
  shippingZoneId: z.string().min(1).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
