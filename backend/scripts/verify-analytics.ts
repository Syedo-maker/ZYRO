/**
 * End-to-end check of the sales analytics (Phase 3, Module 7) against the real local Postgres,
 * MongoDB and Redis, driven through the real HTTP API. A store with online and in-store sales,
 * discounts, refunds and returns spread over known days is checked against hand-computed
 * figures AND against an independent recomputation from the raw rows, and the POS half is
 * compared with the POS daily report so the two can never disagree. Also: time zones, the
 * 5-minute Redis cache (and that a Redis failure only costs speed), permissions, validation,
 * tenant isolation, and speed with thousands of orders.
 * Creates throwaway stores and removes them after.
 * Usage: npx tsx scripts/verify-analytics.ts   (Redis must be running on REDIS_URL)
 */
process.env.RATE_LIMIT_ENABLED = "false"; // many registrations in a row; verify-security.ts covers the limits
process.env.STRIPE_SECRET_KEY = "sk_test_verifyanalytics";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_verifyanalytics";

import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { getRedis, closeRedis } = await import("../src/lib/redis");
  const { getStripeGateway, setStripeGateway } = await import("../src/lib/stripe");
  const { tenantContext } = await import("../src/lib/tenantContext");
  const { createOrder } = await import("../src/modules/commerce/order.service");
  const { resolveRange, localDays } = await import("../src/modules/analytics/analytics.service");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  setStripeGateway({
    ...getStripeGateway(),
    async refundPaymentIntent(_pi, key) {
      return { id: `re_${key}` };
    },
  });

  async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function register(tag: string) {
    const email = `verify-an-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-an-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }
  async function staffMember(owner: { token: string; storeId: string }, tag: string, permissions: string[]) {
    const email = `verify-an-${tag}-${suffix}@example.com`;
    const made = await api("POST", `/stores/${owner.storeId}/staff`, { token: owner.token, body: { email, name: tag, password: "password123", permissions } });
    created.userIds.push(made.json.userId);
    return (await api("POST", "/auth/login", { body: { email, password: "password123" } })).json.accessToken as string;
  }

  try {
    const A = await register("a");
    const B = await register("b");
    const outsider = await register("out");
    const analyst = await staffMember(A, "analyst", ["analytics_read"]);
    const cashier = await staffMember(A, "cashier", ["pos_sell"]);
    await prismaUnscoped.tenant.update({ where: { id: A.storeId }, data: { taxRate: "10" } });

    const mk = async (title: string, price: number, costPrice?: number, taxable = true) =>
      (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title, price, stock: 5000, category: "t", taxable, ...(costPrice === undefined ? {} : { costPrice }) } })).json.id as string;
    const widget = await mk("Widget", 20, 8);
    const gadget = await mk("Gadget", 10, undefined, false);
    const gizmo = await mk("Gizmo", 50, 30);

    let pi = 0;
    const at = (iso: string) => new Date(iso);
    /** Places a real order through the shared order service, then moves it to the given day. */
    async function place(channel: "ONLINE" | "POS", when: string, items: [string, number][], total: number, extra: Record<string, unknown> = {}) {
      const order = await tenantContext.run(A.storeId, () =>
        createOrder({
          tenantId: A.storeId,
          channel,
          items: items.map(([productId, quantity]) => ({ productId, quantity })),
          payments: [channel === "ONLINE" ? { method: "STRIPE", amount: total, stripePaymentIntentId: `pi_an_${suffix}_${++pi}` } : { method: "CASH", amount: total }],
          ...(channel === "ONLINE" ? { guestEmail: "buyer@example.com" } : {}),
          ...extra,
        } as never)
      );
      await prismaUnscoped.order.update({ where: { id: order.id }, data: { createdAt: at(when) } });
      return order;
    }

    // ---- The scenario, every number worked out by hand (tax 10% on Widget and Gizmo, none on Gadget) ----
    const o1 = await place("ONLINE", "2026-08-05T10:00:00Z", [[widget, 2]], 44); // 40 + 4 tax
    const o2 = await place("ONLINE", "2026-08-05T23:30:00Z", [[gadget, 1], [gizmo, 1]], 65); // 10 + 50 + 5 tax
    const o3 = await place("POS", "2026-08-06T09:00:00Z", [[widget, 3]], 59.4, { discount: { type: "PERCENTAGE", value: 10 } }); // 60 - 6 + 5.40 tax
    const o4 = await place("POS", "2026-08-06T15:00:00Z", [[gizmo, 1]], 55); // 50 + 5 tax
    const o5 = await place("ONLINE", "2026-08-10T12:00:00Z", [[widget, 1]], 22); // refunded in full below
    const o6 = await place("POS", "2026-08-12T12:00:00Z", [[gadget, 4]], 40); // one gadget returned below
    await place("ONLINE", "2026-07-31T23:59:59Z", [[widget, 1]], 22); // just before the window
    await place("ONLINE", "2026-09-01T00:00:00Z", [[widget, 1]], 22); // exactly at the (exclusive) end
    await prismaUnscoped.order.create({ data: { tenantId: A.storeId, orderNumber: 9001, channel: "ONLINE", status: "PENDING", subtotal: "99", total: "99", createdAt: at("2026-08-15T12:00:00Z") } });
    await prismaUnscoped.order.create({ data: { tenantId: A.storeId, orderNumber: 9002, channel: "ONLINE", status: "CANCELLED", subtotal: "77", total: "77", createdAt: at("2026-08-15T13:00:00Z") } });
    await prismaUnscoped.customer.createMany({ data: [
      { tenantId: A.storeId, name: "In A", email: "in-a@example.com", createdAt: at("2026-08-07T10:00:00Z") },
      { tenantId: A.storeId, name: "In B", email: "in-b@example.com", createdAt: at("2026-08-20T10:00:00Z") },
      { tenantId: A.storeId, name: "Out", email: "out@example.com", createdAt: at("2026-07-01T10:00:00Z") },
    ] });

    // a whole-order refund of the online order, and a one-unit return on the in-store order
    const refund = await api("POST", `/stores/${A.storeId}/orders/${o5.id}/refund`, { token: A.token, body: {} });
    await prismaUnscoped.refund.updateMany({ where: { orderId: o5.id }, data: { createdAt: at("2026-08-12T09:00:00Z") } });
    const o6Items = await prismaUnscoped.orderItem.findMany({ where: { orderId: o6.id } });
    const ret = await api("POST", `/stores/${A.storeId}/pos/sales/${o6.id}/returns`, { token: A.token, body: { items: [{ orderItemId: o6Items[0].id, quantity: 1 }] } });
    await prismaUnscoped.orderReturn.updateMany({ where: { orderId: o6.id }, data: { createdAt: at("2026-08-13T09:00:00Z") } });
    check("setup: the refund and the return were accepted", refund.status === 200 && ret.status === 201 && ret.json.returns[0].amount === 10);
    void o1; void o2; void o3; void o4;

    const S = (q: string, token = A.token, storeId = A.storeId) => api("GET", `/stores/${storeId}/analytics/summary${q}`, { token });
    const WINDOW = "from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z";
    const r = await S(`?${WINDOW}`);
    const j = r.json;
    const ch = (name: string) => j.byChannel.find((c: { channel: string }) => c.channel === name);

    // ---- Hand-computed figures ----
    check("summary: 200 with the range, currency and generation time", r.status === 200 && j.currency === "USD" && j.range.days === 31 && !!j.generatedAt && j.cached === false);
    check("totals: 6 sales, gross 285.40 (131.00 online + 154.40 in-store)", j.totals.orders === 6 && j.totals.grossSales === 285.4 && ch("online").grossSales === 131 && ch("pos").grossSales === 154.4);
    check("totals: unpaid, cancelled-unpaid, before-window and end-of-window orders are not counted", j.totals.orders === 6);
    check("totals: refunds are 32.00 in 2 records (22.00 online whole-order, 10.00 in-store return)", j.totals.refunds.total === 32 && j.totals.refunds.count === 2 && ch("online").refunds === 22 && ch("pos").refunds === 10);
    check("totals: net sales 253.40 (109.00 online, 144.40 in-store)", j.totals.netSales === 253.4 && ch("online").netSales === 109 && ch("pos").netSales === 144.4);
    check("totals: average order value 47.57 and channel averages", j.totals.averageOrderValue === 47.57 && ch("online").averageOrderValue === 43.67 && ch("pos").averageOrderValue === 51.47);
    check("totals: discounts 6.00, tax 21.40, no shipping", j.totals.discountsGiven === 6 && j.totals.taxCollected === 21.4 && j.totals.shippingCharged === 0);
    check("channels: both channels are always listed and their shares add to 100%", j.byChannel.length === 2 && Math.abs(ch("online").shareOfNetSales + ch("pos").shareOfNetSales - 100) < 0.11 && ch("online").shareOfNetSales === 43 && ch("pos").shareOfNetSales === 57);
    check("customers: only the 2 created inside the window are new", j.totals.newCustomers === 2);
    check("products: 11 units kept (a fully refunded sale and a returned unit are left out)", j.totals.unitsSold === 11);
    const [p1, p2, p3] = j.topProducts;
    check("products: ranked by units: Widget 5, Gadget 4, Gizmo 2", p1.title === "Widget" && p1.unitsSold === 5 && p2.title === "Gadget" && p2.unitsSold === 4 && p3.title === "Gizmo" && p3.unitsSold === 2 && j.topProducts.length === 3);
    check("products: revenue before order discounts, net of returned units (Widget 100, Gadget 40, Gizmo 100)", p1.revenue === 100 && p2.revenue === 40 && p3.revenue === 100);
    check("products: units split by channel", p1.unitsOnline === 2 && p1.unitsPos === 3 && p2.unitsOnline === 1 && p2.unitsPos === 3 && p3.unitsOnline === 1 && p3.unitsPos === 1);
    check("products: margin from the recorded cost (Widget 60, Gizmo 40); null when no cost was ever recorded (Gadget)", p1.productMargin === 60 && p3.productMargin === 40 && p2.productMargin === null && j.totals.productMargin === 100 && j.totals.costCoveragePercent === 63.6);
    check("products: each has an id", j.topProducts.every((p: { productId: string }) => p.productId === widget || p.productId === gadget || p.productId === gizmo));

    // ---- Daily series ----
    const day = (d: string) => j.daily.find((x: { date: string }) => x.date === d);
    check("daily: one entry for every day, quiet days included as zeros", j.daily.length === 31 && j.daily[0].date === "2026-08-01" && j.daily[30].date === "2026-08-31" && day("2026-08-02").netSales === 0 && day("2026-08-02").online.orders === 0);
    check("daily: Aug 5 has both online orders (109.00), Aug 6 both in-store (114.40)", day("2026-08-05").online.orders === 2 && day("2026-08-05").online.grossSales === 109 && day("2026-08-06").pos.orders === 2 && day("2026-08-06").pos.grossSales === 114.4 && day("2026-08-06").online.orders === 0);
    check("daily: a refund lands on the day it is paid back, not the day of the sale", day("2026-08-10").online.grossSales === 22 && day("2026-08-10").online.refunds === 0 && day("2026-08-12").online.refunds === 22 && day("2026-08-12").online.netSales === -22 && day("2026-08-13").pos.refunds === 10 && day("2026-08-13").netSales === -10);
    check("daily: the days add up to the totals", Math.abs(j.daily.reduce((s: number, d: { netSales: number }) => s + d.netSales, 0) - j.totals.netSales) < 0.005 && j.daily.reduce((s: number, d: { online: { orders: number }; pos: { orders: number } }) => s + d.online.orders + d.pos.orders, 0) === j.totals.orders);

    // ---- An independent recomputation from the raw rows ----
    const from = at("2026-08-01T00:00:00Z");
    const to = at("2026-09-01T00:00:00Z");
    const rows = await prismaUnscoped.order.findMany({ where: { tenantId: A.storeId, createdAt: { gte: from, lt: to }, payments: { some: { status: { in: ["SUCCEEDED", "REFUNDED"] } } } } });
    const sumC = (xs: { total: unknown }[]) => xs.reduce((s, x) => s + Math.round(Number(String(x.total)) * 100), 0);
    const refundRows = [...(await prismaUnscoped.refund.findMany({ where: { tenantId: A.storeId, createdAt: { gte: from, lt: to } } })), ...(await prismaUnscoped.orderReturn.findMany({ where: { tenantId: A.storeId, createdAt: { gte: from, lt: to } } }))];
    const oracleGross = sumC(rows) / 100;
    const oracleRefunds = refundRows.reduce((s, x) => s + Math.round(Number(String(x.amount)) * 100), 0) / 100;
    check("oracle: gross, refunds, net and order count match a straight recomputation from the database", oracleGross === j.totals.grossSales && oracleRefunds === j.totals.refunds.total && Number((oracleGross - oracleRefunds).toFixed(2)) === j.totals.netSales && rows.length === j.totals.orders);

    // ---- The POS half equals the POS daily report ----
    const report = await api("GET", `/stores/${A.storeId}/pos/reports/daily?${WINDOW}`, { token: A.token });
    check("parity: the in-store figures equal the POS daily report for the same window", report.json.salesCount === ch("pos").orders && report.json.grossSales === ch("pos").grossSales && report.json.refunds.total === ch("pos").refunds && report.json.netSales === ch("pos").netSales, `${report.json.netSales} vs ${ch("pos").netSales}`);

    // ---- Time zones ----
    const east = (await S(`?${WINDOW}&tzOffsetMinutes=300`)).json;
    const eDay = (d: string) => east.daily.find((x: { date: string }) => x.date === d);
    check("timezone: at +05:00 the 23:30Z order belongs to Aug 6, and the window touches 32 local days", east.range.days === 32 && eDay("2026-08-05").online.orders === 1 && eDay("2026-08-06").online.orders === 1 && east.range.tzOffsetMinutes === 300);
    check("timezone: totals do not depend on the zone", east.totals.grossSales === j.totals.grossSales && east.totals.netSales === j.totals.netSales && east.totals.orders === j.totals.orders);
    const west = (await S(`?${WINDOW}&tzOffsetMinutes=-300`)).json;
    check("timezone: at -05:00 both online orders (10:00Z and 23:30Z) stay on Aug 5, and the window touches 32 local days (Jul 31 to Aug 31)", west.daily.find((x: { date: string }) => x.date === "2026-08-05").online.orders === 2 && west.range.days === 32 && west.daily[0].date === "2026-07-31");
    check("timezone: pure helper covers the calendar days a window touches", localDays(at("2026-08-01T00:00:00Z"), at("2026-08-02T00:00:00Z"), 0).length === 1 && localDays(at("2026-08-01T22:00:00Z"), at("2026-08-02T02:00:00Z"), 0).length === 2 && localDays(at("2026-08-01T22:00:00Z"), at("2026-08-02T02:00:00Z"), 300).length === 1);

    // ---- Empty periods, and isolation ----
    const empty = (await S("?from=2026-01-01T00:00:00Z&to=2026-01-08T00:00:00Z")).json;
    check("empty: a quiet week is zeros, both channels, 7 days, no products, not an error", empty.totals.orders === 0 && empty.totals.netSales === 0 && empty.totals.averageOrderValue === 0 && empty.byChannel.length === 2 && empty.byChannel.every((c: { shareOfNetSales: number }) => c.shareOfNetSales === 0) && empty.daily.length === 7 && empty.topProducts.length === 0 && empty.totals.costCoveragePercent === 0);
    const bView = await S(`?${WINDOW}`, B.token, B.storeId);
    check("isolation: store B sees none of store A's sales, even for the same window", bView.status === 200 && bView.json.totals.orders === 0 && bView.json.totals.grossSales === 0 && bView.json.topProducts.length === 0 && bView.json.totals.newCustomers === 0);
    check("isolation: store B's owner cannot read store A's analytics (403)", (await S(`?${WINDOW}`, B.token, A.storeId)).status === 403);

    // ---- Permissions and validation ----
    check("permissions: no token is 401", (await api("GET", `/stores/${A.storeId}/analytics/summary`)).status === 401);
    check("permissions: a cashier (pos_sell only) is 403", (await S(`?${WINDOW}`, cashier)).status === 403);
    check("permissions: staff with analytics_read can read it", (await S(`?${WINDOW}`, analyst)).status === 200);
    check("permissions: someone with no role at the store is 403", (await S(`?${WINDOW}`, outsider.token)).status === 403);
    const bad = async (q: string) => (await S(q)).status;
    check("validation: only 'from', or only 'to', is 400", (await bad("?from=2026-08-01T00:00:00Z")) === 400 && (await bad("?to=2026-08-01T00:00:00Z")) === 400);
    check("validation: 'to' not after 'from' is 400", (await bad("?from=2026-08-02T00:00:00Z&to=2026-08-01T00:00:00Z")) === 400 && (await bad("?from=2026-08-01T00:00:00Z&to=2026-08-01T00:00:00Z")) === 400);
    check("validation: more than 366 days is 400, exactly 366 is fine", (await bad("?from=2025-01-01T00:00:00Z&to=2026-01-05T00:00:00Z")) === 400 && (await bad("?from=2025-01-01T00:00:00Z&to=2026-01-02T00:00:00Z")) === 200);
    check("validation: a bad date or an out-of-range time zone is 400", (await bad("?from=nope&to=2026-08-01T00:00:00Z")) === 400 && (await bad(`?${WINDOW}&tzOffsetMinutes=900`)) === 400 && (await bad(`?${WINDOW}&tzOffsetMinutes=abc`)) === 400);

    // ---- The default window and the cache ----
    const range = resolveRange({});
    check("default: the window is the last 30 days ending on a five-minute mark", range.to.getTime() % 300000 === 0 && range.to.getTime() - range.from.getTime() === 30 * 86400000 && range.to.getTime() >= Date.now());
    await place("ONLINE", new Date().toISOString(), [[widget, 1]], 22);
    const first = await S("");
    check("default: with no dates it reports the last 30 days and includes a sale made just now (and the Sep 1 order from the scenario, which falls in the last 30 days)", first.status === 200 && first.json.cached === false && first.json.totals.orders === 2 && first.json.totals.grossSales === 44 && first.json.range.days >= 30);
    const cacheKey = `analytics:summary:${A.storeId}:${new Date(first.json.range.from).getTime()}:${new Date(first.json.range.to).getTime()}:0`;
    const ttl = await getRedis().ttl(cacheKey);
    check("cache: the first answer is stored in Redis for 5 minutes", ttl > 0 && ttl <= 300, `ttl=${ttl}`);
    await place("ONLINE", new Date().toISOString(), [[widget, 1]], 22);
    const second = await S("");
    check("cache: the next request is served from the cache (same numbers, marked cached), so a sale a moment ago is not in it yet", second.json.cached === true && second.json.totals.orders === 2 && second.json.generatedAt === first.json.generatedAt);
    await getRedis().del(cacheKey);
    check("cache: once the entry is gone (or after 5 minutes) fresh figures appear", (await S("")).json.totals.orders === 3);
    const asAnalyst = await S("", analyst);
    check("cache: analysts share the store's cache entry", asAnalyst.json.cached === true);
    check("cache: another store's default request has its own entry and its own numbers", (await S("", B.token, B.storeId)).json.totals.orders === 0);

    const redis = getRedis();
    const realGet = redis.get.bind(redis);
    const realSet = redis.set.bind(redis);
    (redis as unknown as { get: unknown }).get = async () => { throw new Error("redis is down"); };
    (redis as unknown as { set: unknown }).set = async () => { throw new Error("redis is down"); };
    const degraded = await S("");
    (redis as unknown as { get: unknown }).get = realGet;
    (redis as unknown as { set: unknown }).set = realSet;
    check("cache: if Redis is down the dashboard still answers with fresh, correct figures", degraded.status === 200 && degraded.json.cached === false && degraded.json.totals.orders === 3);

    // ---- Speed and correctness with thousands of orders ----
    const bulk = 3000;
    const startNumber = 100000;
    const day0 = at("2026-03-01T00:00:00Z").getTime();
    const orderRows = Array.from({ length: bulk }, (_, i) => ({
      id: `bulk${suffix}${i}`, tenantId: B.storeId, orderNumber: startNumber + i, channel: (i % 3 === 0 ? "POS" : "ONLINE") as "POS" | "ONLINE",
      status: (i % 3 === 0 ? "COMPLETED" : "PAID") as "COMPLETED" | "PAID", subtotal: "10.00", total: "10.00", createdAt: new Date(day0 + (i % 200) * 86400000 + (i % 24) * 3600000),
    }));
    await prismaUnscoped.order.createMany({ data: orderRows });
    await prismaUnscoped.orderItem.createMany({ data: orderRows.map((o, i) => ({ orderId: o.id, productId: "bulkproduct" + (i % 40), productTitleSnapshot: "Bulk " + (i % 40), unitPrice: "5.00", unitCostSnapshot: "2.00", quantity: 2, lineTotal: "10.00" })) });
    await prismaUnscoped.payment.createMany({ data: orderRows.map((o) => ({ tenantId: B.storeId, orderId: o.id, method: o.channel === "POS" ? ("CASH" as const) : ("STRIPE" as const), amount: "10.00", status: "SUCCEEDED" as const })) });
    const t0 = performance.now();
    const big = await S("?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z", B.token, B.storeId);
    const ms = performance.now() - t0;
    check(`speed: a 364-day report over ${bulk} orders answers in under 1.5 seconds`, big.status === 200 && ms < 1500, `${Math.round(ms)} ms`);
    check("scale: every order is counted, split 1/3 in-store and 2/3 online, and the money adds up", big.json.totals.orders === bulk && ch2(big.json, "pos").orders === 1000 && ch2(big.json, "online").orders === 2000 && big.json.totals.grossSales === 30000 && big.json.totals.unitsSold === 6000 && big.json.daily.length === 364 && big.json.topProducts.length === 10 && big.json.totals.productMargin === 18000 && big.json.totals.costCoveragePercent === 100);
    function ch2(x: any, name: string) { return x.byChannel.find((c: { channel: string }) => c.channel === name); }
    const plan = await prismaUnscoped.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN SELECT 1 FROM "Order" WHERE "tenantId" = '${B.storeId}' AND "createdAt" >= '2026-01-01' AND "createdAt" < '2026-12-31'`);
    check("speed: the order query can use an index on tenant and date", plan.some((p) => /Index/.test(p["QUERY PLAN"])), plan[0]["QUERY PLAN"].slice(0, 90));
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) {
      await getRedis().del(...(await getRedis().keys(`analytics:summary:${t}:*`)).concat("__none__"));
      await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    }
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
