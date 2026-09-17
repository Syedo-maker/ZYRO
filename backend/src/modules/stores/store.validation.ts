import { z } from "zod";

// Mirrors store_branding_update's request body in backend/openapi.yaml.
export const updateBrandingSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  logoUrl: z.string().url().optional(),
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "themeColor must be a 6-digit hex color, e.g. #4F46E5")
    .optional(),
});
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
