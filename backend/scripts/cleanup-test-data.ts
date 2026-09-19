/**
 * Deletes the throwaway stores, users, products and carts that the test scripts and browser
 * tests leave behind. Only touches stores whose URL slug starts with a known test prefix,
 * so real stores are never affected. Run it after browser tests, which register through the
 * UI and cannot clean up after themselves.
 * Usage: npx tsx scripts/cleanup-test-data.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { prismaUnscoped as p } from "../src/lib/prisma";
import { getRedis, closeRedis } from "../src/lib/redis";

const SLUG_PREFIXES = ["e2e-", "p1-", "vo-", "verify-", "smoke-", "aurora-"];
const EMAIL_PREFIXES = ["e2e-", "p1e2e-", "p1sec-", "p1-", "sec-", "vo-", "verify-", "smoke-", "shopper-", "stripe-"];

async function main() {
  await connectMongo();

  const tenants = await p.tenant.findMany({
    where: { OR: SLUG_PREFIXES.map((s) => ({ slug: { startsWith: s } })) },
    select: { id: true },
  });
  const ids = tenants.map((t) => t.id);

  const products = await mongoose.connection.collection("products").deleteMany({ storeId: { $in: ids } });
  const carts = (await getRedis().keys("cart:*")).filter((k) => ids.some((id) => k.startsWith(`cart:${id}:`)));
  if (carts.length) await getRedis().del(...carts);

  await p.tenant.deleteMany({ where: { id: { in: ids } } });
  const users = await p.user.deleteMany({ where: { OR: EMAIL_PREFIXES.map((e) => ({ email: { startsWith: e } })) } });

  const left = { stores: await p.tenant.count(), users: await p.user.count() };
  console.log(
    `Removed ${ids.length} test stores, ${users.count} test users, ${products.deletedCount} products, ${carts.length} carts. ` +
      `Remaining: ${left.stores} stores, ${left.users} users.`
  );

  await closeRedis();
  await mongoose.disconnect();
  await p.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
