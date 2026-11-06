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
 * The anchor is the day each demo store was created, which is the day its sales were seeded relative
 * to. Each store is moved forward by the whole days since then, and its creation date moves with it, so
 * the next run only moves the days that passed in between. Stores seeded together keep moving together
 * (Product Scout's demo depends on several shops' weeks lining up). The move never goes further than
 * would put the store's newest order on yesterday, so a sale made by hand after the seed (the
 * walkthrough videos make some) is never dated in the future. Every dated record that belongs to the
 * same sales moves too (orders, payments, refunds, shipments, register shifts), keeping spacing,
 * weekday and time of day. Only stores whose address starts with the demo prefix are touched; those are
 * already kept out of every real figure. Running it again the same day does nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Whole days to move a demo store: the days since it was created (its seed day), but no more than would
 * put its newest order on yesterday.
 */
export function daysToShift(storeCreated: Date, newestOrder: Date | null, now: Date): number {
  const sinceSeed = Math.round((dayStart(now) - dayStart(storeCreated)) / DAY_MS);
  const toYesterday = newestOrder ? Math.round((dayStart(now) - DAY_MS - dayStart(newestOrder)) / DAY_MS) : sinceSeed;
  return Math.max(0, Math.min(sinceSeed, toYesterday));
}

/** `onlyTenantIds` limits it to some demo stores (tests use it, so the machine's own demo stays put). */
export async function refreshDemoSalesDates(now: Date = new Date(), onlyTenantIds?: string[]): Promise<{ store: string; days: number }[]> {
  const only = onlyTenantIds ? Prisma.sql`AND t."id" = ANY(${onlyTenantIds}::text[])` : Prisma.empty;
  const stores = await prismaUnscoped.$queryRaw<{ id: string; slug: string; createdAt: Date; newest: Date | null }[]>`
    SELECT t."id", t."slug", t."createdAt", max(o."createdAt") AS newest
    FROM "Tenant" t LEFT JOIN "Order" o ON o."tenantId" = t."id"
    WHERE t."slug" LIKE ${`${DEMO_SLUG_PREFIX}%`} ${only}
    GROUP BY t."id", t."slug", t."createdAt"`;
  const moved: { store: string; days: number }[] = [];
  for (const store of stores) {
    const days = daysToShift(store.createdAt, store.newest, now);
    if (days === 0) continue;
    const by = Prisma.sql`make_interval(days => ${days}::int)`;
    await prismaUnscoped.$transaction([
      prismaUnscoped.$executeRaw`UPDATE "Order" SET "createdAt" = "createdAt" + ${by}, "updatedAt" = "updatedAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Payment" SET "createdAt" = "createdAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Refund" SET "createdAt" = "createdAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Shipment" SET "shippedAt" = "shippedAt" + ${by}, "deliveredAt" = "deliveredAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "PosShift" SET "openedAt" = "openedAt" + ${by}, "closedAt" = "closedAt" + ${by} WHERE "tenantId" = ${store.id}`,
      prismaUnscoped.$executeRaw`UPDATE "Tenant" SET "createdAt" = "createdAt" + ${by} WHERE "id" = ${store.id}`,
    ]);
    moved.push({ store: store.slug, days });
  }
  if (moved.length > 0) logger.info(`[demo] moved ${moved.length} demo store(s)' sales forward so they stay recent`);
  return moved;
}
