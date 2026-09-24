import { Schema, model } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * AI shopping assistant conversation log, for later review/debugging only
 * (Implementation_Plan.md Phase 5, Module 3), not the live chat state. Live/short-term
 * conversation context during an active chat lives in Redis (assistant.service.ts); this
 * collection is the durable-but-temporary record written after each turn - a debugging aid,
 * not a permanent record, per its own `expiresAt` TTL below.
 *
 * One document per conversation (`storeId` + `conversationId` unique), appended to on every
 * exchange. `messages` is capped at 200 entries (100 exchanges) by the caller's `$slice` on
 * every push (assistant.service.ts), not a schema validator: a validator would reject the
 * whole write past the cap and lose the new messages, where `$slice` just drops the oldest -
 * the same reasoning AiGeneratedContent.model.ts gives for its own 5-entry cap, scaled up here
 * since a chat message is far smaller than a full description.
 */
export type ChatRole = "user" | "assistant";

export interface ChatMessageEntry {
  role: ChatRole;
  content: string;
  createdAt: Date;
}

export interface ChatTranscriptDocument {
  // storeId/customerId are Postgres cuid strings (Tenant.id / User.id); fixed during
  // Phase 1 Module 4, see Product.model.ts.
  storeId: string;
  conversationId: string;
  /** Set when the shopper was signed in; absent for a guest conversation. */
  customerId?: string;
  /** Set for a guest conversation instead (the X-Guest-Session-Id the shopper's browser sent). */
  guestSessionId?: string;
  messages: ChatMessageEntry[];
  createdAt: Date;
  updatedAt: Date;
  /** TTL: refreshed to 90 days out on every message, so an active conversation never expires
   *  mid-use but a quiet one eventually does - transcripts are a debugging aid, not a permanent
   *  record of what a shopper said. */
  expiresAt: Date;
}

const chatMessageSchema = new Schema<ChatMessageEntry>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, required: true },
  },
  { _id: false }
);

const chatTranscriptSchema = new Schema<ChatTranscriptDocument>(
  {
    storeId: { type: String, required: true },
    conversationId: { type: String, required: true },
    customerId: { type: String },
    guestSessionId: { type: String },
    messages: { type: [chatMessageSchema], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

chatTranscriptSchema.index({ storeId: 1, conversationId: 1 }, { unique: true });
// TTL index: Mongo removes a document once its expiresAt is in the past.
chatTranscriptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

chatTranscriptSchema.plugin(tenantScopePlugin);

export const ChatTranscript = model<ChatTranscriptDocument>("ChatTranscript", chatTranscriptSchema);
