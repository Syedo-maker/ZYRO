import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * Separate collection, not embedded in Product — a popular product can accumulate
 * hundreds or thousands of reviews (unbounded 1:many, Post -> Comments pattern), and
 * reviews are paginated/queried independently of the product document itself.
 *
 * storeId is duplicated here (not just reachable via productId) so the tenantScope
 * plugin can enforce isolation directly on this collection without an extra lookup.
 *
 * Average rating is intentionally NOT denormalized onto Product — Implementation_Plan.md
 * Phase 3 computes it on read via aggregation to avoid a sync-bug surface.
 */
export interface ProductReviewDocument {
  storeId: Types.ObjectId;
  productId: Types.ObjectId;
  customerId: Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const productReviewSchema = new Schema<ProductReviewDocument>(
  {
    storeId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, required: true, ref: "Product" },
    customerId: { type: Schema.Types.ObjectId, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 2000 },
  },
  { timestamps: true }
);

// Product page: fetch a product's reviews, newest first
productReviewSchema.index({ storeId: 1, productId: 1, createdAt: -1 });

// One review per customer per product
productReviewSchema.index({ productId: 1, customerId: 1 }, { unique: true });

productReviewSchema.plugin(tenantScopePlugin);

export const ProductReview = model<ProductReviewDocument>("ProductReview", productReviewSchema);
