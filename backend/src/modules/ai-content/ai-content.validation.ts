import { z } from "zod";

export const updateDraftSchema = z.object({ content: z.string().trim().min(1).max(5000) });
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
