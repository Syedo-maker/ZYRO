import { z } from "zod";

// Mirrors the request bodies defined in backend/openapi.yaml under auth_register/auth_login.
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  storeName: z.string().min(1).max(120),
  storeSlug: z
    .string()
    .regex(/^[a-z0-9-]{3,50}$/, "Slug must be 3-50 lowercase letters, digits, or hyphens"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginInput = z.infer<typeof loginSchema>;
