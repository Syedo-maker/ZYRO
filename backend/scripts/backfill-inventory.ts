/**
 * One-off: moves the legacy `stock` field on MongoDB products into Postgres inventory.
 * Safe to re-run; products that already have an inventory row are skipped.
 * Usage: npx tsx scripts/backfill-inventory.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { prisma } from "../src/lib/prisma";
import { tenantContext } from "../src/lib/tenantContext";
import { inventoryService } from "../src/modules/inventory/inventory.service";

async function main() {
  await connectMongo();
  const products = await mongoose.connection
    .collection("products")
    .find({ stock: { $type: "number" } })
    .toArray();

  let migrated = 0;
  let skipped = 0;
  for (const p of products) {
    const tenantId = String(p.storeId);
    const productId = String(p._id);
    await tenantContext.run(tenantId, async () => {
      const existing = await prisma.inventoryLevel.findFirst({ where: { tenantId, productId } });
      if (existing) {
        skipped++;
        return;
      }
      await prisma.$transaction(async (tx) => {
        const locationId = await inventoryService.getDefaultLocationId(tx, tenantId);
        await inventoryService.setQuantity(tx, {
          tenantId,
          locationId,
          productId,
          target: p.stock as number,
          type: "INITIAL",
          note: "Backfilled from legacy Product.stock",
        });
      });
      migrated++;
    });
  }
  console.log(`Backfill done: ${migrated} migrated, ${skipped} already present, ${products.length} scanned.`);
  await mongoose.disconnect();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
