/**
 * Change a store's plan by hand, for a platform admin while ZYRO runs without Stripe Billing (the
 * owners' decision of 2026-11-14). See src/modules/billing/manualPlan.service.ts.
 *
 *   npm run set-plan -- <storeId> pro 3        Pro for 3 months (to the end of that day, UTC)
 *   npm run set-plan -- <storeId> business     Business for 1 month
 *   npm run set-plan -- <storeId> free         back to Free now
 *
 * When the paid period ends (plus the usual grace), the store is on Free again by itself.
 */
import { prismaUnscoped } from "../src/lib/prisma";
import { setPlanByHand } from "../src/modules/billing/manualPlan.service";

async function main() {
  const [storeId, plan, months] = process.argv.slice(2);
  if (!storeId || !plan) throw new Error("Usage: npm run set-plan -- <storeId> <free|pro|business> [months]");
  const result = await setPlanByHand(storeId, plan.toUpperCase() as "FREE" | "PRO" | "BUSINESS", months ? Number(months) : 1);
  console.log(`"${result.store}" is now on ${result.plan}${result.until ? ` until ${result.until.toISOString().slice(0, 10)}` : ""}.`);
}

main()
  .catch((err) => {
    // An AppError's explanation is in `detail`; its message is only the title.
    console.error((err as { detail?: string }).detail ?? (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prismaUnscoped.$disconnect());
