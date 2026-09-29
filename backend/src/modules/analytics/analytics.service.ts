import { Types } from "mongoose";
import { prisma } from "../../lib/prisma";
import { Product } from "../../models/Product.model";
import { getRedis } from "../../lib/redis";
import type { SummaryQuery } from "./analytics.validation";

/**
 * Sales analytics for one store, computed on demand from Postgres with aggregate queries and
 * cached in Redis for five minutes, so the dashboard is quick without a data warehouse
 * (Implementation_Plan.md, Phase 3). Both sales channels (online and POS) come from the same
 * orders, so every figure can be split by channel.
 *
 * The definitions match the POS daily report exactly, so the two never disagree:
 * - A sale is an order that has a payment which was taken (succeeded, or since refunded).
 *   Unpaid and never-paid orders are not sales.
 * - Gross sales is the sum of those orders' totals (tax and shipping included, after discounts).
 * - A refund counts in the period it is paid back, whichever period the sale was in. Refunds
 *   are refund records: a whole-order refund of a split payment is one record per payment.
 * - Net sales = gross sales minus refunds.
 * - Product figures cover units still kept: sales that were refunded or cancelled in full, and
 *   units returned item by item, are left out. Revenue is the line total before any
 *   order-level discount, and margin is price minus the cost recorded at sale time (only for
 *   items that had a cost), so it is also before order-level discounts.
 *
 * The queries are raw SQL for GROUP BY and date bucketing, so each one filters on the tenant
 * itself; the tenant-scoping layer does not see raw SQL.
 */
const CACHE_SECONDS = 300;
const SLOT_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const CHANNELS = ["online", "pos"] as const;
type Channel = (typeof CHANNELS)[number];

const cents = (text: string | null | undefined) => Math.round(Number(text ?? 0) * 100);
const money = (c: number) => Number((c / 100).toFixed(2));

interface Bucket {
  orders: number;
  grossCents: number;
  refundCents: number;
  refundCount: number;
}
const emptyBucket = (): Bucket => ({ orders: 0, grossCents: 0, refundCents: 0, refundCount: 0 });

/** The window to report on. With none given: the last 30 days up to the next five-minute mark, so requests in the same slot share one cache entry. */
export function resolveRange(q: Pick<SummaryQuery, "from" | "to">, now = new Date()) {
  if (q.from && q.to) return { from: q.from, to: q.to };
  const to = new Date(Math.ceil(now.getTime() / SLOT_MS) * SLOT_MS);
  return { from: new Date(to.getTime() - DEFAULT_DAYS * DAY_MS), to };
}

/** The local calendar days a window touches, given minutes east of UTC. */
export function localDays(from: Date, to: Date, tzOffsetMinutes: number): string[] {
  const shift = tzOffsetMinutes * 60 * 1000;
  const first = Math.floor((from.getTime() + shift) / DAY_MS);
  const last = Math.floor((to.getTime() - 1 + shift) / DAY_MS);
  const days: string[] = [];
  for (let d = first; d <= last; d++) days.push(new Date(d * DAY_MS).toISOString().slice(0, 10));
  return days;
}

const MAX_CATEGORIES = 6;

/**
 * Revenue and units kept, per product category, largest first; anything past the sixth is summed
 * into "Other". Orders do not record a category (it lives on the product in MongoDB), so a product's
 * current category is used, and a product deleted since is counted under "Removed products".
 */
async function salesByCategory(tenantId: string, rows: { product_id: string; units: number; revenue: string }[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.product_id).filter((id) => Types.ObjectId.isValid(id));
  const docs = await Product.find({ storeId: tenantId, _id: { $in: ids } }).select("category");
  const categoryOf = new Map(docs.map((d) => [d._id.toString(), d.category]));
  const totals = new Map<string, { revenueCents: number; units: number }>();
  for (const r of rows) {
    const name = categoryOf.get(r.product_id) ?? "Removed products";
    const t = totals.get(name) ?? { revenueCents: 0, units: 0 };
    t.revenueCents += cents(r.revenue);
    t.units += r.units;
    totals.set(name, t);
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1].revenueCents - a[1].revenueCents || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, MAX_CATEGORIES);
  const rest = sorted.slice(MAX_CATEGORIES);
  if (rest.length > 0) {
    top.push(["Other", rest.reduce((s, [, t]) => ({ revenueCents: s.revenueCents + t.revenueCents, units: s.units + t.units }), { revenueCents: 0, units: 0 })]);
  }
  return top.map(([category, t]) => ({ category, revenue: money(t.revenueCents), unitsSold: t.units }));
}

async function compute(tenantId: string, from: Date, to: Date, tz: number) {
  // Bound as text and cast: the columns are timestamps without a zone that hold UTC, and this
  // avoids the database session's own time zone shifting the bounds.
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [tenant, salesRows, refundRows, productRows, totalsRow, newCustomers, perProductRows] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),

    prisma.$queryRaw<{ day: string; channel: string; orders: number; gross: string; discounts: string; tax: string; shipping: string }[]>`
      SELECT to_char(date_trunc('day', o."createdAt" + (${tz}::int * interval '1 minute')), 'YYYY-MM-DD') AS day,
             lower(o."channel"::text) AS channel,
             count(*)::int AS orders,
             COALESCE(sum(o."total"), 0)::text AS gross,
             COALESCE(sum(o."discountAmount"), 0)::text AS discounts,
             COALESCE(sum(o."taxAmount"), 0)::text AS tax,
             COALESCE(sum(o."shippingAmount"), 0)::text AS shipping
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND o."createdAt" >= ${fromIso}::timestamp AND o."createdAt" < ${toIso}::timestamp
        AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))
      GROUP BY 1, 2`,

    prisma.$queryRaw<{ day: string; channel: string; n: number; amount: string }[]>`
      SELECT to_char(date_trunc('day', x."createdAt" + (${tz}::int * interval '1 minute')), 'YYYY-MM-DD') AS day,
             lower(x."channel"::text) AS channel,
             count(*)::int AS n,
             COALESCE(sum(x."amount"), 0)::text AS amount
      FROM (
        SELECT r."createdAt", r."amount", o."channel"
        FROM "Refund" r JOIN "Order" o ON o."id" = r."orderId"
        WHERE r."tenantId" = ${tenantId} AND r."createdAt" >= ${fromIso}::timestamp AND r."createdAt" < ${toIso}::timestamp
        UNION ALL
        SELECT rt."createdAt", rt."amount", o."channel"
        FROM "OrderReturn" rt JOIN "Order" o ON o."id" = rt."orderId"
        WHERE rt."tenantId" = ${tenantId} AND rt."createdAt" >= ${fromIso}::timestamp AND rt."createdAt" < ${toIso}::timestamp
      ) x
      GROUP BY 1, 2`,

    prisma.$queryRaw<{ product_id: string; title: string; units: number; revenue: string; units_online: number; units_pos: number; margin: string; units_with_cost: number }[]>`
      SELECT oi."productId" AS product_id,
             (array_agg(oi."productTitleSnapshot" ORDER BY o."createdAt" DESC))[1] AS title,
             sum(oi."quantity" - oi."returnedQuantity")::int AS units,
             COALESCE(sum(oi."lineTotal" * (oi."quantity" - oi."returnedQuantity")::numeric / oi."quantity"), 0)::text AS revenue,
             COALESCE(sum(oi."quantity" - oi."returnedQuantity") FILTER (WHERE o."channel" = 'ONLINE'), 0)::int AS units_online,
             COALESCE(sum(oi."quantity" - oi."returnedQuantity") FILTER (WHERE o."channel" = 'POS'), 0)::int AS units_pos,
             COALESCE(sum((oi."unitPrice" - oi."unitCostSnapshot") * (oi."quantity" - oi."returnedQuantity")) FILTER (WHERE oi."unitCostSnapshot" IS NOT NULL), 0)::text AS margin,
             COALESCE(sum(oi."quantity" - oi."returnedQuantity") FILTER (WHERE oi."unitCostSnapshot" IS NOT NULL), 0)::int AS units_with_cost
      FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."tenantId" = ${tenantId}
        AND o."createdAt" >= ${fromIso}::timestamp AND o."createdAt" < ${toIso}::timestamp
        AND o."status" NOT IN ('REFUNDED', 'CANCELLED', 'PENDING')
        AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))
      GROUP BY oi."productId"
      HAVING sum(oi."quantity" - oi."returnedQuantity") > 0
      ORDER BY units DESC, sum(oi."lineTotal") DESC, oi."productId"
      LIMIT 10`,

    prisma.$queryRaw<{ units: number; margin: string; units_with_cost: number }[]>`
      SELECT COALESCE(sum(oi."quantity" - oi."returnedQuantity"), 0)::int AS units,
             COALESCE(sum((oi."unitPrice" - oi."unitCostSnapshot") * (oi."quantity" - oi."returnedQuantity")) FILTER (WHERE oi."unitCostSnapshot" IS NOT NULL), 0)::text AS margin,
             COALESCE(sum(oi."quantity" - oi."returnedQuantity") FILTER (WHERE oi."unitCostSnapshot" IS NOT NULL), 0)::int AS units_with_cost
      FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."tenantId" = ${tenantId}
        AND o."createdAt" >= ${fromIso}::timestamp AND o."createdAt" < ${toIso}::timestamp
        AND o."status" NOT IN ('REFUNDED', 'CANCELLED', 'PENDING')
        AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))`,

    prisma.customer.count({ where: { tenantId, createdAt: { gte: from, lt: to } } }),

    // Every product sold (not only the top 10), for sales by category below. Same definition as topProducts.
    prisma.$queryRaw<{ product_id: string; units: number; revenue: string }[]>`
      SELECT oi."productId" AS product_id,
             sum(oi."quantity" - oi."returnedQuantity")::int AS units,
             COALESCE(sum(oi."lineTotal" * (oi."quantity" - oi."returnedQuantity")::numeric / oi."quantity"), 0)::text AS revenue
      FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."tenantId" = ${tenantId}
        AND o."createdAt" >= ${fromIso}::timestamp AND o."createdAt" < ${toIso}::timestamp
        AND o."status" NOT IN ('REFUNDED', 'CANCELLED', 'PENDING')
        AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))
      GROUP BY oi."productId"
      HAVING sum(oi."quantity" - oi."returnedQuantity") > 0`,
  ]);

  const byCategory = await salesByCategory(tenantId, perProductRows);

  const days = localDays(from, to, tz);
  const perDay = new Map<string, Record<Channel, Bucket>>(days.map((d) => [d, { online: emptyBucket(), pos: emptyBucket() }]));
  const perChannel: Record<Channel, Bucket> = { online: emptyBucket(), pos: emptyBucket() };
  let discountsC = 0;
  let taxC = 0;
  let shippingC = 0;

  for (const r of salesRows) {
    const ch = r.channel as Channel;
    const g = cents(r.gross);
    const bucket = perDay.get(r.day)?.[ch];
    if (bucket) {
      bucket.orders += r.orders;
      bucket.grossCents += g;
    }
    perChannel[ch].orders += r.orders;
    perChannel[ch].grossCents += g;
    discountsC += cents(r.discounts);
    taxC += cents(r.tax);
    shippingC += cents(r.shipping);
  }
  for (const r of refundRows) {
    const ch = r.channel as Channel;
    const a = cents(r.amount);
    const bucket = perDay.get(r.day)?.[ch];
    if (bucket) {
      bucket.refundCents += a;
      bucket.refundCount += r.n;
    }
    perChannel[ch].refundCents += a;
    perChannel[ch].refundCount += r.n;
  }

  const view = (b: Bucket) => ({
    orders: b.orders,
    grossSales: money(b.grossCents),
    refunds: money(b.refundCents),
    netSales: money(b.grossCents - b.refundCents),
  });
  const grossC = perChannel.online.grossCents + perChannel.pos.grossCents;
  const refundC = perChannel.online.refundCents + perChannel.pos.refundCents;
  const netC = grossC - refundC;
  const orders = perChannel.online.orders + perChannel.pos.orders;
  const t = totalsRow[0] ?? { units: 0, margin: "0", units_with_cost: 0 };

  return {
    range: { from, to, days: days.length, tzOffsetMinutes: tz },
    currency: tenant?.currency ?? "USD",
    totals: {
      orders,
      grossSales: money(grossC),
      discountsGiven: money(discountsC),
      taxCollected: money(taxC),
      shippingCharged: money(shippingC),
      refunds: { count: perChannel.online.refundCount + perChannel.pos.refundCount, total: money(refundC) },
      netSales: money(netC),
      averageOrderValue: orders > 0 ? money(Math.round(grossC / orders)) : 0,
      unitsSold: t.units,
      productMargin: money(cents(t.margin)),
      costCoveragePercent: t.units > 0 ? Number(((t.units_with_cost / t.units) * 100).toFixed(1)) : 0,
      newCustomers,
    },
    byChannel: CHANNELS.map((channel) => {
      const b = perChannel[channel];
      return {
        channel,
        ...view(b),
        averageOrderValue: b.orders > 0 ? money(Math.round(b.grossCents / b.orders)) : 0,
        shareOfNetSales: netC !== 0 ? Number((((b.grossCents - b.refundCents) / netC) * 100).toFixed(1)) : 0,
      };
    }),
    daily: days.map((date) => {
      const d = perDay.get(date)!;
      return { date, online: view(d.online), pos: view(d.pos), netSales: money(d.online.grossCents - d.online.refundCents + d.pos.grossCents - d.pos.refundCents) };
    }),
    topProducts: productRows.map((p) => ({
      productId: p.product_id,
      title: p.title,
      unitsSold: p.units,
      revenue: money(cents(p.revenue)),
      unitsOnline: p.units_online,
      unitsPos: p.units_pos,
      // Null when no unit of this product had a cost on record, rather than a misleading 0.
      productMargin: p.units_with_cost > 0 ? money(cents(p.margin)) : null,
    })),
    byCategory,
    generatedAt: new Date(),
  };
}

export const analyticsService = {
  /** The dashboard figures for a window; served from Redis for up to five minutes. Redis trouble only costs speed, never the answer. */
  async summary(tenantId: string, query: SummaryQuery) {
    const { from, to } = resolveRange(query);
    const tz = query.tzOffsetMinutes;
    const key = `analytics:summary:${tenantId}:${from.getTime()}:${to.getTime()}:${tz}`;

    try {
      const hit = await getRedis().get(key);
      if (hit) return { ...JSON.parse(hit), cached: true };
    } catch (err) {
      console.error("Analytics cache read failed:", (err as Error).message);
    }

    const result = await compute(tenantId, from, to, tz);
    try {
      await getRedis().set(key, JSON.stringify(result), "EX", CACHE_SECONDS);
    } catch (err) {
      console.error("Analytics cache write failed:", (err as Error).message);
    }
    return { ...result, cached: false };
  },
};
