import { z } from "zod";

/** Mirrors the Part E request bodies in backend/openapi.yaml. */

const address = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(32).optional().nullable(),
  country: z.string().trim().min(2).max(2).toUpperCase(),
});

export const placeLocalOrderSchema = z.object({
  method: z.enum(["cod", "bank_transfer"]),
  name: z.string().trim().min(1).max(120),
  /** Needed for a courier to call ahead; the trust rules only check it looks like a number. */
  phone: z.string().trim().min(5).max(32),
  email: z.string().email().max(254).optional().nullable(),
  address,
  shippingZoneId: z.string().min(1).optional(),
  discountCode: z.string().trim().min(1).max(64).optional(),
});
export type PlaceLocalOrderInput = z.infer<typeof placeLocalOrderSchema>;

export const PAYMENT_SETTINGS_BANDS = ["none", "low", "medium", "high"] as const;

export const updatePaymentSettingsSchema = z
  .object({
    codEnabled: z.boolean().optional(),
    codMinAmount: z.number().min(0).max(10_000_000).nullable().optional(),
    codMaxAmount: z.number().min(0).max(10_000_000).nullable().optional(),
    codBlockBand: z.enum(PAYMENT_SETTINGS_BANDS).optional(),
    codAdvancePercent: z.number().int().min(0).max(90).optional(),
    bankTransferEnabled: z.boolean().optional(),
    bankAccountName: z.string().trim().max(120).nullable().optional(),
    bankAccountNumber: z.string().trim().max(64).nullable().optional(),
    bankName: z.string().trim().max(120).nullable().optional(),
    bankInstructions: z.string().trim().max(1000).nullable().optional(),
    gatewayProvider: z.string().trim().max(40).nullable().optional(),
    gatewayEnabled: z.boolean().optional(),
  })
  .refine((v) => v.codMinAmount == null || v.codMaxAmount == null || v.codMinAmount <= v.codMaxAmount, {
    message: "The smallest cash-on-delivery order cannot be more than the largest",
  });
export type UpdatePaymentSettingsInput = z.infer<typeof updatePaymentSettingsSchema>;

export const submitProofSchema = z.object({
  imageUrl: z.string().url().max(500),
  declaredAmount: z.number().positive().max(10_000_000),
  declaredReference: z.string().trim().min(1).max(64).optional().nullable(),
});
export type SubmitProofInput = z.infer<typeof submitProofSchema>;

export const reviewProofSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().trim().max(500).optional(),
});
export type ReviewProofInput = z.infer<typeof reviewProofSchema>;

export const codOutcomeSchema = z.object({
  outcome: z.enum(["collected", "refused"]),
  /** Cash collected; must equal the order total. Only sent with "collected". */
  amount: z.number().positive().max(10_000_000).optional(),
});
export type CodOutcomeInput = z.infer<typeof codOutcomeSchema>;

export const importRemittanceSchema = z.object({
  courier: z.string().trim().min(1).max(60),
  csv: z.string().min(1).max(2_000_000),
  fileName: z.string().trim().max(200).optional(),
});
export type ImportRemittanceInput = z.infer<typeof importRemittanceSchema>;

export const paymentHelpSchema = z.object({
  /** One of KNOWN_FAILURE_CODES, or anything the gateway sent that we do not know. */
  code: z.string().trim().max(60).optional(),
  /** What the bank or gateway actually said, shown to the AI only when the code is unknown. */
  providerMessage: z.string().trim().max(300).optional(),
  language: z.enum(["en", "ur", "roman"]).optional().default("en"),
});
export type PaymentHelpInput = z.infer<typeof paymentHelpSchema>;
