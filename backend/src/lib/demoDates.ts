import { Prisma } from "@prisma/client";
import { prismaUnscoped } from "./prisma";
import { DEMO_SLUG_PREFIX } from "./demo";
import { logger } from "./logger";

/**
 * Keeps the demo stores' sales recent (A2, 2026-11). The demo seeds (scripts/demo-product-scout.ts,
 * scripts/demo-videos.ts) date their orders over the weeks before the day they run, but Product Scout
 * and the dashboards read "the last 7 / 30 days", so a demo seeded a fortnight ago had drifted out of
 * every window and showed nothing.
 *
 * This moves each demo store's sales forward by whole days, so that its newest order falls on
 * yesterday, keeping their spacing, day of the week and time of day. Every dated record that belongs
 * to the same sales moves together (orders, payments, refunds, shipments, register shifts), so a
 * store's history stays consistent. Only stores whose address starts with the demo prefix are touched;
 * those are already kept out of every real figure. Running it again the same day does nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many whole days to move a demo store forward so its newest order lands on the day before `now`. */
export function daysToShift(newestOrder: Date, now: Date): number {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const newestDayStart = Date.UTC(newestOrder.getUTCFullYear(), newestOrder.getUTCMonth(), newestOrder.getUTCDate());
  const yesterdayStart = todayStart - DAY_MS;
  return Math.max(0, Math.round((yesterdayStart - newestDayStart) / DAY_MS));
}

/** `onlyTenantIds` limits it to some demo stores (tests use it, so the machine's own demo stays put). */
export async function refreshDemoSalesDates(now: Date = new Date(), onlyTenantIds?: string[]): Promise<{ store: string; days: number }[]> {
  const only = onlyTenantIds ? Prisma.sql`AND t."id" = ANY(${onlyTenantIds}::text[])` : Prisma.empty;
  const stores = await prismaUnscoped.$queryRaw<{ id: string; slug: string; newest: Date | null }[]>`
    SELECT t."id", t."slug", max(o."createdAt") AS newest
    FROM "Tenant" t LEFT JOIN "Order" o ON o."tenantId" = t."id"
    WHERE t."slug" LIKE ${`${DEMO_SLUG_PREFIX}%`} ${only}
    GROUP BY t."id", t."slug"`;
  const moved: { store: string; days: number }[] = [];
  for (const store of stores) {
    if (!store.newest) continue;
    const days = daysToShift(store.newest, now);
    if (days === 0) continue;
    const by = Prisma.sql`make_interval(days => ${days}::int)`;
    await prismaUnscoped.$transaction([
      prismaUnscoped.$executeRaw`UPDATE "Order" SET "createdAt" = "createdAt" + ${by}, "updatedAt" = "updatedAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Payment" SET "createdAt" = "createdAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Refund" SET "createdAt" = "createdAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Shipment" SET "shippedAt" = "shippedAt" + ${by}, "deliveredAt" = "deliveredAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "PosShift" SET "openedAt" = "openedAt" + ${by}, "closedAt" = "closedAt" + ${by} WHERE "tenantId" = ${store.id}`,
    ]);
    moved.push({ store: store.slug, days });
  }
  if (moved.length > 0) logger.info(`[demo] moved ${moved.length} demo store(s)' sales forward so they stay recent`);
  return moved;
}
