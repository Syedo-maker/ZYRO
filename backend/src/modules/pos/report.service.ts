import { prisma, prismaUnscoped } from "../../lib/prisma";
import { toCents, money, toShiftView } from "./shift.service";

/**
 * The end-of-day view: what the register took and paid back between two instants, split by
 * how it was paid and who rang it up, plus every shift that opened in the window. The
 * caller picks the window (the browser knows the store's local day), so no time zone is
 * guessed here. Amounts include tax; "net" is takings minus money paid back.
 */
export const posReportService = {
  async daily(tenantId: string, from: Date, to: Date) {
    const inRange = { gte: from, lt: to };
    const [orders, refunds, returns, shifts, tenant] = await Promise.all([
      prisma.order.findMany({
        where: { tenantId, channel: "POS", createdAt: inRange, status: { in: ["COMPLETED", "REFUNDED"] } },
        select: {
          total: true,
          discountAmount: true,
          taxAmount: true,
          cashierUserId: true,
          payments: { select: { method: true, amount: true } },
          items: { select: { productId: true, productTitleSnapshot: true, quantity: true, lineTotal: true } },
        },
      }),
      prisma.refund.findMany({
        where: { tenantId, createdAt: inRange, order: { is: { channel: "POS" } } },
        select: { method: true, amount: true, createdByUserId: true },
      }),
      prisma.orderReturn.findMany({
        where: { tenantId, createdAt: inRange },
        select: { method: true, amount: true, createdByUserId: true },
      }),
      prisma.posShift.findMany({ where: { tenantId, openedAt: inRange }, orderBy: { openedAt: "asc" } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    ]);
    const paidBack = [...refunds, ...returns];

    const grossCents = orders.reduce((s, o) => s + toCents(o.total), 0);
    const refundCents = paidBack.reduce((s, r) => s + toCents(r.amount), 0);

    const methods = new Map<string, { sales: number; refunds: number }>();
    const bump = (method: string, key: "sales" | "refunds", cents: number) => {
      const row = methods.get(method) ?? { sales: 0, refunds: 0 };
      row[key] += cents;
      methods.set(method, row);
    };
    for (const o of orders) for (const p of o.payments) bump(p.method, "sales", toCents(p.amount));
    for (const r of paidBack) bump(r.method, "refunds", toCents(r.amount));

    const cashiers = new Map<string, { salesCount: number; sales: number; refunds: number }>();
    const cashier = (id: string | null) => {
      const key = id ?? "unknown";
      const row = cashiers.get(key) ?? { salesCount: 0, sales: 0, refunds: 0 };
      cashiers.set(key, row);
      return row;
    };
    for (const o of orders) {
      const row = cashier(o.cashierUserId);
      row.salesCount += 1;
      row.sales += toCents(o.total);
    }
    for (const r of paidBack) cashier(r.createdByUserId).refunds += toCents(r.amount);

    const users = await prismaUnscoped.user.findMany({
      where: { id: { in: [...cashiers.keys()].filter((k) => k !== "unknown") } },
      select: { id: true, name: true, email: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));

    const items = new Map<string, { title: string; quantity: number; revenue: number }>();
    for (const o of orders) {
      for (const i of o.items) {
        const row = items.get(i.productId) ?? { title: i.productTitleSnapshot, quantity: 0, revenue: 0 };
        row.quantity += i.quantity;
        row.revenue += toCents(i.lineTotal);
        items.set(i.productId, row);
      }
    }

    return {
      from,
      to,
      currency: tenant?.currency ?? "USD",
      salesCount: orders.length,
      grossSales: money(grossCents),
      discountsGiven: money(orders.reduce((s, o) => s + toCents(o.discountAmount), 0)),
      taxCollected: money(orders.reduce((s, o) => s + toCents(o.taxAmount), 0)),
      refunds: { count: paidBack.length, total: money(refundCents) },
      netSales: money(grossCents - refundCents),
      averageSale: orders.length ? money(Math.round(grossCents / orders.length)) : 0,
      byPaymentMethod: [...methods.entries()]
        .map(([method, v]) => ({ method: method.toLowerCase(), sales: money(v.sales), refunds: money(v.refunds), net: money(v.sales - v.refunds) }))
        .sort((a, b) => b.net - a.net),
      byCashier: [...cashiers.entries()]
        .map(([id, v]) => ({
          userId: id === "unknown" ? null : id,
          name: id === "unknown" ? "Unknown" : (nameOf.get(id) ?? "Removed user"),
          salesCount: v.salesCount,
          sales: money(v.sales),
          refunds: money(v.refunds),
          net: money(v.sales - v.refunds),
        }))
        .sort((a, b) => b.net - a.net),
      topItems: [...items.entries()]
        .map(([productId, v]) => ({ productId, title: v.title, quantity: v.quantity, revenue: money(v.revenue) }))
        .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
        .slice(0, 5),
      shifts: await Promise.all(shifts.map((s) => toShiftView(prisma, s))),
    };
  },
};
