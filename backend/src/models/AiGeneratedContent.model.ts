import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * Kept as its own collection rather than embedded in Product, even though the
 * relationship is 1:1 and usually co-accessed (which would normally argue for
 * embedding). Two reasons override that here:
 *   1. Module ownership split (Implementation_Plan.md Section 2 / scope doc Section 12) —
 *      catalog CRUD (Module 4) and AI content tools (Module 6) are built independently
 *      by different students against the same Product _id, without one module's writes
 *      touching the other's collection.
 *   2. The AI orchestrator (Phase 4) only ever reads/writes this narrow collection,
 *      never the full Product document, which keeps its write path small and avoids
 *      contention with catalog edits.
 *
 * `history` is a small bounded array (capped at 5) for cheap "compare with previous
 * generation" / undo — this is NOT the compliance-grade document-versioning pattern
 * (full snapshot audit trail); it's a UX convenience, so a short capped embed is enough.
 */
export type AiContentStatus = "draft" | "published";

interface AiContentHistoryEntry {
  content: string;
  generatedAt: Date;
}

export interface AiGeneratedContentDocument {
  storeId: Types.ObjectId;
  productId: Types.ObjectId;
  status: AiContentStatus;
  content: string;
  model: string; // e.g. "gpt-4o-mini" or "claude-haiku-4-5" — which provider adapter produced this
  promptVersion: string;
  editedByMerchant: boolean;
  history: AiContentHistoryEntry[];
  generatedAt: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const aiContentHistorySchema = new Schema<AiContentHistoryEntry>(
  {
    content: { type: String, required: true },
    generatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const aiGeneratedContentSchema = new Schema<AiGeneratedContentDocument>(
  {
    storeId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, required: true, ref: "Product", unique: true },
    status: { type: String, enum: ["draft", "published"], default: "draft", required: true },
    content: { type: String, required: true, maxlength: 5000 },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    editedByMerchant: { type: Boolean, default: false },
    history: {
      type: [aiContentHistorySchema],
      default: [],
      validate: {
        validator: (arr: AiContentHistoryEntry[]) => arr.length <= 5,
        message: "Only the last 5 generations are retained.",
      },
    },
    generatedAt: { type: Date, required: true },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

aiGeneratedContentSchema.index({ storeId: 1 });

aiGeneratedContentSchema.plugin(tenantScopePlugin);

export const AiGeneratedContent = model<AiGeneratedContentDocument>(
  "AiGeneratedContent",
  aiGeneratedContentSchema
);
