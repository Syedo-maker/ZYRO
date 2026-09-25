/**
 * End-to-end check of Module 7 (remaining), Abandoned-Cart Recovery (Implementation_Plan.md
 * Phase 5): the scan correctly tells an old-enough abandoned cart from a fresh one (by the
 * cart's own Redis TTL, with no separate "last activity" field needed), sends a personalized
 * email exactly once per cooldown window, skips guest carts, empty carts, and carts that
 * already converted, spends AI quota and skips gracefully when it is exhausted, marks a SENT
 * event CONVERTED once its shopper places an order, and the merchant-facing performance summary.
 * Fake AI and email gateways stand in for the real network calls (the same pattern
 * verify-discounts.ts uses for Stripe). Creates throwaway stores and users and removes them after.
 * Usage: npx tsx scripts/verify-cart-recovery.ts   (Redis must be running on REDIS_URL)
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_MONTHLY_GENERATIONS_LIMIT = "10";
process.env.SENDGRID_API_KEY = "SG.verify-fake";
process.env.SENDGRID_FROM_EMAIL = "orders@verify.example";
// Isolated BullMQ queues, so this script's own fake gateways are what actually answer, even if
// a real backend or e2e-server.ts happens to be running against the same Redis (see the
// AI_QUEUE_NAME comment in lib/aiQueue.ts; cart recovery has the same hazard).
process.env.AI_QUEUE_NAME = `ai-generate-verify-${Date.now().toString(36)}`;
process.env.CART_RECOVERY_QUEUE_NAME = `cart-recovery-verify-${Date.now().toString(36)}`;

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
  const { env } = await import("../src/config/env");
  const { closeRedis, getRedis } = await import("../src/lib/redis");
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { setEmailGateway } = await import("../src/lib/email");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { closeCartRecoveryQueue } = await import("../src/lib/cartRecoveryQueue");
  const { cartRecoveryService } = await import("../src/modules/cart-recovery/cartRecovery.service");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  startAiWorker();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.guest) headers["X-Guest-Session-Id"] = opts.guest;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function merchant(tag: string) {
    const email = `verify-cr-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-cr-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }
  async function customer(tag: string) {
    const email = `verify-cr-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register-customer", { body: { email, password: "password123" } });
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, userId: reg.json.user.id as string, email };
  }

  let nextReply = "You left some great items in your cart - come back and grab them!";
  const aiCalls: { system: string; prompt: string }[] = [];
  setAiProvider({
    async generate(params) {
      aiCalls.push({ system: params.system, prompt: params.prompt });
      return { text: nextReply, model: "fake-model-1", inputTokens: 10, outputTokens: 5 };
    },
  });
  let failNextEmail = false;
  const emails: { to: string; subject: string; text: string }[] = [];
  setEmailGateway({
    async send(message) {
      if (failNextEmail) {
        failNextEmail = false;
        throw new Error("fake SendGrid failure (deliberate, for the verify script)");
      }
      emails.push(message);
    },
  });

  const redis = getRedis();
  /** Ages a cart's Redis key so it looks like it has been untouched for `hoursAgo` hours,
   *  without waiting - the same trick cartRecovery.service.ts's own TTL-based inference allows. */
  const age = (key: string, hoursAgo: number) => redis.expire(key, Math.max(1, env.cartTtlSeconds - hoursAgo * 60 * 60));
  const userCartKey = (storeId: string, userId: string) => `cart:${storeId}:u:${userId}`;

  try {
    const A = await merchant("a");
    const B = await merchant("b");
    const staffNoPerm = { email: `verify-cr-staff-${suffix}@example.com`, password: "password123" };
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffNoPerm.email, password: staffNoPerm.password, permissions: ["orders_write"] } });
    const staffToken = (await api("POST", "/auth/login", { body: { email: staffNoPerm.email, password: staffNoPerm.password } })).json.accessToken as string;

    const mk = async (owner: { token: string; storeId: string }, title: string, price: number) =>
      (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price, stock: 10, category: "misc" } })).json.id as string;
    const mug = await mk(A, "Ceramic Mug", 12.5);

    // ---- A fresh cart is not touched ----
    const c1 = await customer("c1");
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: c1.token, body: { productId: mug, quantity: 2 } });
    const c1Key = userCartKey(A.storeId, c1.userId);
    await cartRecoveryService.scan();
    check("scan: a cart added moments ago is not recovered yet (still within the freshness window)", (await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: c1Key } })) === null);

    // ---- The same cart, aged past the threshold, gets a real recovery email ----
    await age(c1Key, env.cartRecovery.abandonedAfterHours + 1);
    await cartRecoveryService.scan();
    const event1 = await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: c1Key } });
    check("scan: an abandoned cart is emailed, and the event is logged as SENT", event1?.status === "SENT" && event1?.customerEmail === c1.email);
    check("email: sent to the shopper's real account email, with a subject naming the store", emails.some((e) => e.to === c1.email && e.subject.includes("Verify a")));
    check("email: the body is the AI's personalized text", emails.some((e) => e.to === c1.email && e.text === nextReply));
    check("ai: the prompt lists the real cart contents (2x Ceramic Mug), not invented items", aiCalls.some((c) => /2x Ceramic Mug/.test(c.prompt)));

    // ---- The same still-abandoned cart is not emailed again immediately (cooldown) ----
    const sentBefore = emails.length;
    await cartRecoveryService.scan();
    check("scan: the same cart is not emailed twice within the cooldown window", emails.length === sentBefore && (await prismaUnscoped.cartRecoveryEvent.count({ where: { tenantId: A.storeId, cartId: c1Key } })) === 1);

    // ---- A guest cart is never recovered: there is no email address to send to ----
    const guestId = `verify-cr-guest-${suffix}aaaaaaaaaaaa`;
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest: guestId, body: { productId: mug, quantity: 1 } });
    await age(`cart:${A.storeId}:g:${guestId}`, env.cartRecovery.abandonedAfterHours + 1);
    const sentBeforeGuest = emails.length;
    await cartRecoveryService.scan();
    check("scan: a guest's abandoned cart is skipped entirely (no email address exists for it)", emails.length === sentBeforeGuest);

    // ---- An abandoned but emptied cart is skipped ----
    const c2 = await customer("c2");
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: c2.token, body: { productId: mug, quantity: 1 } });
    await api("DELETE", `/stores/${A.storeId}/cart/items/${mug}`, { token: c2.token });
    await age(userCartKey(A.storeId, c2.userId), env.cartRecovery.abandonedAfterHours + 1);
    await cartRecoveryService.scan();
    check("scan: a cart that was emptied (not just aged) is not recovered", (await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: userCartKey(A.storeId, c2.userId) } })) === null);

    // ---- A discount code, when one is active, is mentioned in the prompt ----
    await api("POST", `/stores/${A.storeId}/discount-codes`, { token: A.token, body: { code: "COMEBACK10", type: "percentage", value: 10 } });
    const c3 = await customer("c3");
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: c3.token, body: { productId: mug, quantity: 3 } });
    await age(userCartKey(A.storeId, c3.userId), env.cartRecovery.abandonedAfterHours + 1);
    await cartRecoveryService.scan();
    const event3 = await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: userCartKey(A.storeId, c3.userId) } });
    check("scan: an active discount code is recorded on the event and mentioned in the AI's prompt", event3?.discountCodeId !== null && aiCalls.some((c) => /COMEBACK10/.test(c.prompt)));

    // ---- A failed send costs nothing: no event is logged ----
    const c4 = await customer("c4");
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: c4.token, body: { productId: mug, quantity: 1 } });
    await age(userCartKey(A.storeId, c4.userId), env.cartRecovery.abandonedAfterHours + 1);
    failNextEmail = true;
    await cartRecoveryService.scan();
    check("scan: a failed send (SendGrid rejects it) logs nothing, so a later scan can retry", (await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: userCartKey(A.storeId, c4.userId) } })) === null);
    await cartRecoveryService.scan(); // the retry succeeds now that failNextEmail has been consumed
    check("scan: the retry on the next scan succeeds", (await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: userCartKey(A.storeId, c4.userId) } }))?.status === "SENT");

    // ---- Quota exhaustion: the scan skips gracefully, it does not crash or fall back to a generic email ----
    const usage = await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token });
    for (let i = usage.json.generationsUsed; i < usage.json.generationsLimit; i++) {
      const cN = await customer(`quota-filler-${i}`);
      await api("POST", `/stores/${A.storeId}/cart/items`, { token: cN.token, body: { productId: mug, quantity: 1 } });
      await age(userCartKey(A.storeId, cN.userId), env.cartRecovery.abandonedAfterHours + 1);
      await cartRecoveryService.scan();
    }
    check("quota: store A's generations are now used up", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed >= usage.json.generationsLimit);
    const c5 = await customer("c5");
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: c5.token, body: { productId: mug, quantity: 1 } });
    await age(userCartKey(A.storeId, c5.userId), env.cartRecovery.abandonedAfterHours + 1);
    const emailsBeforeExhausted = emails.length;
    await cartRecoveryService.scan();
    check("quota: once exhausted, an abandoned cart is skipped (no email, no event), not sent unpersonalized", emails.length === emailsBeforeExhausted && (await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: userCartKey(A.storeId, c5.userId) } })) === null);

    // ---- Conversion: placing an order after a SENT event marks it CONVERTED ----
    const { tenantContext } = await import("../src/lib/tenantContext");
    const { createOrder } = await import("../src/modules/commerce/order.service");
    const custRecord = await prismaUnscoped.customer.create({ data: { tenantId: A.storeId, userId: c1.userId, email: c1.email, name: "C1" } });
    await tenantContext.run(A.storeId, () =>
      createOrder({ tenantId: A.storeId, channel: "ONLINE", customerId: custRecord.id, items: [{ productId: mug, quantity: 1 }], payments: [{ method: "STRIPE", amount: 12.5, stripePaymentIntentId: `pi_cr_${suffix}` }] })
    );
    await cartRecoveryService.scan();
    const event1After = await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: A.storeId, cartId: c1Key } });
    check("conversion: a SENT event becomes CONVERTED once its shopper places a paid order afterwards", event1After?.status === "CONVERTED");

    // ---- Performance summary ----
    const perf = await api("GET", `/stores/${A.storeId}/cart-recovery/performance`, { token: A.token });
    check("performance: reports at least the converted shopper and the other sends, with a conversion rate", perf.status === 200 && perf.json.converted >= 1 && perf.json.sent >= perf.json.converted && perf.json.conversionRate > 0);
    check("performance: no token is 401, and staff without analytics_read is 403", (await api("GET", `/stores/${A.storeId}/cart-recovery/performance`)).status === 401 && (await api("GET", `/stores/${A.storeId}/cart-recovery/performance`, { token: staffToken })).status === 403);

    // ---- Tenant isolation ----
    check("isolation: store B's performance is untouched by everything done to store A", (await api("GET", `/stores/${B.storeId}/cart-recovery/performance`, { token: B.token })).json.sent === 0);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) {
      await prismaUnscoped.cartRecoveryEvent.deleteMany({ where: { tenantId: t } });
      await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
      // Aged carts get a long remaining TTL (that is the whole trick - see age() above), so
      // they would otherwise sit in Redis for days after the tenant that owned them is gone,
      // and every real scan until then would log a harmless but noisy "Store not found".
      for (const pattern of [`cart:${t}:u:*`, `cart:${t}:g:*`]) {
        const stream = redis.scanStream({ match: pattern, count: 100 });
        for await (const keys of stream as AsyncIterable<string[]>) if (keys.length > 0) await redis.del(...keys);
      }
    }
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeCartRecoveryQueue();
  await closeAiQueue();
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
