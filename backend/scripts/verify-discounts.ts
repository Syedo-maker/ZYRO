/**
 * End-to-end check of Discount Codes (Phase 3, Module 7) against the real local Postgres,
 * MongoDB and Redis, driven through the real HTTP API: the pure rules, merchant management and
 * permissions, storefront validation, applying a code at online checkout (quote, Stripe session,
 * webhook fulfilment), holding a limited code while a shopper pays, in-store use at the register,
 * concurrency, and tenant isolation. Stripe's network calls are replaced by a recording fake.
 * Creates throwaway stores and removes them after.
 * Usage: npx tsx scripts/verify-discounts.ts   (Redis must be running on REDIS_URL)
 */
process.env.RATE_LIMIT_ENABLED = "false"; // many registrations in a row; verify-security.ts covers the limits
process.env.STRIPE_SECRET_KEY = "sk_test_verifydisc";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_verifydisc";

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
  const { prisma, prismaUnscoped } = await import("../src/lib/prisma");
  const { closeRedis } = await import("../src/lib/redis");
  const { getStripeGateway, setStripeGateway } = await import("../src/lib/stripe");
  const { tenantContext } = await import("../src/lib/tenantContext");
  const { createOrder } = await import("../src/modules/commerce/order.service");
  const { discountService } = await import("../src/modules/discounts/discount.service");
  const rules = await import("../src/modules/discounts/discount.rules");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  // ---- The pure rules, no database ----
  {
    const now = new Date("2026-09-20T12:00:00Z");
    const base0 = { type: "PERCENTAGE" as const, value: 10, active: true, expiresAt: null, minSubtotalCents: null, usageLimit: null, usageCount: 0, reserved: 0 };
    const ev = (over: object, subtotal = 5000) => rules.evaluateDiscountCode({ ...base0, ...over }, subtotal, now);
    const ok = (v: ReturnType<typeof ev>) => (v.ok ? v.discountCents : -1);
    check("rules: 10% of 50.00 is 5.00", ok(ev({})) === 500);
    check("rules: a fixed 5.00 is 5.00", ok(ev({ type: "FIXED", value: 5 })) === 500);
    check("rules: a fixed amount larger than the subtotal is capped at the subtotal", ok(ev({ type: "FIXED", value: 100 })) === 5000);
    check("rules: 100% takes off the whole subtotal", ok(ev({ value: 100 })) === 5000);
    check("rules: percentage rounds to the cent like pricing does (12.5% of 33.33 = 4.17)", ok(ev({ value: 12.5 }, 3333)) === 417);
    const rej = (v: ReturnType<typeof ev>) => (v.ok ? "ok" : v.reason);
    check("rules: an inactive code is refused", rej(ev({ active: false })) === "inactive");
    check("rules: a code expiring in the past is refused", rej(ev({ expiresAt: new Date("2026-09-19T00:00:00Z") })) === "expired");
    check("rules: a code expiring exactly now is already expired", rej(ev({ expiresAt: now })) === "expired");
    check("rules: a code expiring in the future is fine", rej(ev({ expiresAt: new Date("2026-09-21T00:00:00Z") })) === "ok");
    check("rules: usage at the limit is refused", rej(ev({ usageLimit: 3, usageCount: 3 })) === "used_up");
    check("rules: pending checkouts hold uses (2 used + 1 pending of 3 leaves none after another)", rej(ev({ usageLimit: 3, usageCount: 2, reserved: 1 })) === "used_up" && rej(ev({ usageLimit: 3, usageCount: 1, reserved: 1 })) === "ok");
    check("rules: no limit means unlimited", rej(ev({ usageLimit: null, usageCount: 999999 })) === "ok");
    check("rules: below the minimum subtotal is refused, exactly the minimum is fine", rej(ev({ minSubtotalCents: 5001 })) === "below_minimum" && rej(ev({ minSubtotalCents: 5000 })) === "ok");
    check("rules: several problems report the first: inactive before expired before used up", rej(ev({ active: false, expiresAt: new Date("2020-01-01"), usageLimit: 1, usageCount: 1 })) === "inactive" && rej(ev({ expiresAt: new Date("2020-01-01"), usageLimit: 1, usageCount: 1 })) === "expired");
    check("rules: codes are matched ignoring case and spaces", rules.normalizeCode("  Save10 ") === "SAVE10");
    check("rules: status for the merchant list", rules.statusOf({ ...base0 }, now) === "active" && rules.statusOf({ ...base0, active: false }, now) === "inactive" && rules.statusOf({ ...base0, expiresAt: new Date("2020-01-01") }, now) === "expired" && rules.statusOf({ ...base0, usageLimit: 1, usageCount: 1 }, now) === "used_up");
  }

  // ---- Fake Stripe network calls; keep the real signature verification ----
  const stripeCalls = { sessions: [] as any[] };
  const realGateway = getStripeGateway();
  let sessionCounter = 0;
  let failNextSession = false;
  const expiredSessionIds: string[] = [];
  setStripeGateway({
    ...realGateway,
    async createCheckoutSession(params) {
      if (failNextSession) {
        failNextSession = false;
        throw new Error("Stripe is down");
      }
      stripeCalls.sessions.push(params);
      sessionCounter++;
      return { id: `cs_test_disc_${Date.now()}_${sessionCounter}`, url: `https://checkout.stripe.test/pay/${sessionCounter}` };
    },
    async refundPaymentIntent(_pi, key) {
      return { id: `re_${key}` };
    },
    async expireCheckoutSession(stripeSessionId) {
      expiredSessionIds.push(stripeSessionId);
    },
  });
  const signer = new Stripe("sk_test_verifydisc");

  async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.guest) headers["X-Guest-Session-Id"] = opts.guest;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }
  async function sendEvent(type: string, session: object) {
    const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, data: { object: session } });
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": signer.webhooks.generateTestHeaderString({ payload, secret: "whsec_verifydisc" }) },
      body: payload,
    });
    return { status: res.status, json: await res.json() };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function register(tag: string) {
    const email = `verify-disc-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-disc-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    // This script needs more than the Free plan includes, so the store is put on Business the way a paid checkout leaves it.
    await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { plan: "BUSINESS", planExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) } });
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
  }
  async function staffMember(owner: { token: string; storeId: string }, tag: string, permissions: string[]) {
    const email = `verify-disc-${tag}-${suffix}@example.com`;
    const made = await api("POST", `/stores/${owner.storeId}/staff`, { token: owner.token, body: { email, name: tag, password: "password123", permissions } });
    created.userIds.push(made.json.userId);
    const login = await api("POST", "/auth/login", { body: { email, password: "password123" } });
    return { token: login.json.accessToken as string, userId: made.json.userId as string };
  }
  let guestCounter = 0;
  const newGuest = () => `guest-${suffix}-d${String(++guestCounter).padStart(4, "0")}xxxxxxxx`;

  try {
    const A = await register("a");
    const B = await register("b");
    const outsider = await register("out");
    const discStaff = await staffMember(A, "disc", ["discounts_write"]);
    const ordersStaff = await staffMember(A, "ord", ["orders_write"]);
    const cashier = await staffMember(A, "cash", ["pos_sell"]);
    await prismaUnscoped.tenant.update({ where: { id: A.storeId }, data: { taxRate: "8" } });
    const zone = await prismaUnscoped.shippingZone.create({ data: { tenantId: A.storeId, name: "Standard", region: "US", rateAmount: "5.5" } });
    const addProduct = async (s: { token: string; storeId: string }, title: string, price: number, stock: number, taxable = true) =>
      (await api("POST", `/stores/${s.storeId}/products`, { token: s.token, body: { title, price, stock, category: "t", taxable } })).json.id as string;
    const widget = await addProduct(A, "Widget", 20, 200);
    const gadget = await addProduct(A, "Gadget", 10, 200, false);
    const bWidget = await addProduct(B, "Widget", 20, 50);
    const D = (path = "") => `/stores/${A.storeId}/discount-codes${path}`;
    const fillCart = async (storeId: string, guest: string, items: [string, number][]) => {
      for (const [productId, quantity] of items) await api("POST", `/stores/${storeId}/cart/items`, { guest, body: { productId, quantity } });
    };
    const standardCart = (guest: string) => fillCart(A.storeId, guest, [[widget, 2], [gadget, 1]]); // subtotal 50.00 (40.00 taxable)
    const quote = (guest: string, body: object = {}) => api("POST", `/stores/${A.storeId}/checkout/quote`, { guest, body });
    const startSession = (guest: string, body: object = {}) => api("POST", `/stores/${A.storeId}/checkout/session`, { guest, body });
    const makeCode = (body: object, token = A.token) => api("POST", D(), { token, body });
    const usageOf = async (code: string) => (await prismaUnscoped.discountCode.findFirst({ where: { tenantId: A.storeId, code } }))!.usageCount;
    const codeId = async (code: string) => (await prismaUnscoped.discountCode.findFirst({ where: { tenantId: A.storeId, code } }))!.id;
    const pending = (id: string) => prismaUnscoped.checkoutSession.count({ where: { discountCodeId: id, status: "PENDING", expiresAt: { gt: new Date() } } });

    // ---- Merchant management ----
    const save10 = await makeCode({ code: "save10", type: "percentage", value: 10 });
    check("manage: the owner creates a percentage code; it is stored upper-case with a status", save10.status === 201 && save10.json.code === "SAVE10" && save10.json.type === "percentage" && save10.json.value === 10 && save10.json.status === "active" && save10.json.usageCount === 0);
    check("manage: the same code in another case is a duplicate (409)", (await makeCode({ code: "Save10", type: "fixed", value: 3 })).status === 409);
    const bSave = await api("POST", `/stores/${B.storeId}/discount-codes`, { token: B.token, body: { code: "SAVE10", type: "percentage", value: 50 } });
    check("manage: store B creates its own SAVE10 with a different value", bSave.status === 201 && bSave.json.value === 50);
    const fiveOff = await makeCode({ code: "FIVE_OFF", type: "fixed", value: 5 });
    check("manage: a fixed-amount code", fiveOff.status === 201 && fiveOff.json.type === "fixed" && fiveOff.json.value === 5);
    const bad = (body: object) => makeCode(body).then((r) => r.status);
    check("manage: percentage over 100 is 400", (await bad({ code: "TOOMUCH", type: "percentage", value: 150 })) === 400);
    check("manage: value 0 and negative are 400", (await bad({ code: "ZERO", type: "fixed", value: 0 })) === 400 && (await bad({ code: "NEG", type: "fixed", value: -5 })) === 400);
    check("manage: a code with spaces or symbols is 400", (await bad({ code: "no spaces", type: "fixed", value: 1 })) === 400 && (await bad({ code: "bad$", type: "fixed", value: 1 })) === 400);
    check("manage: a code shorter than 3 or longer than 30 is 400", (await bad({ code: "ab", type: "fixed", value: 1 })) === 400 && (await bad({ code: "A".repeat(31), type: "fixed", value: 1 })) === 400);
    check("manage: an expiry in the past is 400", (await bad({ code: "OLD", type: "fixed", value: 1, expiresAt: "2020-01-01T00:00:00Z" })) === 400);
    check("manage: a usage limit of 0 is 400", (await bad({ code: "NOUSE", type: "fixed", value: 1, usageLimit: 0 })) === 400);
    check("manage: an unknown type is 400", (await bad({ code: "WEIRD", type: "bogo", value: 1 })) === 400);

    check("permissions: no token is 401", (await api("GET", D())).status === 401);
    check("permissions: staff without discounts_write cannot list or create (403)", (await api("GET", D(), { token: ordersStaff.token })).status === 403 && (await api("POST", D(), { token: ordersStaff.token, body: { code: "NOPE1", type: "fixed", value: 1 } })).status === 403);
    check("permissions: a cashier cannot manage codes (403)", (await api("GET", D(), { token: cashier.token })).status === 403);
    check("permissions: staff with discounts_write can create and list", (await api("POST", D(), { token: discStaff.token, body: { code: "STAFF15", type: "percentage", value: 15 } })).status === 201 && (await api("GET", D(), { token: discStaff.token })).status === 200);
    check("permissions: another store's owner cannot list this store's codes (403)", (await api("GET", D(), { token: outsider.token })).status === 403);
    const listA = await api("GET", D(), { token: A.token });
    check("isolation: store A's list holds only its own three codes (its SAVE10 is 10%); store B's list only its own", listA.json.length === 3 && listA.json.find((c: { code: string }) => c.code === "SAVE10").value === 10 && (await api("GET", `/stores/${B.storeId}/discount-codes`, { token: B.token })).json.length === 1);

    const expiring = await makeCode({ code: "SOON", type: "percentage", value: 20, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    check("manage: a code can be created with a future expiry", expiring.status === 201 && expiring.json.expiresAt !== null);
    check("update: an empty change is 400", (await api("PATCH", D(`/${save10.json.id}`), { token: A.token, body: {} })).status === 400);
    const off = await api("PATCH", D(`/${save10.json.id}`), { token: A.token, body: { active: false } });
    check("update: a code can be switched off, and shows as inactive", off.status === 200 && off.json.active === false && off.json.status === "inactive");
    check("update: and back on", (await api("PATCH", D(`/${save10.json.id}`), { token: A.token, body: { active: true } })).json.status === "active");
    check("update: the code, type and value cannot be changed (ignored)", (await api("PATCH", D(`/${save10.json.id}`), { token: A.token, body: { active: true, value: 99, code: "HACK" } })).json.value === 10);
    check("update: an unknown id is 404", (await api("PATCH", D("/nope"), { token: A.token, body: { active: false } })).status === 404);
    check("isolation: another store cannot change this store's code (404)", (await api("PATCH", `/stores/${B.storeId}/discount-codes/${save10.json.id}`, { token: B.token, body: { active: false } })).status === 404 && (await usageOf("SAVE10")) === 0 && (await prismaUnscoped.discountCode.findFirst({ where: { id: save10.json.id } }))!.active === true);
    const limited = await makeCode({ code: "LIMIT3", type: "fixed", value: 2, usageLimit: 3, minSubtotal: 10 });
    check("update: the limit and minimum are stored", limited.json.usageLimit === 3 && limited.json.minSubtotal === 10);
    await prismaUnscoped.discountCode.updateMany({ where: { id: limited.json.id }, data: { usageCount: 2 } });
    check("update: a limit below the times already used is 400", (await api("PATCH", D(`/${limited.json.id}`), { token: A.token, body: { usageLimit: 1 } })).status === 400);
    check("update: the limit can be removed (null) and the expiry cleared", (await api("PATCH", D(`/${limited.json.id}`), { token: A.token, body: { usageLimit: null } })).json.usageLimit === null && (await api("PATCH", D(`/${expiring.json.id}`), { token: A.token, body: { expiresAt: null } })).json.expiresAt === null);
    await api("PATCH", D(`/${expiring.json.id}`), { token: A.token, body: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    await api("PATCH", D(`/${limited.json.id}`), { token: A.token, body: { usageLimit: 2 } });
    const statuses = Object.fromEntries((await api("GET", D(), { token: A.token })).json.map((c: { code: string; status: string }) => [c.code, c.status]));
    check("list: statuses are active, expired and used up as they should be", statuses.SAVE10 === "active" && statuses.SOON === "expired" && statuses.LIMIT3 === "used_up", JSON.stringify(statuses));

    // ---- Storefront validation ----
    const g0 = newGuest();
    const v = (code: string, cartTotal: number, storeId = A.storeId, guest: string | undefined = g0) => api("POST", `/stores/${storeId}/discount-codes/validate`, { guest, body: { code, cartTotal } });
    const v1 = await v("save10", 100);
    check("validate: works without an account, ignores case, and returns the saving", v1.status === 200 && v1.json.valid === true && v1.json.discountAmount === 10 && v1.json.type === "percentage" && v1.json.code === "SAVE10");
    check("validate: a fixed code capped at the cart total", (await v("FIVE_OFF", 3)).json.discountAmount === 3 && (await v("FIVE_OFF", 100)).json.discountAmount === 5);
    check("validate: no guest id or token is 400", (await api("POST", `/stores/${A.storeId}/discount-codes/validate`, { body: { code: "SAVE10", cartTotal: 10 } })).status === 400);
    check("validate: a missing or negative cart total is 400", (await api("POST", `/stores/${A.storeId}/discount-codes/validate`, { guest: g0, body: { code: "SAVE10" } })).status === 400 && (await v("SAVE10", -1)).status === 400);
    const unknown = await v("NOSUCHCODE", 50);
    check("validate: an unknown code is 400 with the discount problem type", unknown.status === 400 && unknown.json.type.endsWith("/invalid-discount-code") && /not valid/.test(unknown.json.detail));
    check("validate: an expired code says it has expired", /expired/.test((await v("SOON", 50)).json.detail));
    check("validate: a used-up code says it reached its limit", /usage limit/.test((await v("LIMIT3", 50)).json.detail));
    await api("PATCH", D(`/${save10.json.id}`), { token: A.token, body: { active: false } });
    check("validate: a switched-off code is refused", /no longer available/.test((await v("SAVE10", 50)).json.detail));
    await api("PATCH", D(`/${save10.json.id}`), { token: A.token, body: { active: true } });
    check("isolation: store B's SAVE10 is its own 50% code; A's code name means nothing to a code that B lacks", (await v("SAVE10", 100, B.storeId)).json.discountAmount === 50 && (await v("FIVE_OFF", 100, B.storeId)).status === 400 && (await v("STAFF15", 100, B.storeId)).status === 400);

    // ---- Online checkout: quote ----
    const gQ = newGuest();
    await standardCart(gQ);
    const plain = await quote(gQ);
    check("quote: without a code nothing changes (subtotal 50.00, tax 3.20, total 53.20)", plain.json.discountAmount === 0 && plain.json.taxAmount === 3.2 && plain.json.total === 53.2 && plain.json.discount === null);
    const q10 = await quote(gQ, { discountCode: "save10", shippingZoneId: zone.id });
    check("quote: SAVE10 takes 5.00 off, cuts tax to 2.88 (discount reduces the taxable base) and leaves shipping alone: 53.38", q10.status === 200 && q10.json.discountAmount === 5 && q10.json.taxAmount === 2.88 && q10.json.shippingAmount === 5.5 && q10.json.total === 53.38 && q10.json.discount.code === "SAVE10" && q10.json.discount.type === "percentage", JSON.stringify(q10.json));
    check("quote: a fixed code gives the same 5.00", (await quote(gQ, { discountCode: "FIVE_OFF" })).json.discountAmount === 5);
    check("quote: an unknown code is 400 and a wrong-store code is refused too", (await quote(gQ, { discountCode: "NOPE" })).status === 400 && (await api("POST", `/stores/${B.storeId}/checkout/quote`, { guest: gQ, body: { discountCode: "STAFF15" } })).status === 400);
    check("quote: an over-long code is 400", (await quote(gQ, { discountCode: "X".repeat(31) })).status === 400);
    const minCode = await makeCode({ code: "MIN60", type: "percentage", value: 10, minSubtotal: 60 });
    check("validate: below the minimum spend says what is needed (60.00)", /at least 60\.00/.test((await v("MIN60", 50)).json.detail) && (await v("MIN60", 60)).json.discountAmount === 6);
    const minQuote = await quote(gQ, { discountCode: "MIN60" });
    check("quote: a code with a minimum spend refuses a 50.00 cart, naming the minimum", minQuote.status === 400 && /at least 60\.00/.test(minQuote.json.detail));
    const gMin = newGuest();
    await fillCart(A.storeId, gMin, [[widget, 3]]);
    check("quote: exactly the minimum (60.00) qualifies", (await quote(gMin, { discountCode: "MIN60" })).json.discountAmount === 6);
    await api("PATCH", D(`/${minCode.json.id}`), { token: A.token, body: { minSubtotal: null } });

    // ---- Online checkout: Stripe session and fulfilment ----
    const gS = newGuest();
    await standardCart(gS);
    const s1 = await startSession(gS, { discountCode: "SAVE10", shippingZoneId: zone.id });
    const sent = stripeCalls.sessions[stripeCalls.sessions.length - 1];
    const record1 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, cartKey: { contains: gS } } });
    check("session: created with a code (201)", s1.status === 201 && !!record1?.discountCodeId);
    const sentLines = sent.lineItems.reduce((s: number, l: any) => s + l.unitAmountCents * l.quantity, 0);
    check("session: Stripe is told a fixed 5.00 discount named after the code", sent.discount?.amountOffCents === 500 && sent.discount?.name === "Discount SAVE10");
    check("session: lines + tax - discount + shipping equals exactly the total ZYRO stored (53.38), so Stripe will charge the priced amount", sentLines - sent.discount.amountOffCents + sent.shipping.amountCents === record1!.totalCents && record1!.totalCents === 5338, `lines=${sentLines} total=${record1?.totalCents}`);
    check("session: without a code Stripe is sent no discount", await (async () => { const g = newGuest(); await standardCart(g); await startSession(g); return stripeCalls.sessions[stripeCalls.sessions.length - 1].discount === undefined; })());
    const held = await codeId("SAVE10");
    check("session: the pending checkout holds a use but the count is still 0 until it is paid", (await pending(held)) === 1 && (await usageOf("SAVE10")) === 0);
    const stripeId1 = record1!.stripeSessionId!;
    const paid = await sendEvent("checkout.session.completed", { id: stripeId1, object: "checkout.session", payment_status: "paid", amount_total: 5338, currency: "usd", payment_intent: `pi_${stripeId1}`, customer_details: { email: "shopper@example.com", name: "Sam" } });
    check("fulfil: the paid webhook creates the order", paid.status === 200 && paid.json.outcome === "fulfilled", JSON.stringify(paid.json));
    const order1 = await prismaUnscoped.order.findFirst({ where: { tenantId: A.storeId, stripeCheckoutSessionId: stripeId1 } });
    check("fulfil: the order records the code, the 5.00 discount and the total", order1?.discountCodeId === held && Number(order1.discountAmount) === 5 && Number(order1.total) === 53.38 && order1.channel === "ONLINE");
    check("fulfil: the code's use is now counted (1) and the hold is gone", (await usageOf("SAVE10")) === 1 && (await pending(held)) === 0);
    const viewed = await api("GET", `/stores/${A.storeId}/orders/${order1!.id}`, { token: A.token });
    check("fulfil: the order view names the code", viewed.json.discountCode === "SAVE10" && viewed.json.discountAmount === 5);
    check("fulfil: the same webhook again does not count a second use", (await sendEvent("checkout.session.completed", { id: stripeId1, object: "checkout.session", payment_status: "paid", amount_total: 5338, currency: "usd", payment_intent: `pi_${stripeId1}` })).json.outcome === "already-processed" && (await usageOf("SAVE10")) === 1);

    // ---- Free and tiny orders ----
    const gBig = newGuest();
    await standardCart(gBig);
    await makeCode({ code: "HUNDRED", type: "percentage", value: 100 });
    check("session: a code that makes the order free is refused with a clear reason (Stripe cannot charge 0)", await (async () => { const r = await startSession(gBig, { discountCode: "HUNDRED" }); return r.status === 400 && /too small/.test(r.json.detail); })());
    check("quote: but the preview still shows what the code would do", (await quote(gBig, { discountCode: "HUNDRED" })).json.total === 0);
    await makeCode({ code: "ALMOST", type: "fixed", value: 49.7 });
    check("session: a discount leaving under the 0.50 minimum charge is refused", (await startSession(gBig, { discountCode: "ALMOST" })).status === 400);
    check("session: and refused sessions do not hold a use or leave a session behind", (await prismaUnscoped.checkoutSession.count({ where: { tenantId: A.storeId, cartKey: { contains: gBig } } })) === 0);

    // ---- A limited code held while a shopper pays ----
    const one = await makeCode({ code: "ONLYONE", type: "fixed", value: 2, usageLimit: 1 });
    const oneId = one.json.id as string;
    const gP = newGuest();
    const gQ2 = newGuest();
    await fillCart(A.storeId, gP, [[widget, 1]]);
    await fillCart(A.storeId, gQ2, [[widget, 1]]);
    const hold1 = await startSession(gP, { discountCode: "ONLYONE" });
    check("hold: the first shopper gets the last use", hold1.status === 201 && (await pending(oneId)) === 1);
    check("hold: while they pay, another shopper's quote, session and validate all say it is used up", (await quote(gQ2, { discountCode: "ONLYONE" })).status === 400 && (await startSession(gQ2, { discountCode: "ONLYONE" })).status === 400 && /usage limit/.test((await v("ONLYONE", 20, A.storeId, gQ2)).json.detail));
    check("hold: the shopper holding it is not blocked by their own page (retry works, quote works)", (await quote(gP, { discountCode: "ONLYONE" })).status === 200 && (await startSession(gP, { discountCode: "ONLYONE" })).status === 201);
    const recP = await prismaUnscoped.checkoutSession.findMany({ where: { tenantId: A.storeId, cartKey: { contains: gP } }, orderBy: { createdAt: "asc" } });
    check(
      "hold: retrying supersedes the first hold rather than adding a second one (security fix: a shopper used to be able to hold a 1-use code across unlimited parallel unpaid sessions - see discount.service.ts assertCanHold)",
      recP.length === 2 && recP[0].status === "FAILED" && recP[1].status === "PENDING" && expiredSessionIds.includes(recP[0].stripeSessionId!)
    );
    await sendEvent("checkout.session.expired", { id: recP[0].stripeSessionId, object: "checkout.session" });
    await sendEvent("checkout.session.expired", { id: recP[1].stripeSessionId, object: "checkout.session" });
    check("hold: when the checkout expires the use is released and the next shopper can have it", (await pending(oneId)) === 0 && (await startSession(gQ2, { discountCode: "ONLYONE" })).status === 201);
    const recQ2 = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, cartKey: { contains: gQ2 } } });
    await prismaUnscoped.checkoutSession.update({ where: { id: recQ2!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    check("hold: a checkout that lapses by time alone also releases it (no cleanup job needed)", (await pending(oneId)) === 0 && (await quote(gP, { discountCode: "ONLYONE" })).status === 200);
    failNextSession = true;
    const gF = newGuest();
    await fillCart(A.storeId, gF, [[widget, 1]]);
    const failed = await startSession(gF, { discountCode: "ONLYONE" });
    check("hold: if Stripe is down the session fails and does not keep holding the use", failed.status >= 500 && (await pending(oneId)) === 0);

    // five shoppers, one use
    const racers = Array.from({ length: 5 }, () => newGuest());
    for (const g of racers) await fillCart(A.storeId, g, [[widget, 1]]);
    const race = await Promise.all(racers.map((g) => startSession(g, { discountCode: "ONLYONE" })));
    check("hold race: five shoppers start checkout at once for a 1-use code: exactly one gets it", race.filter((r) => r.status === 201).length === 1 && race.filter((r) => r.status === 400).length === 4 && (await pending(oneId)) === 1, race.map((r) => r.status).join());
    for (const g of racers) await sendEvent("checkout.session.expired", { id: (await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, cartKey: { contains: g }, status: "PENDING" } }))?.stripeSessionId ?? "none", object: "checkout.session" });

    // ---- Security fix: one shopper cannot hoard a limited code by repeatedly retrying without paying ----
    const gHoard = newGuest();
    await fillCart(A.storeId, gHoard, [[widget, 1]]);
    const attempts = [];
    for (let i = 0; i < 5; i++) attempts.push(await startSession(gHoard, { discountCode: "ONLYONE" }));
    check("hoard: five straight, unpaid retries by the same shopper all succeed one at a time (each retry supersedes the last)", attempts.every((r) => r.status === 201));
    const hoardRows = await prismaUnscoped.checkoutSession.findMany({ where: { tenantId: A.storeId, cartKey: { contains: gHoard } } });
    check("hoard: only the LAST attempt is still pending; the other four were superseded, not left holding the code too", hoardRows.filter((r) => r.status === "PENDING").length === 1 && hoardRows.filter((r) => r.status === "FAILED").length === 4);
    check("hoard: a genuinely different shopper is still correctly refused (the code is really down to 0, not secretly hoarded)", (await startSession(gQ2, { discountCode: "ONLYONE" })).status === 400);
    const lastHoard = hoardRows.find((r) => r.status === "PENDING")!;
    await sendEvent("checkout.session.expired", { id: lastHoard.stripeSessionId, object: "checkout.session" });
    check("hoard: cleaned up, the code is available again", (await pending(oneId)) === 0);

    // paying after the merchant switched the code off: the shopper was already charged the discount
    const honour = await makeCode({ code: "HONOUR", type: "fixed", value: 4, usageLimit: 1 });
    const gH = newGuest();
    await fillCart(A.storeId, gH, [[widget, 1]]);
    await startSession(gH, { discountCode: "HONOUR" });
    const recH = await prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: A.storeId, cartKey: { contains: gH } } });
    await api("PATCH", D(`/${honour.json.id}`), { token: A.token, body: { active: false } });
    const paidH = await sendEvent("checkout.session.completed", { id: recH!.stripeSessionId, object: "checkout.session", payment_status: "paid", amount_total: recH!.totalCents, currency: "usd", payment_intent: "pi_honour", customer_details: { email: "h@example.com" } });
    check("honour: a shopper who paid before the code was switched off still gets their order, with the discount", paidH.json.outcome === "fulfilled" && (await usageOf("HONOUR")) === 1 && Number((await prismaUnscoped.order.findFirst({ where: { stripeCheckoutSessionId: recH!.stripeSessionId! } }))!.discountAmount) === 4);

    // ---- In-store (POS) ----
    const P = (path: string) => `/stores/${A.storeId}/pos${path}`;
    const shift = await api("POST", P("/shift/open"), { token: cashier.token, body: { openingFloat: 100 } });
    check("pos: cashier opens a shift", shift.status === 201);
    const items = [{ productId: widget, quantity: 2 }, { productId: gadget, quantity: 1 }];
    const pq = await api("POST", P("/quote"), { token: cashier.token, body: { items, discountCode: "save10" } });
    check("pos: a code prices at the register exactly as online (47.88, code shown)", pq.status === 200 && pq.json.discountAmount === 5 && pq.json.taxAmount === 2.88 && pq.json.total === 47.88 && pq.json.discountCode === "SAVE10", JSON.stringify(pq.json).slice(0, 200));
    check("pos: a code and a manual discount together are refused (no stacking)", (await api("POST", P("/quote"), { token: cashier.token, body: { items, discountCode: "SAVE10", discount: { type: "percentage", value: 5 } } })).status === 400);
    await makeCode({ code: "HALF50", type: "percentage", value: 50 });
    check("pos: a store code is the merchant's, so a cashier may use a 50% code but not give 50% by hand", (await api("POST", P("/quote"), { token: cashier.token, body: { items, discountCode: "HALF50" } })).status === 200 && (await api("POST", P("/quote"), { token: cashier.token, body: { items, discount: { type: "percentage", value: 50 } } })).status === 403);
    check("pos: an unknown code is 400", (await api("POST", P("/quote"), { token: cashier.token, body: { items, discountCode: "NOPE" } })).status === 400);
    const before = await usageOf("SAVE10");
    const sale1 = await api("POST", P("/sales"), { token: cashier.token, body: { items, discountCode: "Save10", payments: [{ method: "cash", amount: 47.88, tendered: 50 }] } });
    check("pos: the sale completes at 47.88, records the code and a reason for the receipt", sale1.status === 201 && sale1.json.total === 47.88 && sale1.json.discountCode === "SAVE10" && sale1.json.discountReason === "Code SAVE10" && sale1.json.changeDue === 2.12, JSON.stringify(sale1.json).slice(0, 200));
    check("pos: the use is counted with the sale", (await usageOf("SAVE10")) === before + 1);
    check("pos: paying the full price instead of the discounted amount is refused", (await api("POST", P("/sales"), { token: cashier.token, body: { items, discountCode: "SAVE10", payments: [{ method: "cash", amount: 53.2 }] } })).status === 400 && (await usageOf("SAVE10")) === before + 1);

    const posOne = await makeCode({ code: "POSONE", type: "fixed", value: 3, usageLimit: 1 });
    const one1 = [{ productId: widget, quantity: 1 }];
    const posRace = await Promise.all([1, 2].map((i) => api("POST", P("/sales"), { token: cashier.token, body: { items: one1, discountCode: "POSONE", payments: [{ method: "cash", amount: 18.36 }], clientRequestId: `race-${suffix}-${i}-xxxxxxxx` } })));
    check("pos race: two tills using a 1-use code at once: exactly one sale gets it", posRace.filter((r) => r.status === 201).length === 1 && posRace.filter((r) => r.status >= 400).length === 1 && (await usageOf("POSONE")) === 1 && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId, discountCodeId: posOne.json.id } })) === 1, posRace.map((r) => r.status).join());
    check("pos: the used-up code is refused at the register afterwards", (await api("POST", P("/quote"), { token: cashier.token, body: { items: one1, discountCode: "POSONE" } })).status === 400);

    const resv = await makeCode({ code: "RESERVED", type: "fixed", value: 1, usageLimit: 1 });
    const gR = newGuest();
    await fillCart(A.storeId, gR, [[widget, 1]]);
    await startSession(gR, { discountCode: "RESERVED" });
    check("pos: a use held by a shopper who is paying online is not given away at the register", (await api("POST", P("/quote"), { token: cashier.token, body: { items: one1, discountCode: "RESERVED" } })).status === 400 && (await pending(resv.json.id)) === 1);

    // the counting itself is atomic with the order
    const fix1 = await makeCode({ code: "FIX1", type: "fixed", value: 1 });
    const stockBefore = (await api("GET", `/stores/${A.storeId}/products/${gadget}`)).json.stock as number;
    let rolledBack = false;
    try {
      await tenantContext.run(A.storeId, () =>
        createOrder({ tenantId: A.storeId, channel: "POS", items: [{ productId: gadget, quantity: 99999 }], discountCodeId: fix1.json.id, payments: [{ method: "CASH", amount: 999989 }] })
      );
    } catch {
      rolledBack = true;
    }
    check("atomic: an order that fails on stock leaves the code's use uncounted", rolledBack && (await usageOf("FIX1")) === 0 && (await api("GET", `/stores/${A.storeId}/products/${gadget}`)).json.stock === stockBefore);
    await api("PATCH", D(`/${fix1.json.id}`), { token: A.token, body: { active: false } });
    let strictRefused = false;
    try {
      await tenantContext.run(A.storeId, () => prisma.$transaction((tx) => discountService.redeem(tx, { tenantId: A.storeId, codeId: fix1.json.id, mode: "strict" })));
    } catch {
      strictRefused = true;
    }
    check("atomic: redeeming a code that was switched off between quote and sale is refused, and counts nothing", strictRefused && (await usageOf("FIX1")) === 0);

    // returns do not give the use back
    const posSale = sale1.json;
    const ret = await api("POST", P(`/sales/${posSale.id}/returns`), { token: A.token, body: { items: [{ orderItemId: posSale.items[0].id, quantity: 2 }] } });
    check("returns: taking items back from a discounted sale refunds the discounted price and the use stays counted", ret.status === 201 && ret.json.returns[0].amount > 0 && ret.json.returns[0].amount < 40 * 1.08 && (await usageOf("SAVE10")) === before + 1);

    // ---- Database guarantees ----
    const insert = (data: object) => prismaUnscoped.discountCode.create({ data: { tenantId: A.storeId, ...data } as never }).then(() => true, () => false);
    check("database: a lower-case code cannot be stored", !(await insert({ code: "lower", type: "FIXED", value: "1" })));
    check("database: a zero value and a percentage over 100 cannot be stored", !(await insert({ code: "DBZERO", type: "FIXED", value: "0" })) && !(await insert({ code: "DBPCT", type: "PERCENTAGE", value: "101" })));
    check("database: a usage limit of 0 cannot be stored", !(await insert({ code: "DBLIM", type: "FIXED", value: "1", usageLimit: 0 })));
    check("database: two codes with the same name in one store cannot both exist", !(await insert({ code: "SAVE10", type: "FIXED", value: "1" })));

    // ---- Cross-store ----
    const gB = newGuest();
    await fillCart(B.storeId, gB, [[bWidget, 1]]);
    check("isolation: store B's checkout cannot use store A's codes, and its own SAVE10 is a different 50% code", (await api("POST", `/stores/${B.storeId}/checkout/quote`, { guest: gB, body: { discountCode: "FIVE_OFF" } })).status === 400 && (await api("POST", `/stores/${B.storeId}/checkout/quote`, { guest: gB, body: { discountCode: "SAVE10" } })).json.discountAmount === 10);
    check("isolation: using A's codes never touched B's", (await prismaUnscoped.discountCode.findFirst({ where: { tenantId: B.storeId, code: "SAVE10" } }))!.usageCount === 0);
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
