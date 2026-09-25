import { z } from "zod";

export const updateDraftSchema = z.object({ content: z.string().trim().min(1).max(5000) });
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

export const MARKETING_CHANNELS = ["social_post", "email", "ad_headlines"] as const;
export const MARKETING_TONES = ["friendly", "professional", "playful", "luxury"] as const;

export const marketingCopySchema = z.object({
  channel: z.enum(MARKETING_CHANNELS),
  tone: z.enum(MARKETING_TONES).optional().default("friendly"),
  /** Offer details the merchant wants mentioned ("20% off this weekend"). The only place a promotion may come from. */
  notes: z.string().trim().max(200).optional(),
});
export type MarketingCopyInput = z.infer<typeof marketingCopySchema>;
