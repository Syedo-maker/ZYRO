import { Product } from "../../models/Product.model";

/**
 * Moves products saved in an older price shape onto the current one (scripts/migrate-product-fields.ts
 * runs it). Customers keep paying exactly what they paid before; only how the price is stored changes.
 *
 * 1. The single `price` from before the three prices becomes the actual price (MRP) and the sale
 *    price, with no discount.
 * 2. The discounted price from before the discount modes (`discountPrice`, what customers paid)
 *    becomes an amount off the MRP: MRP minus that price, with the sale price set to it. A
 *    "discounted price" equal to the MRP was no discount, and is dropped.
 * 3. A product that already has the new fields and still carries an old one loses the old one.
 *
 * Only products still in an old shape are touched, so running it again changes nothing. Without
 * `apply` it only counts. `storeIds` limits it to some stores (tests use it, so they never convert
 * another store's products).
 */
export async function migrateProductPrices(opts: { apply: boolean; storeIds?: string[] }) {
  // Every store, said explicitly: the tenant guard refuses a product query without a storeId filter.
  const scope = { storeId: opts.storeIds ? { $in: opts.storeIds } : { $exists: true } };
  const singlePrice = { ...scope, price: { $exists: true }, actualPrice: { $exists: false } };
  const discountedPrice = { ...scope, discountPrice: { $exists: true }, discountType: { $exists: false } };

  const counts = {
    singlePrice: await Product.countDocuments(singlePrice),
    /** Single-price products priced at 0, which the product form now refuses; their owners should set a price. */
    singlePriceAtZero: await Product.countDocuments({ ...singlePrice, price: { $lte: 0 } }),
    discountedPrice: 0,
    leftovers: 0,
  };
  if (opts.apply && counts.singlePrice) {
    // An update pipeline, so each product's own price is copied in one statement.
    await Product.updateMany(singlePrice, [{ $set: { actualPrice: "$price", salePrice: "$price" } }, { $unset: ["price"] }]);
  }

  // After step 1, so a single-price product that somehow also had a discounted price is handled here too.
  counts.discountedPrice = await Product.countDocuments(discountedPrice);
  if (opts.apply && counts.discountedPrice) {
    await Product.updateMany(discountedPrice, [
      {
        $set: {
          discountType: { $cond: [{ $lt: ["$discountPrice", "$actualPrice"] }, "amount", "$$REMOVE"] },
          discountValue: { $cond: [{ $lt: ["$discountPrice", "$actualPrice"] }, { $subtract: ["$actualPrice", "$discountPrice"] }, "$$REMOVE"] },
          salePrice: { $cond: [{ $lt: ["$discountPrice", "$actualPrice"] }, "$discountPrice", "$actualPrice"] },
        },
      },
      { $unset: ["discountPrice"] },
    ]);
  }

  const leftover = { ...scope, actualPrice: { $exists: true }, $or: [{ price: { $exists: true } }, { discountPrice: { $exists: true }, discountType: { $exists: true } }] };
  counts.leftovers = await Product.countDocuments(leftover);
  if (opts.apply && counts.leftovers) await Product.updateMany(leftover, { $unset: { price: 1, discountPrice: 1 } });

  return counts;
}
