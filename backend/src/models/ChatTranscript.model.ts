import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * AI shopping assistant conversation log — for later review/debugging only
 * (Implementation_Plan.md Phase 5, Module 3), not the live chat state. Live/short-term
 * conversation context during an active chat lives in Redis (Implementation_Plan.md
 * Phase 5); this collection is the durable-but-temporary record written after each turn.
 *
 * Messages are embedded (1:few, always accessed together as a transcript) but capped —
 * per fundamental-document-size guidance, an unbounded embedded array risks the 16MB
 * document limit and degrades read performance long before that. A capped array plus a
 * TTL index keeps this collection small without needing a separate messages collection.
 */
export type ChatRole = "customer" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
  createdAt: Date;
}

export interface ChatTranscriptDocument {
  storeId: Types.ObjectId;
  customerId?: Types.ObjectId; // absent for guest sessions
  guestSessionId?: string;
  conversationId: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date; // TTL — transcripts are debugging aids, not permanent records
}

const chatMessageSchema = new Schema<ChatMessage>(
  {
    role: { type: String, enum: ["customer", "assistant"], required: true },
    content: { type: String, required: true, maxlength: 4000 },
    createdAt: { type: Date, required: true },
  },
  { _id: false }
);

const chatTranscriptSchema = new Schema<ChatTranscriptDocument>(
  {
    storeId: { type: Schema.Types.ObjectId, required: true },
    customerId: { type: Schema.Types.ObjectId },
    guestSessionId: { type: String },
    conversationId: { type: String, required: true },
    messages: {
      type: [chatMessageSchema],
      default: [],
      validate: {
        validator: (arr: ChatMessage[]) => arr.length <= 200,
        message: "A single transcript may hold at most 200 messages.",
      },
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

chatTranscriptSchema.index({ storeId: 1, conversationId: 1 }, { unique: true });
chatTranscriptSchema.index({ storeId: 1, customerId: 1 });

// TTL index — MongoDB deletes the document once expiresAt has passed
chatTranscriptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

chatTranscriptSchema.plugin(tenantScopePlugin);

export const ChatTranscript = model<ChatTranscriptDocument>("ChatTranscript", chatTranscriptSchema);
