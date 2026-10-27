/**
 * Turns the free-text product categories typed before the Categories module existed into each
 * store's own Category records, and links every product to its category by id.
 *
 * Per store, the names are grouped by their normalized form (trimmed, lower-cased, inner spaces
 * collapsed), so "Toys", "toys" and " TOYS " become one category. Its display name is the spelling
 * used by the most products (alphabetical first on a tie), and every product in the group is given
 * that name as well as the id. A store that already has a category with that normalized name gets
 * its products linked to it rather than a duplicate. A product with no category at all goes in
 * "Uncategorised".
 *
 * Only products without a categoryId are touched, so running it again changes nothing, and products
 * linked by the new product form are never rewritten. It reports first and changes nothing without
 * --apply.
 *
 * Usage:  npx tsx scripts/migrate-categories.ts            (reports what it would do)
 *         npx tsx scripts/migrate-categories.ts --apply    (does it)
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { Product } from "../src/models/Product.model";
import { Category, normalizeCategoryName, tidyCategoryName } from "../src/models/Category.model";

const apply = process.argv.includes("--apply");
const UNCATEGORISED = "Uncategorised";

interface Group {
  storeId: string;
  normalizedName: string;
  /** Each spelling found, with how many products use it. */
  spellings: Map<string, number>;
}

async function main() {
  await connectMongo();

  // Products not linked yet, counted by store and by the exact text typed.
  const rows = await Product.aggregate<{ _id: { storeId: string; category: string | null }; count: number }>([
    { $match: { categoryId: { $exists: false } } },
    { $group: { _id: { storeId: "$storeId", category: "$category" }, count: { $sum: 1 } } },
  ]);

  const groups = new Map<string, Group>();
  for (const { _id, count } of rows) {
    const display = tidyCategoryName(_id.category ?? "") || UNCATEGORISED;
    const normalizedName = normalizeCategoryName(display);
    const key = `${_id.storeId}\u0000${normalizedName}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { storeId: _id.storeId, normalizedName, spellings: new Map() }));
    // The exact stored text is kept as the key, so the update below finds every product in the group.
    g.spellings.set(_id.category ?? "", (g.spellings.get(_id.category ?? "") ?? 0) + count);
  }

  const summary = { stores: new Set<string>(), created: 0, reused: 0, products: 0 };
  for (const g of groups.values()) {
    const ranked = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const name = tidyCategoryName(ranked[0][0]) || UNCATEGORISED;
    const productCount = ranked.reduce((n, [, c]) => n + c, 0);
    const existing = await Category.findOne({ storeId: g.storeId, normalizedName: g.normalizedName }).lean();

    summary.stores.add(g.storeId);
    summary.products += productCount;
    if (existing) summary.reused += 1;
    else summary.created += 1;
    console.log(
      `store ${g.storeId}: "${existing?.name ?? name}" (${existing ? "existing" : "new"}) <- ${productCount} product(s), spelled ${ranked.map(([s]) => JSON.stringify(s)).join(", ")}`
    );
    if (!apply) continue;

    const category =
      existing ??
      (await Category.findOneAndUpdate(
        { storeId: g.storeId, normalizedName: g.normalizedName },
        { $setOnInsert: { storeId: g.storeId, name, normalizedName: g.normalizedName, active: true } },
        { upsert: true, new: true }
      ).lean());

    const spellings = [...g.spellings.keys()];
    await Product.updateMany(
      {
        storeId: g.storeId,
        categoryId: { $exists: false },
        $or: [{ category: { $in: spellings } }, ...(spellings.includes("") ? [{ category: null }, { category: { $exists: false } }] : [])],
      },
      { $set: { categoryId: category!._id, category: category!.name } }
    );
  }

  console.log(
    `${apply ? "Linked" : "Would link"} ${summary.products} product(s) in ${summary.stores.size} store(s): ` +
      `${summary.created} new categor${summary.created === 1 ? "y" : "ies"}, ${summary.reused} existing.` +
      (apply ? "" : "\nRun again with --apply to do it.")
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
