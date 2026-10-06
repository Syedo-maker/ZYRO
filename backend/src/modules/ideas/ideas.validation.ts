import { z } from "zod";

/**
 * Whatever the merchant has typed into the add-product form so far. Every field is optional on
 * purpose: the point of the feature is to help somebody who does not know what to write, and that
 * includes somebody who has only chosen a category. An empty body is a valid request.
 *
 * The limits are generous but present: this text goes into a prompt, so a merchant pasting a novel
 * into the notes field should be refused by the validator rather than paid for by the token count.
 */
export const productIdeaSchema = z.object({
  title: z.string().trim().max(200).optional(),
  category: z.string().trim().max(120).optional(),
  /** Notes, not a finished description: anything the merchant wants the AI to know. */
  description: z.string().trim().max(1500).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  price: z.number().nonnegative().max(100_000_000).optional(),
});

export type ProductIdeaInput = z.infer<typeof productIdeaSchema>;

export const keywordQuerySchema = z.object({
  category: z.string().trim().max(120).optional(),
});
