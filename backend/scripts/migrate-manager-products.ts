/**
 * Gives staff added as Managers before 2026-10-22 the Products permission, which the Manager role
 * gained then (lib/staffRoles.ts): products, stock, categories and the AI tools.
 *
 * Only staff whose permissions are exactly the old Manager set are changed, so a cashier, a member
 * given their own list through the API, or a manager already moved on is left alone, and running it
 * again changes nothing. It reports first and changes nothing without --apply. Store and member
 * emails are not printed: the store's name and a member count are enough to check it.
 *
 * Usage:  npx tsx scripts/migrate-manager-products.ts            (reports what it would do)
 *         npx tsx scripts/migrate-manager-products.ts --apply    (does it)
 */
import { StaffPermission } from "@prisma/client";
import { prismaUnscoped as prisma } from "../src/lib/prisma";
import { ROLE_PERMISSIONS } from "../src/lib/staffRoles";

const apply = process.argv.includes("--apply");
const OLD_MANAGER: StaffPermission[] = ["POS_SELL", "REFUNDS", "DISCOUNTS_WRITE", "ANALYTICS_READ", "ORDERS_WRITE"];
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p) => b.includes(p));

async function main() {
  const staff = await prisma.staffMember.findMany({ include: { tenant: { select: { name: true } } } });
  const toUpgrade = staff.filter((s) => sameSet(s.permissions, OLD_MANAGER));
  const byStore = new Map<string, number>();
  for (const s of toUpgrade) byStore.set(s.tenant.name, (byStore.get(s.tenant.name) ?? 0) + 1);
  for (const [store, count] of byStore) console.log(`${store}: ${count} manager(s) without the Products permission`);

  if (apply && toUpgrade.length > 0) {
    await prisma.staffMember.updateMany({ where: { id: { in: toUpgrade.map((s) => s.id) } }, data: { permissions: ROLE_PERMISSIONS.manager } });
  }
  console.log(
    `${apply ? "Gave" : "Would give"} the Products permission to ${toUpgrade.length} manager(s) in ${byStore.size} store(s).` +
      (apply ? "" : "\nRun again with --apply to do it.")
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
