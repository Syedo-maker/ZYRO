/**
 * Makes the MongoDB indexes match the schemas in src/models. Mongoose creates missing indexes
 * on its own, but it cannot change an index that already exists under the same keys (for
 * example the product text index, whose weights and fields changed in Phase 3), so run this
 * once after deploying a change to an index. It drops indexes the schemas no longer declare,
 * so it is only for the collections listed below.
 * Usage: npm run sync-indexes
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { Product } from "../src/models/Product.model";
import { ProductReview } from "../src/models/ProductReview.model";

async function main() {
  await connectMongo();
  for (const model of [Product, ProductReview]) {
    const dropped = await model.syncIndexes();
    console.log(`${model.collection.name}: indexes in sync${dropped.length ? ` (dropped ${dropped.join(", ")})` : ""}`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
