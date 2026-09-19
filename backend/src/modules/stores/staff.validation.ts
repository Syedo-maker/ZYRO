import { z } from "zod";
import type { StaffPermission } from "@prisma/client";
import { MAX_PASSWORD_BYTES } from "../../lib/password";

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
  email: z.string().email().max(254),
  /**
   * For a person with no ZYRO account yet (a new cashier): the owner sets a starting
   * password and name, and the account is created with the staff role. Rejected when the
   * email already has an account, since an owner must never be able to set someone else's password.
   */
  name: z.string().trim().min(1).max(120).optional(),
  password: z
    .string()
    .min(8)
    .refine((p) => Buffer.byteLength(p, "utf8") <= MAX_PASSWORD_BYTES, {
      message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} characters)`,
    })
    .optional(),
  permissions: z
    .array(z.enum(STAFF_PERMISSIONS_API).transform((p) => p.toUpperCase() as StaffPermission))
    .min(1),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
