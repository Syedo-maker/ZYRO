import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * Separate collection, not embedded in Product: a popular product can accumulate
 * hundreds or thousands of reviews (unbounded 1:many, Post -> Comments pattern), and
 * reviews are paginated/queried independently of the product document itself.
 *
 * storeId is duplicated here (not just reachable via productId) so the tenantScope
 * plugin can enforce isolation directly on this collection without an extra lookup.
 *
 * Average rating is intentionally NOT denormalized onto Product; Implementation_Plan.md
 * Phase 3 computes it on read via aggregation to avoid a sync-bug surface. (That is also why
 * the catalog cannot be sorted or filtered by rating: that would need a stored average.)
 */
export type ReviewStatus = "published" | "hidden";

export interface ProductReviewDocument {
  // storeId/customerId are Postgres cuid strings (Tenant.id / User.id), not Mongo
  // ObjectIds; fixed during Phase 1 Module 4, same issue as Product.model.ts.
  storeId: string;
  productId: Types.ObjectId; // Product._id: a genuine Mongo document, ObjectId is correct here
  customerId: string;
  /**
   * The reviewer's name as shoppers see it ("Sam O."), copied onto the review when it is
   * written (the extended-reference pattern): listing reviews never has to look users up,
   * and the reviewer's email is never exposed.
   */
  authorName: string;
  rating: number;
  title?: string;
  comment?: string;
  /** The reviewer had a paid order containing this product in this store when they wrote it. */
  verifiedPurchase: boolean;
  /** Hidden reviews are kept (the reviewer still cannot post a second one) but not shown or counted. */
  status: ReviewStatus;
  merchantReply?: string;
  merchantRepliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const productReviewSchema = new Schema<ProductReviewDocument>(
  {
    storeId: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, required: true, ref: "Product" },
    customerId: { type: String, required: true },
    authorName: { type: String, required: true, maxlength: 80 },
    rating: { type: Number, required: true, min: 1, max: 5, validate: { validator: Number.isInteger, message: "Rating must be a whole number" } },
    title: { type: String, maxlength: 100 },
    comment: { type: String, maxlength: 2000 },
    verifiedPurchase: { type: Boolean, default: false },
    status: { type: String, enum: ["published", "hidden"], default: "published" },
    merchantReply: { type: String, maxlength: 1000 },
    merchantRepliedAt: { type: Date },
  },
  { timestamps: true }
);

// Product page: a product's published reviews, newest first (also serves the rating summary)
productReviewSchema.index({ storeId: 1, productId: 1, status: 1, createdAt: -1 });

// One review per customer per product
productReviewSchema.index({ productId: 1, customerId: 1 }, { unique: true });

// The merchant's moderation list: everything in the store by status, newest first
productReviewSchema.index({ storeId: 1, status: 1, createdAt: -1 });

productReviewSchema.plugin(tenantScopePlugin);

export const ProductReview = model<ProductReviewDocument>("ProductReview", productReviewSchema);