import { z } from "zod";
import { MAX_PASSWORD_BYTES } from "../../lib/password";

// Mirrors the request bodies defined in backend/openapi.yaml under auth_register/auth_login.
export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(8)
    .refine((p) => Buffer.byteLength(p, "utf8") <= MAX_PASSWORD_BYTES, {
      message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} characters)`,
    }),
  storeName: z.string().min(1).max(120),
  storeSlug: z
    .string()
    .regex(/^[a-z0-9-]{3,50}$/, "Slug must be 3-50 lowercase letters, digits, or hyphens"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * A shopper's account: an ordinary user with no store. It works at every store on the platform;
 * a store's own customer record is created the first time they buy there.
 */
export const registerCustomerSchema = z.object({
  email: z.string().email().max(254),
  password: registerSchema.shape.password,
  name: z.string().trim().min(1).max(120).optional(),
});
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(1000),
});
export type LoginInput = z.infer<typeof loginSchema>;
