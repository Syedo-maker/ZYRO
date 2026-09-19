/**
 * End-to-end check of Cart & Checkout against the real local Postgres, MongoDB and Redis,
 * driven through the real HTTP API. Stripe's network calls (create session, refund) are
 * replaced by a recording fake; webhook signature verification uses the real Stripe SDK
 * code path with a test secret. Creates throwaway stores and removes them after.
 * Usage: npx tsx scripts/verify-checkout.ts   (Redis must be running on REDIS_URL)
 */
process.env.STRIPE_SECRET_KEY = "sk_test_verifyonly";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_verifyonly";

import type { AddressInfo } from "node:net";
import Stripe from "stripe";

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
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  // Fake Stripe network calls; keep the real signature verification.
  const stripeCalls = { sessions: [] as any[], refunds: [] as { pi: string; key: string }[] };
  const realGateway = getStripeGateway();
  let sessionCounter = 0;
  setStripeGateway({
    ...realGateway,
    async createCheckoutSession(params) {
      stripeCalls.sessions.push(params);
      sessionCounter++;
      return { id: `cs_test_verify_${Date.now()}_${sessionCounter}`, url: `https://checkout.stripe.test/pay/${sessionCounter}` };
    },
    async refundPaymentIntent(pi, key) {
      stripeCalls.refunds.push({ pi, key });
    },
  });

  const signer = new Stripe("sk_test_verifyonly");
  async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.guest) headers["X-Guest-Session-Id"] = opts.guest;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }
  async function sendEvent(type: string, session: object, opts: { badSignature?: boolean; noSignature?: boolean } = {}) {
    const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, data: { object: session } });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!opts.noSignature) {
      headers["Stripe-Signature"] = signer.webhooks.generateTestHeaderString({
        payload,
        secret: opts.badSignature ? "whsec_wrong" : "whsec_verifyonly",
      });
    }
    const res = await fetch(`${base}/webhooks/stripe`, { method: "POST", headers, body: payload });
    return { status: res.status, json: await res.json() };
  }
  const paidSession = (id: string, totalCents: number, extra: object = {}) => ({
    id,
    object: "checkout.session",
    payment_status: "paid",
    amount_total: totalCents,
    currency: "usd",
    payment_intent: `pi_${id}`,
    customer_details: { email: "shopper@example.com", name: "Sam Shopper" },
    ...extra,
  });

  const suffix = Date.now().toString(36);
  const guest = `guest-${suffix}-abcdefgh`;
  const created: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

  async function newStore(tag: string) {
    const email = `verify-co-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-co-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }
  const addProduct = async (s: { token: string; storeId: string }, title: string, price: number, stock: number) =>
    (await api("POST", `/stores/${s.storeId}/products`, { token: s.token, body: { title, price, stock, category: "test" } })).json.id as string;
  const stockOf = async (s: { storeId: string }, id: string) => (await api("GET", `/stores/${s.storeId}/products/${id}`)).json.stock as number;

  try {
    const A = await newStore("a");
    const B = await newStore("b");
    await prismaUnscoped.tenant.update({ where: { id: A.storeId }, data: { taxRate: "10" } });
    const zone = await prismaUnscoped.shippingZone.create({ data: { tenantId: A.storeId, name: "Standard", region: "US", rateAmount: "5" } });
    const p1 = await addProduct(A, "Widget", 20, 5);
    const p2 = await addProduct(A, "Gadget", 10, 3);

    // ---- Cart ----
    check("cart: no bearer token or guest id is rejected", (await api("GET", `/stores/${A.storeId}/cart`)).status === 400);
    check("cart: invalid bearer token is rejected, not treated as a guest", (await api("GET", `/stores/${A.storeId}/cart`, { token: "nope" })).status === 401);
    const empty = await api("GET", `/stores/${A.storeId}/cart`, { guest });
    check("cart: a new guest cart is empty", empty.status === 200 && empty.json.items.length === 0 && empty.json.subtotal === 0);

    let cart = await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 2 } });
    check("cart: add item, subtotal from live price", cart.status === 200 && cart.json.subtotal === 40 && cart.json.items[0].title === "Widget");
    cart = await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 2 } });
    check("cart: adding again accumulates quantity (2 + 2 = 4)", cart.json.items[0].quantity === 4);
    check("cart: adding beyond stock is rejected (409)", (await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 3 } })).status === 409);
    check("cart: update to exact quantity", (await api("PATCH", `/stores/${A.storeId}/cart/items/${p1}`, { guest, body: { quantity: 5 } })).json.items[0].quantity === 5);
    check("cart: update beyond stock is rejected (409)", (await api("PATCH", `/stores/${A.storeId}/cart/items/${p1}`, { guest, body: { quantity: 6 } })).status === 409);
    check("cart: unknown product is 404", (await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: "64b7f0f0f0f0f0f0f0f0f0f0", quantity: 1 } })).status === 404);
    check("cart: zero quantity fails validation", (await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 0 } })).status === 400);

    const redisKey = `cart:${A.storeId}:g:${guest}`;
    const raw = await getRedis().hgetall(redisKey);
    const ttl = await getRedis().ttl(redisKey);
    check("cart: Redis stores only productId to quantity, never prices", JSON.stringify(raw) === JSON.stringify({ [p1]: "5" }));
    check("cart: has a TTL of up to 7 days", ttl > 0 && ttl <= 604800, `ttl=${ttl}`);

    await Product.updateOne({ _id: p1, storeId: A.storeId }, { price: 25 });
    check("cart: a later price change shows immediately (price is never cached in the cart)", (await api("GET", `/stores/${A.storeId}/cart`, { guest })).json.subtotal === 125);
    await Product.updateOne({ _id: p1, storeId: A.storeId }, { price: 20 });

    check("cart: store B cannot add store A's product", (await api("POST", `/stores/${B.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 1 } })).status === 404);
    check("cart: same guest id in store B sees an empty cart", (await api("GET", `/stores/${B.storeId}/cart`, { guest })).json.items.length === 0);

    await api("DELETE", `/stores/${A.storeId}/cart/items/${p1}`, { guest });
    check("cart: remove item empties the cart", (await api("GET", `/stores/${A.storeId}/cart`, { guest })).json.items.length === 0);

    // ---- Checkout session ----
    check("checkout: empty cart is rejected", (await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: {} })).status === 400);
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 2 } });
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p2, quantity: 1 } });
    check("checkout: discount codes are refused until Phase 3", (await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: { discountCode: "SALE10" } })).status === 400);
    check("checkout: unknown shipping zone is 404", (await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: { shippingZoneId: "nope" } })).status === 404);

    const session1 = await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: { shippingZoneId: zone.id } });
    check("checkout: session created, returns Stripe URL", session1.status === 201 && String(session1.json.checkoutUrl).startsWith("https://checkout.stripe.test/"));
    const sent = stripeCalls.sessions[0];
    const lineSum = sent.lineItems.reduce((s: number, l: any) => s + l.unitAmountCents * l.quantity, 0) + sent.shipping.amountCents;
    check("checkout: Stripe is sent line items + tax line + shipping that add up to the priced total (6000)", lineSum === 6000, `sum=${lineSum}`);
    check("checkout: Stripe call carries no payment method list, only our ids", !("payment_method_types" in sent) && sent.tenantId === A.storeId);
    const rec1 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId }, orderBy: { createdAt: "asc" } });
    check("checkout: snapshot saved as PENDING with the total", rec1?.status === "PENDING" && rec1.totalCents === 6000 && !!rec1.stripeSessionId);
    const sid1 = rec1!.stripeSessionId!;

    // ---- Webhook: signature ----
    check("webhook: missing signature is 400", (await sendEvent("checkout.session.completed", paidSession(sid1, 6000), { noSignature: true })).status === 400);
    check("webhook: wrong signature is 400 and creates nothing", (await sendEvent("checkout.session.completed", paidSession(sid1, 6000), { badSignature: true })).status === 400 && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === 0);

    // ---- Webhook: fulfilment uses the snapshot, not today's prices ----
    await Product.updateOne({ _id: p1, storeId: A.storeId }, { price: 99 });
    const done = await sendEvent("checkout.session.completed", paidSession(sid1, 6000));
    check("webhook: paid session is fulfilled", done.status === 200 && done.json.outcome === "fulfilled", JSON.stringify(done.json));
    const order = await prismaUnscoped.order.findFirst({ where: { tenantId: A.storeId }, include: { items: true, payments: true } });
    check("order: ONLINE, PAID, number 1, total 60.00 as charged", order?.channel === "ONLINE" && order.status === "PAID" && order.orderNumber === 1 && order.total.toString() === "60", `total=${order?.total}`);
    check("order: line price is the snapshot (20), not the later catalog price (99)", order?.items.find((i) => i.productId === p1)?.unitPrice.toString() === "20");
    check("order: subtotal 50, tax 5, shipping 5", order?.subtotal.toString() === "50" && order.taxAmount.toString() === "5" && order.shippingAmount.toString() === "5");
    check("order: one STRIPE payment with the payment intent id", order?.payments.length === 1 && order.payments[0].method === "STRIPE" && order.payments[0].stripePaymentIntentId === `pi_${sid1}`);
    check("stock: deducted (widget 5 to 3, gadget 3 to 2)", (await stockOf(A, p1)) === 3 && (await stockOf(A, p2)) === 2);
    check("customer: guest email became a tenant-scoped customer", (await prismaUnscoped.customer.count({ where: { tenantId: A.storeId, email: "shopper@example.com" } })) === 1 && order?.customerId !== null);
    check("cart: cleared after the order is created", (await api("GET", `/stores/${A.storeId}/cart`, { guest })).json.items.length === 0);
    await Product.updateOne({ _id: p1, storeId: A.storeId }, { price: 20 });

    // ---- Webhook: idempotency ----
    const replay = await sendEvent("checkout.session.completed", paidSession(sid1, 6000));
    check("webhook: replaying the same event is a no-op", replay.json.outcome === "already-processed" && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === 1 && (await stockOf(A, p1)) === 3);

    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p2, quantity: 1 } });
    await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: {} });
    const rec2 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, status: "PENDING" } });
    const sid2 = rec2!.stripeSessionId!;
    const cents2 = rec2!.totalCents;
    const [d1, d2] = await Promise.all([
      sendEvent("checkout.session.completed", paidSession(sid2, cents2)),
      sendEvent("checkout.session.completed", paidSession(sid2, cents2)),
    ]);
    const outcomes = [d1.json.outcome, d2.json.outcome].sort();
    check("webhook: the same event delivered twice at once creates exactly one order", outcomes.includes("fulfilled") && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === 2, outcomes.join("+"));
    check("stock: double delivery deducted only once (gadget 2 to 1)", (await stockOf(A, p2)) === 1);

    // ---- Webhook: async payment, mismatch, unknown, expiry ----
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p2, quantity: 1 } });
    await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: {} });
    const rec3 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, status: "PENDING" } });
    const sid3 = rec3!.stripeSessionId!;
    const unpaid = await sendEvent("checkout.session.completed", paidSession(sid3, rec3!.totalCents, { payment_status: "unpaid" }));
    check("webhook: unpaid (delayed payment method) does not create an order yet", unpaid.json.outcome === "ignored" && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === 2);
    const mismatch = await sendEvent("checkout.session.async_payment_succeeded", paidSession(sid3, rec3!.totalCents + 100));
    check("webhook: a charged amount that differs from the priced cart is refused", mismatch.json.outcome === "marked-failed" && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === 2);

    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p2, quantity: 1 } });
    await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: {} });
    const rec4 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, status: "PENDING" } });
    const sid4 = rec4!.stripeSessionId!;
    await sendEvent("checkout.session.completed", paidSession(sid4, rec4!.totalCents, { payment_status: "unpaid" }));
    const later = await sendEvent("checkout.session.async_payment_succeeded", paidSession(sid4, rec4!.totalCents));
    check("webhook: async_payment_succeeded fulfils the order", later.json.outcome === "fulfilled" && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === 3);

    check("webhook: unknown event types and unknown sessions are acknowledged and ignored", (await sendEvent("customer.created", { id: "cus_1" })).json.outcome === "ignored" && (await sendEvent("checkout.session.completed", paidSession("cs_not_ours", 100))).json.outcome === "ignored");

    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 1 } });
    await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: {} });
    const rec5 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, status: "PENDING" } });
    const expired = await sendEvent("checkout.session.expired", { id: rec5!.stripeSessionId });
    check("webhook: expired session is closed", expired.json.outcome === "marked-expired" && (await prismaUnscoped.checkoutSession.findUnique({ where: { id: rec5!.id } }))?.status === "EXPIRED");

    // ---- Out of stock after payment: automatic refund ----
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: p1, quantity: 3 } });
    await api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body: {} });
    const rec6 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, status: "PENDING" } });
    const sid6 = rec6!.stripeSessionId!;
    const { createOrder } = await import("../src/modules/commerce/order.service");
    const { tenantContext } = await import("../src/lib/tenantContext");
    await tenantContext.run(A.storeId, () => createOrder({ tenantId: A.storeId, channel: "POS", items: [{ productId: p1, quantity: 3 }], payments: [{ method: "CASH", amount: 66 }] }));
    check("setup: a POS sale takes the last widgets while the shopper is paying", (await stockOf(A, p1)) === 0);
    const ordersBefore = await prismaUnscoped.order.count({ where: { tenantId: A.storeId } });
    const refunded = await sendEvent("checkout.session.completed", paidSession(sid6, rec6!.totalCents));
    check("webhook: stock gone after payment gives an automatic refund", refunded.json.outcome === "refunded-out-of-stock" && stripeCalls.refunds.length === 1 && stripeCalls.refunds[0].pi === `pi_${sid6}` && stripeCalls.refunds[0].key === `refund-${rec6!.id}`);
    check("webhook: no order was created and the record shows REFUNDED", (await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })) === ordersBefore && (await prismaUnscoped.checkoutSession.findUnique({ where: { id: rec6!.id } }))?.status === "REFUNDED");
    const again = await sendEvent("checkout.session.completed", paidSession(sid6, rec6!.totalCents));
    check("webhook: a retry after the refund does not refund twice", again.json.outcome === "already-processed" && stripeCalls.refunds.length === 1);

    // ---- Logged-in shopper ----
    const shopper = await api("POST", "/auth/register", { body: { email: `shopper-${suffix}@example.com`, password: "password123", storeName: "Shopper Store", storeSlug: `verify-co-s-${suffix}` } });
    created.userIds.push(shopper.json.user.id);
    const shopperStore = await prismaUnscoped.tenant.findUnique({ where: { slug: `verify-co-s-${suffix}` } });
    created.tenantIds.push(shopperStore!.id);
    await api("PUT", `/stores/${A.storeId}/products/${p1}`, { token: A.token, body: { title: "Widget", price: 20, stock: 4, category: "test" } });
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: shopper.json.accessToken, body: { productId: p1, quantity: 1 } });
    check("cart: logged-in cart is separate from the guest cart", (await api("GET", `/stores/${A.storeId}/cart`, { guest })).json.items.length === 1 && (await getRedis().exists(`cart:${A.storeId}:u:${shopper.json.user.id}`)) === 1);
    await api("POST", `/stores/${A.storeId}/checkout/session`, { token: shopper.json.accessToken, body: {} });
    check("checkout: logged-in shopper's email is passed to Stripe", stripeCalls.sessions.at(-1).customerEmail === `shopper-${suffix}@example.com`);
    const rec7 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, status: "PENDING", userId: shopper.json.user.id } });
    const paid7 = await sendEvent("checkout.session.completed", paidSession(rec7!.stripeSessionId!, rec7!.totalCents, { customer_details: { email: `shopper-${suffix}@example.com`, name: "Shopper" } }));
    const order7 = await prismaUnscoped.order.findFirst({ where: { tenantId: A.storeId, customerId: { not: null } }, orderBy: { createdAt: "desc" }, include: { customer: true } });
    check("order: logged-in shopper is linked to their customer record", paid7.json.outcome === "fulfilled" && order7?.customer?.userId === shopper.json.user.id && order7.guestEmail === null);

    check("tenant isolation: store B has no checkout sessions or customers of store A", (await prismaUnscoped.checkoutSession.count({ where: { tenantId: B.storeId } })) === 0 && (await prismaUnscoped.customer.count({ where: { tenantId: B.storeId } })) === 0);
  } finally {
    const keys = await getRedis().keys("cart:*");
    const mine = keys.filter((k) => created.tenantIds.some((t) => k.startsWith(`cart:${t}:`)));
    if (mine.length) await getRedis().del(...mine);
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
