import { z } from "zod";
import type { DiscountType } from "@prisma/client";
import { normalizeCode } from "./discount.rules";

// Mirrors the discount request shapes in backend/openapi.yaml (lowercase on the wire).
const money = z.number().finite().min(0).max(1_000_000);

export const createDiscountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,30}$/, "A code is 3 to 30 letters, digits, hyphens or underscores")
      .transform(normalizeCode),
    type: z.enum(["percentage", "fixed"]).transform((v) => v.toUpperCase() as DiscountType),
    value: z.number().finite().positive().max(1_000_000),
    minSubtotal: money.optional(),
    expiresAt: z.coerce.date().optional(),
    usageLimit: z.number().int().min(1).max(10_000_000).optional(),
    active: z.boolean().optional().default(true),
  })
  .refine((v) => v.type !== "PERCENTAGE" || v.value <= 100, { message: "A percentage discount cannot be more than 100", path: ["value"] })
  .refine((v) => !v.expiresAt || v.expiresAt.getTime() > Date.now(), { message: "The expiry date must be in the future", path: ["expiresAt"] });
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;

/** Only the settings that are safe to change after a code exists; the code, type and value are fixed. */
export const updateDiscountSchema = z
  .object({
    active: z.boolean().optional(),
    /** null removes the limit. */
    usageLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
    /** null removes the expiry. */
    expiresAt: z.coerce.date().nullable().optional(),
    minSubtotal: money.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Send at least one field to change" });
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;

export const validateDiscountSchema = z.object({
  code: z.string().trim().min(1).max(30),
  cartTotal: money,
});

/** A discount code typed by a shopper or cashier; checked against the store by the service. */
export const discountCodeField = z.string().trim().min(1).max(30);
