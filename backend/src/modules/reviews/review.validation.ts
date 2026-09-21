import { z } from "zod";

// Mirrors the review request shapes in backend/openapi.yaml.

/** Control characters are removed (newlines kept) and the text trimmed; it is stored as plain text and shown escaped. */
const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));

const rating = z.number().int().min(1).max(5);

export const createReviewSchema = z.object({
  rating,
  title: cleanText(100).optional(),
  comment: cleanText(2000).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = z
  .object({
    rating: rating.optional(),
    title: cleanText(100).optional(),
    comment: cleanText(2000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Send at least one field to change" });
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

export const listReviewsQuerySchema = z.object({
  sort: z.enum(["newest", "oldest", "highest", "lowest"]).optional().default("newest"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const merchantListQuerySchema = z.object({
  status: z.enum(["published", "hidden"]).optional(),
  productId: z.string().min(1).max(64).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type MerchantListQuery = z.infer<typeof merchantListQuerySchema>;

export const moderateReviewSchema = z
  .object({
    status: z.enum(["published", "hidden"]).optional(),
    /** A public reply from the store; null removes it. */
    reply: cleanText(1000).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.reply !== undefined, { message: "Send a status, a reply, or both" });
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
