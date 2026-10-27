import { z } from "zod";

// Mirrors the category request shapes in backend/openapi.yaml.
const categoryName = z
  .string()
  .trim()
  .min(1, "A category needs a name")
  .max(60, "A category name is at most 60 characters");

export const createCategorySchema = z.object({ name: categoryName });
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Rename, enable or disable: either or both, but something. */
export const updateCategorySchema = z
  .object({
    name: categoryName.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, { message: "Send a new name, active, or both" });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
