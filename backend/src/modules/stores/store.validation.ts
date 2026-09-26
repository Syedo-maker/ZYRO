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

// A host name such as shop.example.com: lowercase letters, digits and hyphens in dot-separated
// labels, at least two labels. No scheme, port, path or wildcard, so nothing but a plain host can
// be stored (and later used to route requests).
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const updateDomainSchema = z.object({
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HOSTNAME, "Enter a domain such as shop.example.com (no https://, port or path)")
    .nullable(),
});
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;
