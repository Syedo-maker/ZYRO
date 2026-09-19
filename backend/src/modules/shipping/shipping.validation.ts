import { z } from "zod";

// Mirrors ShippingZoneInput in backend/openapi.yaml.
export const shippingZoneSchema = z.object({
  name: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  rateAmount: z.number().min(0).max(100000),
});
export type ShippingZoneInput = z.infer<typeof shippingZoneSchema>;
