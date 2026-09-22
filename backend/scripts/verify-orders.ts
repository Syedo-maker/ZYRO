/**
 * End-to-end check of Order & Shipping Management against the real local Postgres and
 * MongoDB, driven through the real HTTP API. Stripe's refund call is replaced by a
 * recording fake. Creates throwaway stores and users and removes them after.
 * Usage: npx tsx scripts/verify-orders.ts
 */
process.env.RATE_LIMIT_ENABLED = "false"; // these tests register many users quickly; verify-security.ts covers the limits
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
  const { closeRedis } = await import("../src/lib/redis");
  const { setStripeGateway } = await import("../src/lib/stripe");
  const { tenantContext } = await import("../src/lib/tenantContext");
  const { createOrder } = await import("../src/modules/commerce/order.service");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const refundCalls: { pi: string; key: string }[] = [];
  let failRefunds = false;
  setStripeGateway({
    async createCheckoutSession() {
      throw new Error("not used here");
    },
    async refundPaymentIntent(pi, key) {
      if (failRefunds) throw new Error("Stripe is down");
      refundCalls.push({ pi, key });
      return { id: `re_${key}` };
    },
    async expireCheckoutSession() {
      throw new Error("not used here");
    },
    constructEvent() {
      throw new Error("not used here");
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
    const reg = await api("POST", "/auth/register", { body: { email: `vo-${tag}-${suffix}@example.com`, password: "password123", storeName: `VO ${tag}`, storeSlug: `vo-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email: `vo-${tag}-${suffix}@example.com` };
  }

  try {
    const A = await register("a");
    const B = await register("b");
    const staffOrders = await register("so");
    const staffRefunds = await register("sr");
    const outsider = await register("out");
    const shopper = await register("shop");
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffOrders.email, permissions: ["orders_write"] } });
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffRefunds.email, permissions: ["orders_write", "refunds"] } });

    const p1 = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Widget", price: 20, stock: 30, category: "t" } })).json.id as string;
    const stockOf = async () => (await api("GET", `/stores/${A.storeId}/products/${p1}`)).json.stock as number;
    const shopperCustomer = await prismaUnscoped.customer.create({ data: { tenantId: A.storeId, userId: shopper.userId, email: shopper.email, name: "Shopper" } });

    let piCounter = 0;
    const place = (channel: "ONLINE" | "POS", qty: number, extra: Record<string, unknown> = {}) =>
      tenantContext.run(A.storeId, () =>
        createOrder({
          tenantId: A.storeId,
          channel,
          items: [{ productId: p1, quantity: qty }],
          payments:
            channel === "ONLINE"
              ? [{ method: "STRIPE", amount: 20 * qty, stripePaymentIntentId: `pi_vo_${suffix}_${++piCounter}` }]
              : [{ method: "CASH", amount: 20 * qty }],
          ...(channel === "ONLINE" && !extra.customerId ? { guestEmail: "buyer@example.com" } : {}),
          ...extra,
        } as never)
      );

    const o1 = await place("ONLINE", 2, { guestEmail: "g1@example.com" });
    const o2 = await place("ONLINE", 1, { customerId: shopperCustomer.id });
    const o3 = await place("POS", 1);
    const o4 = await place("ONLINE", 1);
    const o5 = await place("ONLINE", 1);
    const o6 = await place("ONLINE", 1);
    const o7 = await tenantContext.run(A.storeId, () =>
      createOrder({ tenantId: A.storeId, channel: "POS", items: [{ productId: p1, quantity: 1 }], payments: [{ method: "CARD", amount: 12 }, { method: "CASH", amount: 8 }] })
    );
    const o8 = await place("ONLINE", 1);
    const o9 = await place("POS", 1);
    const o10 = await place("ONLINE", 1);
    const stockAfterSetup = await stockOf();
    check("setup: 10 orders (11 units) placed, stock 30 to 19", stockAfterSetup === 19, `stock=${stockAfterSetup}`);

    // ---- Shipping zones ----
    const zBody = { name: "Standard", region: "US", rateAmount: 5.5 };
    check("zones: staff without orders_write cannot create (403)", (await api("POST", `/stores/${A.storeId}/shipping-zones`, { token: outsider.token, body: zBody })).status === 403);
    check("zones: no token is 401", (await api("POST", `/stores/${A.storeId}/shipping-zones`, { body: zBody })).status === 401);
    const zc = await api("POST", `/stores/${A.storeId}/shipping-zones`, { token: staffOrders.token, body: zBody });
    check("zones: staff with orders_write creates a zone", zc.status === 201 && zc.json.rateAmount === 5.5 && zc.json.name === "Standard");
    check("zones: negative rate is rejected", (await api("POST", `/stores/${A.storeId}/shipping-zones`, { token: A.token, body: { ...zBody, rateAmount: -1 } })).status === 400);
    check("zones: list is public (shoppers see options before checkout)", ((await api("GET", `/stores/${A.storeId}/shipping-zones`)).json as unknown[]).length === 1);
    check("zones: update", (await api("PUT", `/stores/${A.storeId}/shipping-zones/${zc.json.id}`, { token: A.token, body: { name: "Express", region: "US", rateAmount: 12 } })).json.rateAmount === 12);
    check("zones: another store's owner cannot edit (403)", (await api("PUT", `/stores/${A.storeId}/shipping-zones/${zc.json.id}`, { token: B.token, body: zBody })).status === 403);
    check("zones: unknown zone is 404", (await api("PUT", `/stores/${A.storeId}/shipping-zones/nope`, { token: A.token, body: zBody })).status === 404);
    check("zones: delete then delete again", (await api("DELETE", `/stores/${A.storeId}/shipping-zones/${zc.json.id}`, { token: A.token })).status === 204 && (await api("DELETE", `/stores/${A.storeId}/shipping-zones/${zc.json.id}`, { token: A.token })).status === 404);

    // ---- Order list ----
    check("orders: no token is 401", (await api("GET", `/stores/${A.storeId}/orders`)).status === 401);
    check("orders: a user with no role in the store gets 403", (await api("GET", `/stores/${A.storeId}/orders`, { token: outsider.token })).status === 403);
    const all = await api("GET", `/stores/${A.storeId}/orders?limit=100`, { token: staffOrders.token });
    check("orders: staff with orders_write lists all 10, newest first", all.status === 200 && all.json.pagination.total === 10 && all.json.data[0].orderNumber === 10);
    const first = all.json.data.find((o: any) => o.orderNumber === 1);
    check("orders: lowercase enums and money as numbers", first.channel === "online" && first.status === "paid" && first.total === 40 && first.items[0].productTitleSnapshot === "Widget" && first.payments[0].method === "stripe");
    const pos = await api("GET", `/stores/${A.storeId}/orders?channel=pos&limit=100`, { token: A.token });
    check("orders: channel filter (3 POS orders)", pos.json.pagination.total === 3 && pos.json.data.every((o: any) => o.channel === "pos"));
    check("orders: status filter", (await api("GET", `/stores/${A.storeId}/orders?status=completed`, { token: A.token })).json.pagination.total === 3);
    check("orders: search by order number", (await api("GET", `/stores/${A.storeId}/orders?q=4`, { token: A.token })).json.data.some((o: any) => o.orderNumber === 4));
    check("orders: search by email fragment, case-insensitive", (await api("GET", `/stores/${A.storeId}/orders?q=G1@EXAMPLE`, { token: A.token })).json.data.length === 1);
    check("orders: search matches a linked customer's email", (await api("GET", `/stores/${A.storeId}/orders?q=${encodeURIComponent(shopper.email)}`, { token: A.token })).json.data.length === 1);
    check("orders: date range in the future finds nothing", (await api("GET", `/stores/${A.storeId}/orders?from=2099-01-01`, { token: A.token })).json.pagination.total === 0);
    const page = await api("GET", `/stores/${A.storeId}/orders?limit=3&offset=3`, { token: A.token });
    check("orders: pagination", page.json.data.length === 3 && page.json.pagination.offset === 3 && page.json.data[0].orderNumber === 7);
    check("orders: invalid filter is 400", (await api("GET", `/stores/${A.storeId}/orders?status=bogus`, { token: A.token })).status === 400);
    check("orders: another store's owner sees none of them", (await api("GET", `/stores/${B.storeId}/orders`, { token: B.token })).json.pagination.total === 0);

    // ---- Order detail ----
    check("detail: merchant sees any order with payments", (await api("GET", `/stores/${A.storeId}/orders/${o1.id}`, { token: A.token })).json.payments.length === 1);
    check("detail: a shopper sees their own order", (await api("GET", `/stores/${A.storeId}/orders/${o2.id}`, { token: shopper.token })).status === 200);
    check("detail: a shopper cannot see someone else's order (404, not 403)", (await api("GET", `/stores/${A.storeId}/orders/${o1.id}`, { token: shopper.token })).status === 404);
    check("detail: another store's owner cannot see it either", (await api("GET", `/stores/${A.storeId}/orders/${o1.id}`, { token: B.token })).status === 404);
    check("detail: unknown order is 404", (await api("GET", `/stores/${A.storeId}/orders/nope`, { token: A.token })).status === 404);

    // ---- Status ----
    const patch = (id: string, status: string, token = A.token) => api("PATCH", `/stores/${A.storeId}/orders/${id}/status`, { token, body: { status } });
    const ful = await patch(o1.id, "fulfilled");
    check("status: paid to fulfilled", ful.status === 200 && ful.json.status === "fulfilled");
    check("status: fulfilling again is 409", (await patch(o1.id, "fulfilled")).status === 409);
    check("status: refunded cannot be set by hand (400)", (await patch(o2.id, "refunded")).status === 400);
    check("status: completed cannot be set by hand (400)", (await patch(o2.id, "completed")).status === 400);
    check("status: nonsense is 400", (await patch(o2.id, "shipped")).status === 400);
    check("status: a shipped-out (fulfilled) order cannot be cancelled (409)", (await patch(o1.id, "cancelled")).status === 409);
    check("status: a POS order cannot be fulfilled or cancelled by hand (409)", (await patch(o3.id, "fulfilled")).status === 409 && (await patch(o3.id, "cancelled")).status === 409);

    // ---- Cancel a paid order = refund + restock ----
    const stockBeforeCancel = await stockOf();
    check("cancel: staff without the refunds permission cannot cancel a paid order (403)", (await patch(o4.id, "cancelled", staffOrders.token)).status === 403);
    const canc = await patch(o4.id, "cancelled", staffRefunds.token);
    const o4Payment = await prismaUnscoped.payment.findFirst({ where: { orderId: o4.id } });
    check("cancel: order becomes cancelled, payment refunded, one refund record", canc.json.status === "cancelled" && canc.json.payments[0].status === "refunded" && canc.json.refunds.length === 1);
    check("cancel: Stripe refunded once with a per-payment idempotency key", refundCalls.length === 1 && refundCalls[0].key === `refund-order-${o4.id}-${o4Payment!.id}` && canc.json.refunds[0].method === "stripe");
    check("cancel: stock went back on the shelf (+1)", (await stockOf()) === stockBeforeCancel + 1);
    check("cancel: cancelling again is 409", (await patch(o4.id, "cancelled", staffRefunds.token)).status === 409);

    // ---- Refunds ----
    const refund = (id: string, body: unknown = {}, token = A.token) => api("POST", `/stores/${A.storeId}/orders/${id}/refund`, { token, body });
    check("refund: staff with only orders_write is forbidden (403)", (await refund(o5.id, {}, staffOrders.token)).status === 403);

    const stockBeforePos = await stockOf();
    const rPos = await refund(o3.id);
    check("refund: POS cash sale is refunded with no Stripe call", rPos.status === 200 && rPos.json.status === "refunded" && rPos.json.refunds[0].method === "cash" && refundCalls.length === 1);
    check("refund: a completed sale is not restocked unless asked (goods left the shop)", (await stockOf()) === stockBeforePos && rPos.json.refunds[0].restocked === false);

    const rSplit = await refund(o7.id, { restock: true, reason: "Customer returned it" });
    check("refund: split payment (card + cash) makes one refund per payment", rSplit.json.refunds.length === 2 && rSplit.json.refunds.every((r: any) => r.reason === "Customer returned it"));
    check("refund: restock true puts the item back (+1)", (await stockOf()) === stockBeforePos + 1);
    check("refund: refunding again is 409", (await refund(o7.id)).status === 409);

    const rShipped = await refund(o1.id);
    check("refund: a fulfilled online order refunds via Stripe, not restocked by default", rShipped.json.status === "refunded" && refundCalls.length === 2 && rShipped.json.refunds[0].restocked === false);

    const stockBeforeRace = await stockOf();
    const race = await Promise.all([refund(o5.id), refund(o5.id)]);
    const codes = race.map((r) => r.status).sort();
    const o5Refunds = await prismaUnscoped.refund.count({ where: { orderId: o5.id } });
    check("refund: two simultaneous refunds of one order: exactly one wins", codes[0] === 200 && codes[1] === 409, codes.join("+"));
    check("refund: only one refund record and stock restored once", o5Refunds === 1 && (await stockOf()) === stockBeforeRace + 1);

    failRefunds = true;
    const failed = await refund(o6.id);
    const o6After = await prismaUnscoped.order.findUnique({ where: { id: o6.id } });
    check("refund: if Stripe fails, the order is untouched and nothing is recorded", failed.status === 500 && o6After?.status === "PAID" && (await prismaUnscoped.refund.count({ where: { orderId: o6.id } })) === 0);
    failRefunds = false;
    check("refund: retrying after Stripe recovers succeeds", (await refund(o6.id)).status === 200);

    // ---- Shipments ----
    const ship = (id: string, body: unknown, token = A.token) => api("PUT", `/stores/${A.storeId}/orders/${id}/shipment`, { token, body });
    check("shipment: POS orders have no shipment (409)", (await ship(o9.id, { status: "shipped" })).status === 409);
    check("shipment: empty body is 400", (await ship(o8.id, {})).status === 400);
    check("shipment: a new shipment cannot start as delivered (409)", (await ship(o8.id, { status: "delivered" })).status === 409);
    const shipped = await ship(o8.id, { carrier: "DHL", trackingNumber: "T-100", status: "shipped" });
    check("shipment: shipping marks the order fulfilled and stamps shippedAt", shipped.status === 200 && shipped.json.status === "fulfilled" && shipped.json.shipment.status === "shipped" && !!shipped.json.shipment.shippedAt && shipped.json.shipment.trackingNumber === "T-100");
    const delivered = await ship(o8.id, { status: "delivered" });
    check("shipment: delivered stamps deliveredAt and keeps carrier", delivered.json.shipment.status === "delivered" && !!delivered.json.shipment.deliveredAt && delivered.json.shipment.carrier === "DHL");
    check("shipment: delivered cannot go back to pending (409)", (await ship(o8.id, { status: "pending" })).status === 409);
    check("shipment: another store's owner cannot update it (403)", (await ship(o8.id, { carrier: "X" }, B.token)).status === 403);
    check("shipment: a refunded order cannot be shipped (409)", (await ship(o1.id, { status: "shipped" })).status === 409);

    const pending = await ship(o10.id, { carrier: "UPS" });
    check("shipment: carrier-only creates a pending shipment, order stays paid", pending.json.shipment.status === "pending" && pending.json.status === "paid");
    const cancelled10 = await patch(o10.id, "cancelled", staffRefunds.token);
    check("cancel: a pending shipment is cancelled with the order", cancelled10.json.shipment.status === "cancelled");

    // ---- Consistency ----
    const movements = await prismaUnscoped.stockMovement.findMany({ where: { tenantId: A.storeId, productId: p1 } });
    const ledger = movements.reduce((s, m) => s + m.quantityChange, 0);
    check("ledger: stock movements still add up to the current stock", ledger === (await stockOf()), `ledger=${ledger} stock=${await stockOf()}`);
    check("isolation: store B has no refunds, shipments or orders of store A", (await prismaUnscoped.refund.count({ where: { tenantId: B.storeId } })) === 0 && (await prismaUnscoped.order.count({ where: { tenantId: B.storeId } })) === 0);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
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
