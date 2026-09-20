import { z } from "zod";

// Mirrors the analytics query in backend/openapi.yaml.
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;

export const summaryQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Minutes east of UTC (Pakistan is 300). Decides where one day ends and the next begins in the daily series. */
    tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional().default(0),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), { message: "Send both 'from' and 'to', or neither for the last 30 days" })
  .refine((v) => !v.from || !v.to || v.to > v.from, { message: "'to' must be after 'from'" })
  .refine((v) => !v.from || !v.to || v.to.getTime() - v.from.getTime() <= MAX_RANGE_DAYS * DAY_MS, {
    message: `A report can cover at most ${MAX_RANGE_DAYS} days`,
  });
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
