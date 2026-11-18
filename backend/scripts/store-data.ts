/**
 * A store's data, for an operator (production readiness, 2026-11). See
 * src/modules/privacy/dataLifecycle.service.ts for exactly what each command covers.
 *
 *   npm run store-data -- export <storeId> [file.json]       everything the store has, as JSON
 *   npm run store-data -- clear-cache <storeId>              its carts, chat memory, search and AI caches in Redis
 *   npm run store-data -- delete <storeId> --yes-delete-store-<slug>
 *                                                            the store and all its data, files and cache
 *
 * Delete cannot be undone: export first, and keep the export as the store's record. The confirmation
 * names the store's slug so a wrong id cannot delete another store.
 */
import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { prismaUnscoped } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { clearStoreRedis, deleteStore, exportStore } from "../src/modules/privacy/dataLifecycle.service";

async function main() {
  const [command, storeId, arg] = process.argv.slice(2);
  if (!command || !storeId) throw new Error("Usage: export <storeId> [file] | clear-cache <storeId> | delete <storeId> --yes-delete-store-<slug>");
  const store = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { id: true, slug: true, name: true } });
  if (!store) throw new Error(`No store with id ${storeId}`);
  await connectMongo();

  if (command === "export") {
    const file = arg ?? `store-${store.slug}-${new Date().toISOString().slice(0, 10)}.json`;
    const data = await exportStore(storeId);
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Exported "${store.name}": ${data.orders.length} orders, ${data.catalogue.products.length} products, ${data.customers.length} customers -> ${file}`);
  } else if (command === "clear-cache") {
    console.log(`Removed ${await clearStoreRedis(storeId)} Redis keys for "${store.name}".`);
  } else if (command === "delete") {
    if (arg !== `--yes-delete-store-${store.slug}`) throw new Error(`To delete "${store.name}" and all its data for good, add --yes-delete-store-${store.slug} (export it first).`);
    console.log(JSON.stringify(await deleteStore(storeId), null, 2));
  } else {
    throw new Error(`Unknown command "${command}"`);
  }
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    await prismaUnscoped.$disconnect();
  });
