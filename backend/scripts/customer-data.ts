/**
 * One person's data across every store, for an operator answering a request (production readiness,
 * 2026-11). See src/modules/privacy/dataLifecycle.service.ts for exactly what each command covers.
 *
 *   npm run customer-data -- export <email> [file.json]     their account, customer records, orders, reviews, chats
 *   npm run customer-data -- erase <email> --yes-erase <email>
 *                                                           removes their personal data; orders stay, anonymised
 *
 * Erasing cannot be undone. Export first if the person asked for a copy. The confirmation repeats the
 * email so a typo cannot erase someone else.
 */
import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { prismaUnscoped } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { eraseCustomer, exportCustomer } from "../src/modules/privacy/dataLifecycle.service";

async function main() {
  const [command, email, flag, confirm] = process.argv.slice(2);
  if (!command || !email) throw new Error("Usage: export <email> [file] | erase <email> --yes-erase <email>");
  await connectMongo();
  if (command === "export") {
    const data = await exportCustomer(email);
    const file = flag ?? `customer-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Exported: ${data.account ? "an account, " : ""}${data.customerRecords.length} customer records, ${data.orders.length} orders, ${data.reviews.length} reviews -> ${file}`);
  } else if (command === "erase") {
    if (flag !== "--yes-erase" || confirm?.trim().toLowerCase() !== email.trim().toLowerCase()) throw new Error("To erase this person's data for good, add --yes-erase followed by the same email.");
    console.log(JSON.stringify(await eraseCustomer(email), null, 2));
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
