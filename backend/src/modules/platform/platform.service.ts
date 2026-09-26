import { prismaUnscoped } from "../../lib/prisma";
import { Product } from "../../models/Product.model";
import { PLANS, PLAN_ORDER, effectiveTier, planEconomics } from "../../lib/plans";
import { currentMonth } from "../ai/ai.quota.service";

/**
 * The platform operator's view (Part A): how many stores there are, what they pay and how much
 * they use, as per-store TOTALS. It deliberately reads nothing about any store's customers or
 * orders beyond a count and a sum: no names, emails, addresses, order contents or shoppers. It is
 * the one place that queries across tenants, which is why every query here is an aggregate and
 * the routes are limited to SUPER_ADMIN (middleware/requireSuperAdmin.middleware.ts).
 *
 * "Sales" follow the analytics definition: an order with a payment that was taken (succeeded, or
 * since refunded), at its total including tax and shipping, gross of refunds.
 */

const SALES_JOIN = `EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))`;

interface Totals {
  orders: number;
}

export const platformService = {
  async summary() {
    const tenants = await prismaUnscoped.tenant.findMany({ select: { plan: true, planExpiresAt: true } });
    const byPlan = Object.fromEntries(PLAN_ORDER.map((t) => [t, 0])) as Record<string, number>;
    let monthlyRecurringCents = 0;
    for (const t of tenants) {
      const tier = effectiveTier(t);
      byPlan[tier]++;
      monthlyRecurringCents += PLANS[tier].priceCents;
    }
    const [totals] = await prismaUnscoped.$queryRawUnsafe<Totals[]>(
      `SELECT count(*)::int AS orders FROM "Order" o WHERE ${SALES_JOIN}`
    );
    const quotas = await prismaUnscoped.aiUsageQuota.aggregate({
      where: { month: currentMonth() },
      _sum: { generationsUsed: true, chatMessagesUsed: true },
    });
    return {
      stores: tenants.length,
      storesByPlan: byPlan,
      monthlyRecurringRevenue: monthlyRecurringCents / 100,
      // Orders only: stores sell in different currencies, so a platform-wide sales sum would mix them.
      orders: totals?.orders ?? 0,
      aiUsageThisMonth: { generations: quotas._sum.generationsUsed ?? 0, chatMessages: quotas._sum.chatMessagesUsed ?? 0 },
      /** Each plan and top-up pack: price against worst-case cost, so a bad edit to lib/plans.ts is visible. */
      economics: planEconomics(),
    };
  },

  async tenants(opts: { limit: number; offset: number; q?: string }) {
    const where = opts.q
      ? { OR: [{ name: { contains: opts.q, mode: "insensitive" as const } }, { slug: { contains: opts.q, mode: "insensitive" as const } }] }
      : {};
    const [rows, total] = await Promise.all([
      prismaUnscoped.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: opts.offset,
        take: opts.limit,
        select: { id: true, name: true, slug: true, currency: true, plan: true, planExpiresAt: true, createdAt: true },
      }),
      prismaUnscoped.tenant.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);

    const [orderRows, productRows, quotaRows] = ids.length
      ? await Promise.all([
          prismaUnscoped.$queryRawUnsafe<{ tenantId: string; orders: number; gross: string }[]>(
            `SELECT o."tenantId", count(*)::int AS orders, COALESCE(sum(o."total"), 0)::text AS gross
             FROM "Order" o WHERE o."tenantId" = ANY($1::text[]) AND ${SALES_JOIN} GROUP BY o."tenantId"`,
            ids
          ),
          Product.aggregate<{ _id: string; n: number }>([{ $match: { storeId: { $in: ids } } }, { $group: { _id: "$storeId", n: { $sum: 1 } } }]),
          prismaUnscoped.aiUsageQuota.findMany({ where: { tenantId: { in: ids }, month: currentMonth() } }),
        ])
      : [[], [], []];
    const orders = new Map(orderRows.map((r) => [r.tenantId, r]));
    const products = new Map(productRows.map((r) => [r._id, r.n]));
    const quotas = new Map(quotaRows.map((r) => [r.tenantId, r]));

    return {
      data: rows.map((t) => {
        const tier = effectiveTier(t);
        const o = orders.get(t.id);
        const q = quotas.get(t.id);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          currency: t.currency,
          plan: PLANS[tier].name,
          paidUntil: t.planExpiresAt,
          createdAt: t.createdAt,
          products: products.get(t.id) ?? 0,
          orders: o?.orders ?? 0,
          grossSales: Number(o?.gross ?? 0),
          aiGenerationsUsed: q?.generationsUsed ?? 0,
          aiChatMessagesUsed: q?.chatMessagesUsed ?? 0,
        };
      }),
      pagination: { total, limit: opts.limit, offset: opts.offset },
    };
  },
};
