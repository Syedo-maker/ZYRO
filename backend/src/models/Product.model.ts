import { Schema, model, Types } from "mongoose";
import { tenantScopePlugin } from "./plugins/tenantScope.plugin";

/**
 * Product catalog entry. Bounded fields (images, basic attributes) are embedded directly,
 * per the embed/reference framework: a product's own images/attributes are 1:1 or
 * 1:few and always accessed together with the product, so embedding avoids an extra
 * round trip. Reviews are NOT embedded here (see ProductReview.model.ts) because review
 * counts per product are unbounded and queried/paginated independently of the product
 * page (Implementation_Plan.md Phase 3).
 */
export interface ProductDocument {
  // Tenant.id from Postgres (a Prisma cuid string), NOT a Mongo ObjectId. Fixed during
  // Phase 1 Module 4: this field was originally typed as ObjectId, which would have
  // broken the moment a real cuid was stored in it.
  storeId: string;
  title: string;
  description: string;
  aiDescriptionId?: Types.ObjectId; // ref -> AiGeneratedContent, set once a draft/published description exists
  price: Types.Decimal128;
  images: string[]; // object-storage URLs only, never binary data (Implementation_Plan.md Phase 1)
  stock: number;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductDocument>(
  {
    storeId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 5000 },
    aiDescriptionId: { type: Schema.Types.ObjectId, ref: "AiGeneratedContent" },
    price: { type: Schema.Types.Decimal128, required: true },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 10,
        message: "A product may have at most 10 images.",
      },
    },
    stock: { type: Number, required: true, min: 0, default: 0 },
    category: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

// Search (Implementation_Plan.md Phase 3, Module 1 remaining: Search & Reviews)
productSchema.index({ title: "text", description: "text" });

// Browsing/filtering by category within a store; storeId alone covers plain catalog listing
productSchema.index({ storeId: 1, category: 1 });
productSchema.index({ storeId: 1 });

productSchema.plugin(tenantScopePlugin);

export const Product = model<ProductDocument>("Product", productSchema);
