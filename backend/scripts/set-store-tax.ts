/**
 * Sets a store's tax rate (there is no settings screen for it yet), for demos and tests.
 * Usage: npx tsx scripts/set-store-tax.ts <storeId> <percent>    e.g. ... abc123 10
 */
import { prismaUnscoped as p } from "../src/lib/prisma";

async function main() {
  const [storeId, rate] = process.argv.slice(2);
  const percent = Number(rate);
  if (!storeId || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    console.error("Usage: npx tsx scripts/set-store-tax.ts <storeId> <percent between 0 and 100>");
    process.exit(1);
  }
  const t = await p.tenant.update({ where: { id: storeId }, data: { taxRate: percent.toFixed(2) } });
  console.log(`${t.name}: tax rate is now ${t.taxRate}%`);
  await p.$disconnect();
  process.exit(0);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
