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
  // Part E: the platform-wide COD signals the browser tests leave behind. The table belongs to no
  // store, so it is cleaned by the test phone numbers the suites use, hashed the same way the app does.
  const { hashPhone } = await import("../src/modules/payments/payments.service");
  const testPhoneHashes = ["03001234567", "03009998888", "03009999999"].map((n) => hashPhone(n)).filter((h): h is string => h !== null);
  const signals = await p.codPhoneSignal.deleteMany({ where: { phoneHash: { in: testPhoneHashes } } });

  // Trend Scout (Part D) test reports: the test market XTS (reserved for testing), and imports whose category starts "e2e".
  const reports = await p.trendReport.deleteMany({ where: { OR: [{ market: "XTS" }, { category: { startsWith: "e2e " } }] } });
  const imports = await p.trendSignalImport.deleteMany({ where: { OR: [{ market: "XTS" }, { category: { startsWith: "e2e " } }] } });

  const left = { stores: await p.tenant.count(), users: await p.user.count() };
  console.log(
    `Removed ${ids.length} test stores, ${users.count} test users, ${products.deletedCount} products, ${carts.length} carts, ${reports.count + imports.count} trend test rows, ${signals.count} COD signals. ` +
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
