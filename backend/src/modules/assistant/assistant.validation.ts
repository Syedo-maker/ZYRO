import { z } from "zod";

// Matches the request body already drafted for this endpoint in backend/openapi.yaml (Phase 0):
// the caller mints and keeps its own conversationId, the same way a guest cart session id works.
export const chatSchema = z.object({
  conversationId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1000),
});
export type ChatInput = z.infer<typeof chatSchema>;
