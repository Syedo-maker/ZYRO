import { z } from "zod";
import type { StaffPermission } from "@prisma/client";

// Lowercase on the wire, as in backend/openapi.yaml; uppercase enum names in the database.
export const STAFF_PERMISSIONS_API = [
  "products_write",
  "orders_write",
  "discounts_write",
  "analytics_read",
  "pos_sell",
  "inventory_write",
  "refunds",
] as const;

export const createStaffSchema = z.object({
  email: z.string().email(),
  permissions: z
    .array(z.enum(STAFF_PERMISSIONS_API).transform((p) => p.toUpperCase() as StaffPermission))
    .min(1),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
