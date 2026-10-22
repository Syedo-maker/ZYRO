/**
 * Moves products listed before the supervisor's product-listing change onto its fields.
 *
 * Prices: a product with only the single `price` gets it as its actual price and its sale price (no
 * discount, so customers keep paying what they paid), and `price` is removed. Until this runs the
 * code still reads `price` (see priceOf in Product.model.ts), so such a product shows and sells at its
 * price in between; but sorting and filtering by price use the stored sale price, so it sorts first
 * and falls outside a price filter until this has run.
 *
 * Only products still in the old shape are touched, so running it again changes nothing. It reports
 * first and changes nothing without --apply. A product priced at 0 is converted but listed, because
 * the product form now requires a price above zero and its owner should set one.
 *
 * Usage:  npx tsx scripts/migrate-product-fields.ts            (reports what it would do)
 *         npx tsx scripts/migrate-product-fields.ts --apply    (does it)
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { Product } from "../src/models/Product.model";

const apply = process.argv.includes("--apply");

async function main() {
  await connectMongo();

  const oldPrice = { price: { $exists: true }, actualPrice: { $exists: false } };
  const perStore = await Product.aggregate<{ _id: string; count: number; zero: string[] }>([
    { $match: oldPrice },
    {
      $group: {
        _id: "$storeId",
        count: { $sum: 1 },
        zero: { $push: { $cond: [{ $lte: ["$price", 0] }, "$title", "$$REMOVE"] } },
      },
    },
  ]);

  let products = 0;
  for (const s of perStore) {
    products += s.count;
    console.log(`store ${s._id}: ${s.count} product(s) with a single price` + (s.zero.length ? `; priced at 0: ${s.zero.map((t) => JSON.stringify(t)).join(", ")}` : ""));
    if (!apply) continue;
    // An update pipeline, so each product's own price is copied in one statement per store.
    await Product.updateMany({ storeId: s._id, ...oldPrice }, [
      { $set: { actualPrice: "$price", salePrice: "$price" } },
      { $unset: ["price", "discountPrice"] },
    ]);
  }

  // A product saved by the new code before this ran can have both; the new fields win, the old goes.
  const leftovers = await Product.aggregate<{ _id: string; count: number }>([
    { $match: { price: { $exists: true }, actualPrice: { $exists: true } } },
    { $group: { _id: "$storeId", count: { $sum: 1 } } },
  ]);
  for (const s of leftovers) {
    console.log(`store ${s._id}: ${s.count} product(s) still carrying the old price beside the new ones`);
    if (apply) await Product.updateMany({ storeId: s._id, price: { $exists: true }, actualPrice: { $exists: true } }, { $unset: { price: 1 } });
  }

  console.log(
    `${apply ? "Converted" : "Would convert"} ${products} product(s) in ${perStore.length} store(s) to the three prices.` +
      (apply ? "" : "\nRun again with --apply to do it.")
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
