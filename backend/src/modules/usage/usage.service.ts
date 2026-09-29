import type { SalesChannel } from "@prisma/client";
import { prisma, prismaUnscoped, type PrismaTx } from "../../lib/prisma";

/**
 * A store's monthly counters (Part B): orders by channel, sales, refunds. They are written in the
 * same transaction as the order, refund or return they count, so they can never disagree with the
 * rows themselves: if the order is rolled back, so is its count.
 *
 * Each write is a single `INSERT ... ON CONFLICT DO UPDATE` with an increment, which Postgres runs
 * atomically: two orders in the same instant both count, and the month's row is created by
 * whichever arrives first. Raw SQL, so tenantId is written into every statement by hand (the
 * tenant-scoping layer does not see raw SQL). The month is taken from the row's own createdAt, in
 * UTC, which is exactly what `recount` groups by.
 */

const monthOf = (at: Date) => at.toISOString().slice(0, 7);
const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export interface MonthlyUsage {
  month: string;
  onlineOrders: number;
  posOrders: number;
  orders: number;
  grossSales: number;
  refundCount: number;
  refundTotal: number;
  netSales: number;
}

interface Row {
  month: string;
  onlineOrders: number;
  posOrders: number;
  grossSales: string;
  refundCount: number;
  refundTotal: string;
}

const present = (r: Row): MonthlyUsage => {
  const gross = Number(r.grossSales);
  const refunded = Number(r.refundTotal);
  return {
    month: r.month,
    onlineOrders: r.onlineOrders,
    posOrders: r.posOrders,
    orders: r.onlineOrders + r.posOrders,
    grossSales: gross,
    refundCount: r.refundCount,
    refundTotal: refunded,
    netSales: Number((gross - refunded).toFixed(2)),
  };
};

export const usageService = {
  /** One order, counted at its total. Call inside the transaction that creates it. */
  async recordOrder(tx: PrismaTx, order: { tenantId: string; channel: SalesChannel; total: { toString(): string }; createdAt: Date }) {
    const online = order.channel === "ONLINE" ? 1 : 0;
    const pos = order.channel === "POS" ? 1 : 0;
    const total = order.total.toString();
    await tx.$executeRaw`
      INSERT INTO "TenantMonthlyUsage" ("id", "tenantId", "month", "onlineOrders", "posOrders", "grossSales", "updatedAt")
      VALUES (${newId()}, ${order.tenantId}, ${monthOf(order.createdAt)}, ${online}, ${pos}, ${total}::numeric, CURRENT_TIMESTAMP)
      ON CONFLICT ("tenantId", "month") DO UPDATE SET
        "onlineOrders" = "TenantMonthlyUsage"."onlineOrders" + EXCLUDED."onlineOrders",
        "posOrders" = "TenantMonthlyUsage"."posOrders" + EXCLUDED."posOrders",
        "grossSales" = "TenantMonthlyUsage"."grossSales" + EXCLUDED."grossSales",
        "updatedAt" = CURRENT_TIMESTAMP`;
  },

  /** Money paid back (a whole-order refund per payment, or an item return), in the month it was paid back. */
  async recordRefund(tx: PrismaTx, refund: { tenantId: string; amount: { toString(): string }; createdAt: Date }) {
    await tx.$executeRaw`
      INSERT INTO "TenantMonthlyUsage" ("id", "tenantId", "month", "refundCount", "refundTotal", "updatedAt")
      VALUES (${newId()}, ${refund.tenantId}, ${monthOf(refund.createdAt)}, 1, ${refund.amount.toString()}::numeric, CURRENT_TIMESTAMP)
      ON CONFLICT ("tenantId", "month") DO UPDATE SET
        "refundCount" = "TenantMonthlyUsage"."refundCount" + 1,
        "refundTotal" = "TenantMonthlyUsage"."refundTotal" + EXCLUDED."refundTotal",
        "updatedAt" = CURRENT_TIMESTAMP`;
  },

  /** The counters for one month; zeros for a month with nothing in it. Runs inside the store's tenant context. */
  async month(tenantId: string, month = monthOf(new Date())): Promise<MonthlyUsage> {
    const row = await prisma.tenantMonthlyUsage.findFirst({ where: { tenantId, month } });
    return present(
      row
        ? { ...row, grossSales: row.grossSales.toString(), refundTotal: row.refundTotal.toString() }
        : { month, onlineOrders: 0, posOrders: 0, grossSales: "0", refundCount: 0, refundTotal: "0" }
    );
  },

  /** The last `months` months, oldest first, including empty ones (for trends such as the Growth Advisor's). */
  async history(tenantId: string, months: number, now = new Date()): Promise<MonthlyUsage[]> {
    const wanted = Array.from({ length: months }, (_, i) => monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1))));
    const rows = await prisma.tenantMonthlyUsage.findMany({ where: { tenantId, month: { in: wanted } } });
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    return wanted.map((m) => {
      const r = byMonth.get(m);
      return present(
        r
          ? { ...r, grossSales: r.grossSales.toString(), refundTotal: r.refundTotal.toString() }
          : { month: m, onlineOrders: 0, posOrders: 0, grossSales: "0", refundCount: 0, refundTotal: "0" }
      );
    });
  },

  /**
   * What the counters should say, computed from scratch from the orders, refunds and returns. Used
   * to check the counters (they must always match) and, with `repair`, to rebuild a month.
   */
  async recount(tenantId: string, month: string, opts: { repair?: boolean } = {}): Promise<MonthlyUsage> {
    const [row] = await prismaUnscoped.$queryRaw<Row[]>`
      SELECT ${month} AS "month",
             COALESCE(sum(x."online"), 0)::int AS "onlineOrders",
             COALESCE(sum(x."pos"), 0)::int AS "posOrders",
             COALESCE(sum(x."gross"), 0)::text AS "grossSales",
             COALESCE(sum(x."refunds"), 0)::int AS "refundCount",
             COALESCE(sum(x."refunded"), 0)::text AS "refundTotal"
      FROM (
        SELECT CASE WHEN o."channel" = 'ONLINE' THEN 1 ELSE 0 END AS "online",
               CASE WHEN o."channel" = 'POS' THEN 1 ELSE 0 END AS "pos",
               o."total" AS "gross", 0 AS "refunds", 0::numeric AS "refunded"
        FROM "Order" o
        WHERE o."tenantId" = ${tenantId} AND to_char(o."createdAt", 'YYYY-MM') = ${month}
          AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))
        UNION ALL
        SELECT 0, 0, 0, 1, r."amount" FROM "Refund" r WHERE r."tenantId" = ${tenantId} AND to_char(r."createdAt", 'YYYY-MM') = ${month}
        UNION ALL
        SELECT 0, 0, 0, 1, rt."amount" FROM "OrderReturn" rt WHERE rt."tenantId" = ${tenantId} AND to_char(rt."createdAt", 'YYYY-MM') = ${month}
      ) x`;
    if (opts.repair) {
      await prismaUnscoped.$executeRaw`
        INSERT INTO "TenantMonthlyUsage" ("id", "tenantId", "month", "onlineOrders", "posOrders", "grossSales", "refundCount", "refundTotal", "updatedAt")
        VALUES (${newId()}, ${tenantId}, ${month}, ${row.onlineOrders}, ${row.posOrders}, ${row.grossSales}::numeric, ${row.refundCount}, ${row.refundTotal}::numeric, CURRENT_TIMESTAMP)
        ON CONFLICT ("tenantId", "month") DO UPDATE SET
          "onlineOrders" = EXCLUDED."onlineOrders", "posOrders" = EXCLUDED."posOrders", "grossSales" = EXCLUDED."grossSales",
          "refundCount" = EXCLUDED."refundCount", "refundTotal" = EXCLUDED."refundTotal", "updatedAt" = CURRENT_TIMESTAMP`;
    }
    return present(row);
  },
};
