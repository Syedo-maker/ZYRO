/**
 * Moves products listed before the supervisor's product-listing change onto its fields.
 *
 * Prices (product.migration.ts): a product with only the single `price` gets it as its actual price
 * and its sale price, with no discount; a product with the discounted price from before the discount
 * modes (2026-10-23) gets an amount off instead (MRP minus that price). Customers keep paying what
 * they paid. Until this runs the code still reads the old fields (see priceOf in Product.model.ts),
 * so such a product shows and sells at its price in between; but sorting and filtering by price use
 * the stored sale price, so a single-price product sorts first and falls outside a price filter until
 * this has run.
 *
 * Removed fields: the barcode and the haggling floor (bargainMinPrice) are deleted from every product
 * that still has them, and the unique per-store barcode index is dropped. These go through the raw
 * collection, because the model no longer knows the fields and Mongoose would quietly ignore them.
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
import { migrateProductPrices } from "../src/modules/products/product.migration";

const apply = process.argv.includes("--apply");

async function main() {
  await connectMongo();

  // ---- Prices (src/modules/products/product.migration.ts)
  const prices = await migrateProductPrices({ apply });
  console.log(
    `prices: ${prices.singlePrice} product(s) with a single price` +
      (prices.singlePriceAtZero ? ` (${prices.singlePriceAtZero} priced at 0: their owners should set a price)` : "") +
      `, ${prices.discountedPrice} with a discounted price from before the discount modes, ${prices.leftovers} still carrying an old field beside the new ones`
  );

  // ---- Removed fields
  const raw = Product.collection;
  const removed = { barcode: { $exists: true } as const, bargainMinPrice: { $exists: true } as const };
  const withBarcode = await raw.countDocuments({ barcode: removed.barcode });
  const withFloor = await raw.countDocuments({ bargainMinPrice: removed.bargainMinPrice });
  const indexes = await raw.indexes();
  const barcodeIndex = indexes.find((i) => Object.keys(i.key).includes("barcode"));
  console.log(
    `removed fields: ${withBarcode} product(s) with a barcode, ${withFloor} with a haggling floor; ` +
      `barcode index ${barcodeIndex ? `"${barcodeIndex.name}" present` : "already gone"}`
  );
  if (apply) {
    if (withBarcode || withFloor) await raw.updateMany({ $or: [{ barcode: removed.barcode }, { bargainMinPrice: removed.bargainMinPrice }] }, { $unset: { barcode: "", bargainMinPrice: "" } });
    if (barcodeIndex?.name) await raw.dropIndex(barcodeIndex.name);
  }

  console.log(
    `${apply ? "Converted" : "Would convert"} ${prices.singlePrice + prices.discountedPrice + prices.leftovers} product(s) to the current prices` +
      `, and ${apply ? "removed" : "would remove"} the barcode and haggling floor from ${withBarcode + withFloor ? "the products above" : "no products"}.` +
      (apply ? "" : "\nRun again with --apply to do it.")
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
