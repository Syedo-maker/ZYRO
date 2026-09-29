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
 * Since Part B the figures come from the monthly counters (TenantMonthlyUsage), kept up to date
 * when each order, refund and return is written, so this view reads a handful of small rows
 * instead of adding up every order on the platform. "Sales" follow the analytics definition: an
 * order's total including tax and shipping, gross of refunds.
 */

interface CounterSum {
  tenantId?: string;
  orders: number;
  gross: string;
  refunded: string;
}

export const platformService = {
  async summary() {
    const month = currentMonth();
    const tenants = await prismaUnscoped.tenant.findMany({ select: { plan: true, planExpiresAt: true } });
    const byPlan = Object.fromEntries(PLAN_ORDER.map((t) => [t, 0])) as Record<string, number>;
    let monthlyRecurringCents = 0;
    for (const t of tenants) {
      const tier = effectiveTier(t);
      byPlan[tier]++;
      monthlyRecurringCents += PLANS[tier].priceCents;
    }
    const [all, thisMonth, quotas] = await Promise.all([
      prismaUnscoped.tenantMonthlyUsage.aggregate({ _sum: { onlineOrders: true, posOrders: true } }),
      prismaUnscoped.tenantMonthlyUsage.aggregate({ where: { month }, _sum: { onlineOrders: true, posOrders: true } }),
      prismaUnscoped.aiUsageQuota.aggregate({
        where: { month },
        _sum: { generationsUsed: true, chatMessagesUsed: true, inputTokens: true, outputTokens: true, cachedAnswers: true },
      }),
    ]);
    const orders = (s: { onlineOrders: number | null; posOrders: number | null }) => (s.onlineOrders ?? 0) + (s.posOrders ?? 0);
    return {
      stores: tenants.length,
      storesByPlan: byPlan,
      monthlyRecurringRevenue: monthlyRecurringCents / 100,
      // Orders only: stores sell in different currencies, so a platform-wide sales sum would mix them.
      orders: orders(all._sum),
      ordersThisMonth: orders(thisMonth._sum),
      aiUsageThisMonth: {
        generations: quotas._sum.generationsUsed ?? 0,
        chatMessages: quotas._sum.chatMessagesUsed ?? 0,
        inputTokens: quotas._sum.inputTokens ?? 0,
        outputTokens: quotas._sum.outputTokens ?? 0,
        cachedAnswers: quotas._sum.cachedAnswers ?? 0,
      },
      /** Each plan and top-up pack: price against worst-case cost, so a bad edit to lib/plans.ts is visible. */
      economics: planEconomics(),
    };
  },

  async tenants(opts: { limit: number; offset: number; q?: string }) {
    const month = currentMonth();
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

    const sums = (monthOnly: boolean) =>
      prismaUnscoped.$queryRaw<CounterSum[]>`
        SELECT u."tenantId", COALESCE(sum(u."onlineOrders" + u."posOrders"), 0)::int AS orders,
               COALESCE(sum(u."grossSales"), 0)::text AS gross, COALESCE(sum(u."refundTotal"), 0)::text AS refunded
        FROM "TenantMonthlyUsage" u
        WHERE u."tenantId" = ANY(${ids}::text[]) AND (${!monthOnly} OR u."month" = ${month})
        GROUP BY u."tenantId"`;

    const [allRows, monthRows, productRows, quotaRows] = ids.length
      ? await Promise.all([
          sums(false),
          sums(true),
          Product.aggregate<{ _id: string; n: number }>([{ $match: { storeId: { $in: ids } } }, { $group: { _id: "$storeId", n: { $sum: 1 } } }]),
          prismaUnscoped.aiUsageQuota.findMany({ where: { tenantId: { in: ids }, month } }),
        ])
      : [[], [], [], []];
    const allTime = new Map(allRows.map((r) => [r.tenantId, r]));
    const current = new Map(monthRows.map((r) => [r.tenantId, r]));
    const products = new Map(productRows.map((r) => [r._id, r.n]));
    const quotas = new Map(quotaRows.map((r) => [r.tenantId, r]));

    return {
      data: rows.map((t) => {
        const tier = effectiveTier(t);
        const a = allTime.get(t.id);
        const m = current.get(t.id);
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
          orders: a?.orders ?? 0,
          grossSales: Number(a?.gross ?? 0),
          refunds: Number(a?.refunded ?? 0),
          ordersThisMonth: m?.orders ?? 0,
          salesThisMonth: Number(m?.gross ?? 0),
          aiGenerationsUsed: q?.generationsUsed ?? 0,
          aiChatMessagesUsed: q?.chatMessagesUsed ?? 0,
          aiTokensUsed: (q?.inputTokens ?? 0) + (q?.outputTokens ?? 0),
        };
      }),
      pagination: { total, limit: opts.limit, offset: opts.offset },
    };
  },
};
