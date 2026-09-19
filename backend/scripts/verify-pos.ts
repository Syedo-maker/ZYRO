/**
 * End-to-end check of the POS backend (Phase 2.5) against the real local Postgres and
 * MongoDB, driven through the real HTTP API: cashier accounts, permissions, shifts and the
 * cash drawer, priced sales with split payments, discount limits, idempotent submission,
 * item returns, held sales, the daily summary, concurrency, and tenant isolation.
 * Creates throwaway stores and users and removes them after.
 * Usage: npx tsx scripts/verify-pos.ts
 */
process.env.RATE_LIMIT_ENABLED = "false"; // many registrations in a row; verify-security.ts covers the limits
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
  const { tenantContext } = await import("../src/lib/tenantContext");
  const { createOrder } = await import("../src/modules/commerce/order.service");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const started = new Date(Date.now() - 60_000);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function register(tag: string) {
    const email = `pos-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `POS ${tag}`, storeSlug: `pos-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
  }

  try {
    const A = await register("a");
    const B = await register("b");
    const noSell = await register("nosell");
    const P = (path: string) => `/stores/${A.storeId}/pos${path}`;
    await prismaUnscoped.tenant.update({ where: { id: A.storeId }, data: { taxRate: 8 } });

    // ---- Cashier accounts and permissions ----
    const cashierEmail = `pos-cashier-${suffix}@example.com`;
    const madeCashier = await api("POST", `/stores/${A.storeId}/staff`, {
      token: A.token,
      body: { email: cashierEmail, name: "Riley Chen", password: "cashier-pass-1", permissions: ["pos_sell"] },
    });
    check("cashier: the owner creates a new cashier account with a starting password (201)", madeCashier.status === 201 && madeCashier.json.email === cashierEmail);
    created.userIds.push(madeCashier.json.userId);
    const cashierLogin = await api("POST", "/auth/login", { body: { email: cashierEmail, password: "cashier-pass-1" } });
    check("cashier: the new cashier can sign in", cashierLogin.status === 200 && !!cashierLogin.json.accessToken);
    const cashier = { token: cashierLogin.json.accessToken as string, userId: madeCashier.json.userId as string };

    const managerEmail = `pos-manager-${suffix}@example.com`;
    const madeManager = await api("POST", `/stores/${A.storeId}/staff`, {
      token: A.token,
      body: { email: managerEmail, name: "Sam Okafor", password: "manager-pass-1", permissions: ["pos_sell", "refunds", "discounts_write", "analytics_read"] },
    });
    created.userIds.push(madeManager.json.userId);
    const manager = { token: (await api("POST", "/auth/login", { body: { email: managerEmail, password: "manager-pass-1" } })).json.accessToken as string, userId: madeManager.json.userId as string };

    check("cashier: a password for an email that already has an account is refused (400)", (await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: B.email, password: "whatever-123", permissions: ["pos_sell"] } })).status === 400);
    check("cashier: an unknown email with no password is 404 (existing behaviour kept)", (await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: `nobody-${suffix}@example.com`, permissions: ["pos_sell"] } })).status === 404);
    check("cashier: a too-short starting password is 400", (await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: `short-${suffix}@example.com`, password: "abc", permissions: ["pos_sell"] } })).status === 400);
    check("cashier: staff cannot create staff (owner only, 403)", (await api("POST", `/stores/${A.storeId}/staff`, { token: manager.token, body: { email: `x-${suffix}@example.com`, password: "password123", permissions: ["pos_sell"] } })).status === 403);

    check("auth: no token is 401", (await api("GET", P("/session"))).status === 401);
    check("auth: a user with no role at this store is 403", (await api("GET", P("/session"), { token: noSell.token })).status === 403);
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: noSell.email, permissions: ["orders_write"] } });
    check("auth: staff without pos_sell cannot use the register (403)", (await api("GET", P("/products"), { token: noSell.token })).status === 403);
    const session = await api("GET", P("/session"), { token: cashier.token });
    check("session: the cashier sees their own permissions (sell yes, refunds no)", session.status === 200 && session.json.permissions.sell === true && session.json.permissions.refunds === false && session.json.isOwner === false && session.json.store.currency === "USD");
    const ownerSession = await api("GET", P("/session"), { token: A.token });
    check("session: the owner is flagged and has every permission", ownerSession.json.isOwner === true && ownerSession.json.permissions.refunds && ownerSession.json.permissions.unlimitedDiscounts);

    // ---- Catalog lookup ----
    const p1 = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Widget", price: 20, stock: 50, category: "t", barcode: `BC-W-${suffix}`, sku: `SKU-W-${suffix}` } })).json.id as string;
    const p2 = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Gadget", price: 10.5, stock: 5, category: "t", taxable: false } })).json.id as string;
    const byCode = await api("GET", P(`/products?code=BC-W-${suffix}`), { token: cashier.token });
    check("products: an exact barcode finds the product with its stock", byCode.status === 200 && byCode.json.length === 1 && byCode.json[0].id === p1 && byCode.json[0].stock === 50);
    check("products: a SKU works as a code too", (await api("GET", P(`/products?code=SKU-W-${suffix}`), { token: cashier.token })).json.length === 1);
    check("products: part of a title finds it, case-insensitively", (await api("GET", P("/products?q=widg"), { token: cashier.token })).json.some((p: { id: string }) => p.id === p1));
    const weird = await api("GET", P("/products?q=" + encodeURIComponent("(.*[")), { token: cashier.token });
    check("products: regex characters in a search are treated as text, not a pattern (200, none)", weird.status === 200 && weird.json.length === 0);
    check("products: an unknown barcode returns an empty list", (await api("GET", P("/products?code=nope"), { token: cashier.token })).json.length === 0);
    check("products: another store's register cannot see this catalog", (await api("GET", `/stores/${B.storeId}/pos/products?q=widget`, { token: B.token })).json.length === 0);

    // ---- Pricing and discount limits (nothing sold yet) ----
    const twoW1G = [{ productId: p1, quantity: 2 }, { productId: p2, quantity: 1 }];
    const q1 = await api("POST", P("/quote"), { token: cashier.token, body: { items: twoW1G } });
    check("quote: subtotal 50.50, tax 8% on the taxable 40.00 only (3.20), total 53.70", q1.status === 200 && q1.json.subtotal === 50.5 && q1.json.taxAmount === 3.2 && q1.json.total === 53.7, JSON.stringify(q1.json).slice(0, 120));
    const q2 = await api("POST", P("/quote"), { token: cashier.token, body: { items: twoW1G, discount: { type: "percentage", value: 10, reason: "Loyal customer" } } });
    check("quote: a 10% discount lowers the taxable base too (total 48.33)", q2.json.discountAmount === 5.05 && q2.json.taxAmount === 2.88 && q2.json.total === 48.33 && q2.json.discountPercent === 10, JSON.stringify(q2.json).slice(0, 160));
    const big = { items: twoW1G, discount: { type: "percentage", value: 25 } };
    const q3 = await api("POST", P("/quote"), { token: cashier.token, body: big });
    check("discount: a cashier cannot give 25% (limit is 20%): 403 with a clear reason", q3.status === 403 && /20%/.test(q3.json.detail ?? ""));
    check("discount: the owner can give 25%", (await api("POST", P("/quote"), { token: A.token, body: big })).status === 200);
    check("discount: a manager with the discounts permission can give 25%", (await api("POST", P("/quote"), { token: manager.token, body: big })).status === 200);
    check("discount: a fixed amount is checked as a percentage of the sale (10.00 of 50.50 is 19.8%, fine)", (await api("POST", P("/quote"), { token: cashier.token, body: { items: twoW1G, discount: { type: "fixed", value: 10 } } })).status === 200);
    check("discount: a fixed amount over the limit (20.00 of 50.50 = 39.6%) is refused", (await api("POST", P("/quote"), { token: cashier.token, body: { items: twoW1G, discount: { type: "fixed", value: 20 } } })).status === 403);
    check("discount: over 100% is rejected (400)", (await api("POST", P("/quote"), { token: A.token, body: { items: twoW1G, discount: { type: "percentage", value: 150 } } })).status === 400);
    check("quote: an empty cart is 400", (await api("POST", P("/quote"), { token: cashier.token, body: { items: [] } })).status === 400);
    check("quote: quantity 0 is 400", (await api("POST", P("/quote"), { token: cashier.token, body: { items: [{ productId: p1, quantity: 0 }] } })).status === 400);
    check("quote: an unknown product is 404", (await api("POST", P("/quote"), { token: cashier.token, body: { items: [{ productId: "64b7f0f0f0f0f0f0f0f0f0f0", quantity: 1 }] } })).status === 404);
    const q4 = await api("POST", P("/quote"), { token: cashier.token, body: { items: [{ productId: p2, quantity: 6 }] } });
    check("quote: asking for more than is in stock lists the shortage", q4.json.shortages.length === 1 && q4.json.shortages[0].available === 5 && q4.json.shortages[0].requested === 6);

    // ---- Shifts ----
    const sale = (token: string, items: unknown, payments: unknown, extra: Record<string, unknown> = {}) =>
      api("POST", P("/sales"), { token, body: { items, payments, ...extra } });
    const cashPay = (amount: number, tendered?: number) => ({ method: "cash", amount, ...(tendered === undefined ? {} : { tendered }) });
    const stockOf = async (id: string) => (await api("GET", `/stores/${A.storeId}/products/${id}`)).json.stock as number;

    check("shift: none is open at first (null)", (await api("GET", P("/shift"), { token: cashier.token })).json === null);
    check("shift: a sale without an open shift is refused (409)", (await sale(cashier.token, [{ productId: p1, quantity: 1 }], [cashPay(21.6)])).status === 409);
    check("shift: a negative starting float is 400", (await api("POST", P("/shift/open"), { token: cashier.token, body: { openingFloat: -5 } })).status === 400);
    const opened = await api("POST", P("/shift/open"), { token: cashier.token, body: { openingFloat: 100 } });
    check("shift: the cashier opens a shift with a 100.00 float (201)", opened.status === 201 && opened.json.status === "open" && opened.json.openingFloat === 100 && opened.json.expectedCash === 100 && opened.json.openedBy.name === "Riley Chen");
    const shift1 = opened.json.id as string;
    check("shift: a second open shift at the same register is refused (409)", (await api("POST", P("/shift/open"), { token: manager.token, body: { openingFloat: 0 } })).status === 409);
    check("shift: the current shift is returned", (await api("GET", P("/shift"), { token: manager.token })).json.id === shift1);
    check("shift: the other store has no open shift", (await api("GET", `/stores/${B.storeId}/pos/shift`, { token: B.token })).json === null);

    // ---- Selling ----
    check("sale: payments that do not add up to the total are 400", (await sale(cashier.token, [{ productId: p1, quantity: 2 }], [cashPay(40)])).status === 400);
    check("sale: cash handed over less than the cash payment is 400", (await sale(cashier.token, [{ productId: p1, quantity: 2 }], [cashPay(43.2, 40)])).status === 400);
    check("sale: a tendered amount on a card payment is 400", (await sale(cashier.token, [{ productId: p1, quantity: 2 }], [{ method: "card", amount: 43.2, tendered: 50 }])).status === 400);
    check("sale: an unknown payment method is 400", (await sale(cashier.token, [{ productId: p1, quantity: 2 }], [{ method: "stripe", amount: 43.2 }])).status === 400);
    check("sale: not enough stock is 409 and nothing is taken", (await sale(cashier.token, [{ productId: p2, quantity: 6 }], [cashPay(67.98)])).status === 409 && (await stockOf(p2)) === 5);

    const s1 = await sale(cashier.token, [{ productId: p1, quantity: 2 }], [cashPay(43.2, 50)]);
    check("sale: 2 widgets for cash 43.20, 50.00 handed over: completed POS sale, change 6.80", s1.status === 201 && s1.json.channel === "pos" && s1.json.status === "completed" && s1.json.total === 43.2 && s1.json.changeDue === 6.8 && s1.json.payments[0].tenderedAmount === 50, JSON.stringify(s1.json).slice(0, 200));
    check("sale: it records the cashier, the shift and the store on the receipt", s1.json.cashier.name === "Riley Chen" && s1.json.shiftId === shift1 && s1.json.store.name === "POS a");
    check("sale: stock came off the shelf (50 to 48)", (await stockOf(p1)) === 48);

    const s2 = await sale(cashier.token, [{ productId: p1, quantity: 1 }, { productId: p2, quantity: 1 }], [{ method: "card", amount: 12.1 }, cashPay(20, 20)]);
    check("sale: a split payment (card 12.10 + cash 20.00) totalling 32.10 works", s2.status === 201 && s2.json.total === 32.1 && s2.json.payments.length === 2 && s2.json.changeDue === 0);
    check("sale: order numbers are sequential per store", s2.json.orderNumber === s1.json.orderNumber + 1);

    const tamper = await api("POST", P("/sales"), { token: cashier.token, body: { items: [{ productId: p1, quantity: 1, price: 0.01, unitPrice: 0.01 }], price: 0.01, total: 0.01, payments: [{ method: "card", amount: 21.6 }] } });
    check("sale: a price sent by the client is ignored, the catalog price is charged", tamper.status === 201 && tamper.json.total === 21.6 && tamper.json.items[0].unitPrice === 20);

    const k1 = `req-${suffix}-aaaa`;
    const stockBeforeReplay = await stockOf(p1);
    const r1 = await sale(cashier.token, [{ productId: p1, quantity: 1 }], [{ method: "card", amount: 21.6 }], { clientRequestId: k1 });
    const r2 = await sale(cashier.token, [{ productId: p1, quantity: 1 }], [{ method: "card", amount: 21.6 }], { clientRequestId: k1 });
    check("idempotency: submitting the same sale twice returns the first one (201 then 200)", r1.status === 201 && r2.status === 200 && r1.json.id === r2.json.id);
    check("idempotency: stock was deducted once", (await stockOf(p1)) === stockBeforeReplay - 1);
    const k2 = `req-${suffix}-bbbb`;
    const burst = await Promise.all([1, 2, 3, 4].map(() => sale(cashier.token, [{ productId: p1, quantity: 1 }], [{ method: "card", amount: 21.6 }], { clientRequestId: k2 })));
    const burstIds = new Set(burst.map((r) => r.json.id));
    check("idempotency: four simultaneous submissions make exactly one order", burst.every((r) => r.status === 200 || r.status === 201) && burstIds.size === 1 && (await prismaUnscoped.order.count({ where: { tenantId: A.storeId, clientRequestId: k2 } })) === 1);

    // customers
    const custSale = await sale(cashier.token, [{ productId: p2, quantity: 1 }], [cashPay(10.5)], { customer: { name: "Dana Lee", email: "Dana@Example.com", phone: "555-0100" } });
    check("customer: a new customer is created with the sale", custSale.status === 201 && custSale.json.customer.email === "dana@example.com");
    const danaId = custSale.json.customerId as string;
    const custSale2 = await sale(cashier.token, [{ productId: p2, quantity: 1 }], [cashPay(10.5)], { customer: { email: "dana@example.com" } });
    check("customer: the same email finds the same customer, no duplicate", custSale2.json.customerId === danaId);
    check("customer: search by name, email and phone all find her", (await Promise.all(["dana", "example.com", "0100"].map((q) => api("GET", P(`/customers?q=${q}`), { token: cashier.token })))).every((r) => r.json.some((c: { id: string }) => c.id === danaId)));
    const walkIn = await api("POST", P("/customers"), { token: cashier.token, body: { name: "Walk In", phone: "555-0199" } });
    check("customer: a customer with only a name and phone can be added (201)", walkIn.status === 201 && walkIn.json.email === null);
    check("customer: an empty customer is 400", (await api("POST", P("/customers"), { token: cashier.token, body: {} })).status === 400);
    check("customer: another store's customer id cannot be attached to a sale (404)", (await sale(cashier.token, [{ productId: p2, quantity: 1 }], [cashPay(10.5)], { customerId: (await prismaUnscoped.customer.create({ data: { tenantId: B.storeId, name: "Other" } })).id })).status === 404);
    check("customer: the other store cannot see this store's customers", (await api("GET", `/stores/${B.storeId}/pos/customers?q=dana`, { token: B.token })).json.length === 0);

    // ---- History and receipts ----
    const list = await api("GET", P("/sales?limit=100"), { token: cashier.token });
    check("history: lists only POS sales", list.status === 200 && list.json.data.every((o: { channel: string }) => o.channel === "pos") && list.json.pagination.total >= 6);
    check("history: search by order number", (await api("GET", P(`/sales?q=${s1.json.orderNumber}`), { token: cashier.token })).json.data.some((o: { id: string }) => o.id === s1.json.id));
    check("history: search by customer name", (await api("GET", P("/sales?q=dana"), { token: cashier.token })).json.data.length === 2);
    check("history: a date range that excludes everything is empty", (await api("GET", P("/sales?from=2000-01-01&to=2000-01-02"), { token: cashier.token })).json.data.length === 0);
    check("receipt: a sale can be fetched by id with store, cashier and change", (await api("GET", P(`/sales/${s1.json.id}`), { token: cashier.token })).json.changeDue === 6.8);
    const online = await tenantContext.run(A.storeId, () =>
      createOrder({ tenantId: A.storeId, channel: "ONLINE", guestEmail: "o@example.com", items: [{ productId: p1, quantity: 1 }], payments: [{ method: "STRIPE", amount: 21.6, stripePaymentIntentId: `pi_pos_${suffix}` }] })
    );
    check("history: an online order is not a POS sale (404)", (await api("GET", P(`/sales/${online.id}`), { token: cashier.token })).status === 404);
    check("history: another store cannot read this sale (404)", (await api("GET", `/stores/${B.storeId}/pos/sales/${s1.json.id}`, { token: B.token })).status === 404);

    // ---- Returns ----
    const itemOf = (saleJson: { items: { id: string; productId: string }[] }, productId: string) => saleJson.items.find((i) => i.productId === productId)!.id;
    const ret = (token: string, orderId: string, items: unknown, extra: Record<string, unknown> = {}) =>
      api("POST", P(`/sales/${orderId}/returns`), { token, body: { items, ...extra } });
    const s1Item = itemOf(s1.json, p1);
    check("return: a cashier without the refunds permission cannot take items back (403)", (await ret(cashier.token, s1.json.id, [{ orderItemId: s1Item, quantity: 1 }])).status === 403);
    check("return: an empty return is 400", (await ret(manager.token, s1.json.id, [])).status === 400);
    check("return: an item from a different sale is 400", (await ret(manager.token, s1.json.id, [{ orderItemId: itemOf(s2.json, p1), quantity: 1 }])).status === 400);
    check("return: more than was bought is 409", (await ret(manager.token, s1.json.id, [{ orderItemId: s1Item, quantity: 3 }])).status === 409);
    const stockBeforeR = await stockOf(p1);
    const ret1 = await ret(manager.token, s1.json.id, [{ orderItemId: s1Item, quantity: 1 }], { reason: "Wrong size" });
    check("return: 1 of 2 widgets is refunded 21.60 (20.00 plus its 1.60 tax), paid back in cash like the sale", ret1.status === 201 && ret1.json.returns.length === 1 && ret1.json.returns[0].amount === 21.6 && ret1.json.returns[0].method === "cash" && ret1.json.returns[0].reason === "Wrong size");
    check("return: the sale stays completed and the item shows 1 returned", ret1.json.status === "completed" && ret1.json.items[0].returnedQuantity === 1);
    check("return: the unit went back on the shelf", (await stockOf(p1)) === stockBeforeR + 1);
    const ret2 = await ret(manager.token, s1.json.id, [{ orderItemId: s1Item, quantity: 1 }], { restock: false });
    check("return: returning the last unit settles to the exact remainder and refunds the sale", ret2.status === 201 && ret2.json.status === "refunded" && ret2.json.returns.reduce((s: number, r: { amount: number }) => s + r.amount, 0) === 43.2 && ret2.json.payments.every((p: { status: string }) => p.status === "refunded"));
    check("return: restock false leaves the shelf alone (damaged goods)", (await stockOf(p1)) === stockBeforeR + 1);
    check("return: nothing is left to return (409)", (await ret(manager.token, s1.json.id, [{ orderItemId: s1Item, quantity: 1 }])).status === 409);
    check("return: a whole-order refund after partial returns is refused (409)", (await api("POST", `/stores/${A.storeId}/orders/${s1.json.id}/refund`, { token: manager.token, body: {} })).status === 409);
    check("return: another store cannot return this sale (404)", (await api("POST", `/stores/${B.storeId}/pos/sales/${s1.json.id}/returns`, { token: B.token, body: { items: [{ orderItemId: s1Item, quantity: 1 }] } })).status === 404);

    // rounding: three widgets, 1.01 off, returned one at a time; the parts must add up to the total
    const s3 = await sale(manager.token, [{ productId: p1, quantity: 3 }], [{ method: "card", amount: 63.71 }], { discount: { type: "fixed", value: 1.01, reason: "Damaged box" } });
    check("discount: a fixed 1.01 off three widgets gives 63.71 and records the reason", s3.status === 201 && s3.json.total === 63.71 && s3.json.discountAmount === 1.01 && s3.json.discountReason === "Damaged box");
    const s3Item = itemOf(s3.json, p1);
    const rr = [];
    for (let i = 0; i < 3; i++) rr.push(await ret(manager.token, s3.json.id, [{ orderItemId: s3Item, quantity: 1 }], { refundMethod: "card" }));
    const amounts = rr.map((r) => r.json.returns[r.json.returns.length - 1].amount as number);
    check("return: three single returns of a discounted sale add up to exactly what was paid", rr.every((r) => r.status === 201) && Number(amounts.reduce((a, b) => a + b, 0).toFixed(2)) === 63.71 && rr[2].json.status === "refunded", amounts.join(" + "));

    // two returns racing for the last unit
    const s5 = await sale(cashier.token, [{ productId: p1, quantity: 1 }], [{ method: "card", amount: 21.6 }]);
    const stockBeforeRace = await stockOf(p1);
    const raced = await Promise.all([1, 2].map(() => ret(manager.token, s5.json.id, [{ orderItemId: itemOf(s5.json, p1), quantity: 1 }])));
    check("return: two simultaneous returns of the same unit: one wins (201), one is refused (409)", raced.map((r) => r.status).sort().join() === "201,409");
    check("return: the shelf got the unit back once, not twice", (await stockOf(p1)) === stockBeforeRace + 1);

    // full refund through the orders endpoint still works for an untouched POS sale
    const s4 = await sale(cashier.token, [{ productId: p1, quantity: 1 }], [cashPay(21.6)]);
    const full = await api("POST", `/stores/${A.storeId}/orders/${s4.json.id}/refund`, { token: manager.token, body: { restock: true } });
    check("refund: a whole POS sale can still be refunded from the orders screen", full.status === 200 && full.json.status === "refunded" && full.json.refunds[0].method === "cash");

    // ---- Held sales ----
    const held = await api("POST", P("/held"), { token: cashier.token, body: { label: "Lady in red", items: [{ productId: p1, quantity: 2 }, { productId: p2, quantity: 1 }], discount: { type: "percentage", value: 5, reason: "Birthday" }, customerId: danaId } });
    check("held: a cart is parked with a label (201)", held.status === 201 && held.json.label === "Lady in red" && held.json.itemCount === 3 && held.json.items[0].title === "Widget" && held.json.customerName === "Dana Lee");
    check("held: it appears in the list for any cashier", (await api("GET", P("/held"), { token: manager.token })).json.some((h: { id: string }) => h.id === held.json.id));
    check("held: another store sees none", (await api("GET", `/stores/${B.storeId}/pos/held`, { token: B.token })).json.length === 0);
    check("held: another store cannot resume it (404)", (await api("POST", `/stores/${B.storeId}/pos/held/${held.json.id}/resume`, { token: B.token })).status === 404);
    const resumed = await api("POST", P(`/held/${held.json.id}/resume`), { token: manager.token });
    check("held: resuming returns the cart and discount", resumed.status === 200 && resumed.json.items.length === 2 && resumed.json.discount.value === 5);
    check("held: it can be resumed only once (second try is 404)", (await api("POST", P(`/held/${held.json.id}/resume`), { token: cashier.token })).status === 404);
    const held2 = await api("POST", P("/held"), { token: cashier.token, body: { items: [{ productId: p1, quantity: 1 }] } });
    check("held: a parked cart can be discarded (204)", (await api("DELETE", P(`/held/${held2.json.id}`), { token: cashier.token })).status === 204 && (await api("DELETE", P(`/held/${held2.json.id}`), { token: cashier.token })).status === 404);
    check("held: an unknown customer is 404", (await api("POST", P("/held"), { token: cashier.token, body: { items: [{ productId: p1, quantity: 1 }], customerId: "nope" } })).status === 404);

    // ---- Closing the drawer ----
    const live = (await api("GET", P("/shift"), { token: cashier.token })).json;
    // float 100 + cash sales (s1 43.20, s2 20.00, custSale 10.50, custSale2 10.50, s4 21.60) - cash paid back (returns 43.20, refund 21.60)
    check("drawer: expected cash is float + cash sales - cash paid back (100 + 105.80 - 64.80 = 141.00)", live.expectedCash === 141 && live.totals.cashSales === 105.8 && live.totals.cashRefunds === 64.8, JSON.stringify(live.totals));
    check("drawer: card sales are counted apart from cash", live.totals.cardSales > 0 && live.totals.salesCount >= 10);
    check("drawer: a manager who did not open it cannot close it (403)", (await api("POST", P("/shift/close"), { token: manager.token, body: { countedCash: 141 } })).status === 403);
    check("drawer: a negative count is 400", (await api("POST", P("/shift/close"), { token: cashier.token, body: { countedCash: -1 } })).status === 400);
    const closed = await api("POST", P("/shift/close"), { token: cashier.token, body: { countedCash: 138.5, note: "Short, gave wrong change" } });
    check("drawer: closing with 138.50 counted shows a 2.50 shortage", closed.status === 200 && closed.json.status === "closed" && closed.json.expectedCash === 141 && closed.json.countedCash === 138.5 && closed.json.variance === -2.5 && closed.json.note === "Short, gave wrong change", JSON.stringify(closed.json).slice(0, 200));
    check("drawer: no shift is open afterwards, and selling is refused (409)", (await api("GET", P("/shift"), { token: cashier.token })).json === null && (await sale(cashier.token, [{ productId: p1, quantity: 1 }], [cashPay(21.6)])).status === 409);
    check("drawer: closing again is 409", (await api("POST", P("/shift/close"), { token: cashier.token, body: { countedCash: 0 } })).status === 409);

    // ---- Concurrency around the drawer ----
    const opens = await Promise.all([1, 2, 3].map(() => api("POST", P("/shift/open"), { token: manager.token, body: { openingFloat: 50 } })));
    check("shift: three simultaneous opens: exactly one wins", opens.map((r) => r.status).sort().join() === "201,409,409");
    const shift2 = opens.find((r) => r.status === 201)!.json.id as string;
    // Sales already running when the close arrives must be counted; later ones must be refused.
    // The close is fired after a short random delay so the two overlap in different ways.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let shiftId = shift2;
    let totalOk = 0;
    let allConsistent = true;
    let closerOk = true;
    for (let round = 0; round < 4; round++) {
      const race = await Promise.all([
        ...[1, 2, 3, 4, 5, 6].map(() => sale(cashier.token, [{ productId: p1, quantity: 1 }], [cashPay(21.6)])),
        sleep(round * 25).then(() => api("POST", P("/shift/close"), { token: A.token, body: { countedCash: 0 } })),
      ]);
      const salesRes = race.slice(0, 6);
      const okSales = salesRes.filter((r) => r.status === 201);
      totalOk += okSales.length;
      const frozen = race[6];
      closerOk &&= frozen.status === 200 && frozen.json.closedBy.id === A.userId;
      allConsistent &&=
        salesRes.every((r) => r.status === 201 || r.status === 409) &&
        okSales.every((r) => r.json.shiftId === shiftId) &&
        frozen.json.expectedCash === Number((50 + 21.6 * okSales.length).toFixed(2));
      shiftId = (await api("POST", P("/shift/open"), { token: manager.token, body: { openingFloat: 50 } })).json.id as string;
    }
    check("drawer race: four rounds of sales racing a close: each sale completed inside the shift or was refused", allConsistent, `completed=${totalOk}`);
    check("drawer race: every completed sale is in the frozen expected cash (nothing slips through), and the owner can close any shift", allConsistent && closerOk);
    const shift3 = shiftId;
    check("shift: a new shift opens after closing", !!shift3 && shift3 !== shift2);

    // ---- Daily summary ----
    const window = `from=${encodeURIComponent(started.toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`;
    check("report: a cashier without analytics access is 403", (await api("GET", P(`/reports/daily?${window}`), { token: cashier.token })).status === 403);
    check("report: a window over 32 days is 400", (await api("GET", P("/reports/daily?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z"), { token: A.token })).status === 400);
    check("report: 'to' before 'from' is 400", (await api("GET", P("/reports/daily?from=2026-02-02T00:00:00Z&to=2026-02-01T00:00:00Z"), { token: A.token })).status === 400);
    const rep = await api("GET", P(`/reports/daily?${window}`), { token: manager.token });
    const dbOrders = await prismaUnscoped.order.findMany({ where: { tenantId: A.storeId, channel: "POS", status: { in: ["COMPLETED", "REFUNDED"] } } });
    const dbGross = dbOrders.reduce((s, o) => s + Math.round(Number(o.total) * 100), 0) / 100;
    const dbRefunds =
      ((await prismaUnscoped.refund.findMany({ where: { tenantId: A.storeId } })).reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) +
        (await prismaUnscoped.orderReturn.findMany({ where: { tenantId: A.storeId } })).reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)) /
      100;
    check("report: gross sales, sales count and refunds match the database", rep.status === 200 && rep.json.grossSales === Number(dbGross.toFixed(2)) && rep.json.salesCount === dbOrders.length && rep.json.refunds.total === Number(dbRefunds.toFixed(2)), `gross=${rep.json.grossSales}/${dbGross} refunds=${rep.json.refunds.total}/${dbRefunds}`);
    check("report: net = gross - refunds", rep.json.netSales === Number((rep.json.grossSales - rep.json.refunds.total).toFixed(2)));
    const methodNet = rep.json.byPaymentMethod.reduce((s: number, m: { net: number }) => s + m.net, 0);
    check("report: the payment-method split adds up to net sales", Math.abs(methodNet - rep.json.netSales) < 0.005 && rep.json.byPaymentMethod.some((m: { method: string }) => m.method === "cash") && rep.json.byPaymentMethod.some((m: { method: string }) => m.method === "card"));
    check("report: per-cashier totals name the cashier and add up", rep.json.byCashier.some((c: { name: string }) => c.name === "Riley Chen") && Math.abs(rep.json.byCashier.reduce((s: number, c: { net: number }) => s + c.net, 0) - rep.json.netSales) < 0.005);
    check("report: top items lists widgets first", rep.json.topItems[0].title === "Widget");
    check("report: every shift in the window appears with its variance", rep.json.shifts.length >= 3 && rep.json.shifts.some((s: { variance: number | null }) => s.variance === -2.5));
    check("report: the other store sees none of it", (await api("GET", `/stores/${B.storeId}/pos/reports/daily?${window}`, { token: B.token })).json.salesCount === 0);

    // ---- Settings ----
    check("settings: staff cannot change the discount limit (403)", (await api("PUT", P("/settings"), { token: manager.token, body: { maxCashierDiscountPercent: 50 } })).status === 403);
    check("settings: over 100 is 400", (await api("PUT", P("/settings"), { token: A.token, body: { maxCashierDiscountPercent: 101 } })).status === 400);
    check("settings: the owner sets the limit to 5%", (await api("PUT", P("/settings"), { token: A.token, body: { maxCashierDiscountPercent: 5 } })).json.maxCashierDiscountPercent === 5);
    check("settings: a cashier's 10% discount is now refused, exactly 5% is fine (no half-cent surprises)", (await api("POST", P("/quote"), { token: cashier.token, body: { items: twoW1G, discount: { type: "percentage", value: 10 } } })).status === 403 && (await api("POST", P("/quote"), { token: cashier.token, body: { items: twoW1G, discount: { type: "percentage", value: 5 } } })).status === 200);
    check("settings: the session shows the new limit", (await api("GET", P("/session"), { token: cashier.token })).json.settings.maxCashierDiscountPercent === 5);

    // ---- Consistency and database guarantees ----
    for (const id of [p1, p2]) {
      const movements = await prismaUnscoped.stockMovement.findMany({ where: { tenantId: A.storeId, productId: id } });
      check(`ledger: stock movements add up to the shelf count (${id === p1 ? "widget" : "gadget"})`, movements.reduce((s, m) => s + m.quantityChange, 0) === (await stockOf(id)));
    }
    check("database: two open shifts at one location cannot exist even by direct insert", await prismaUnscoped.posShift.create({ data: { tenantId: A.storeId, locationId: (await prismaUnscoped.location.findFirst({ where: { tenantId: A.storeId } }))!.id, openedByUserId: A.userId, openingFloat: "1.00" } }).then(() => false, () => true));
    const anyItem = await prismaUnscoped.orderItem.findFirst({ where: { order: { tenantId: A.storeId } } });
    check("database: returned quantity can never exceed the quantity sold", await prismaUnscoped.orderItem.update({ where: { id: anyItem!.id }, data: { returnedQuantity: anyItem!.quantity + 1 } }).then(() => false, () => true));
    check("database: another store owns none of these records", (await prismaUnscoped.posShift.count({ where: { tenantId: B.storeId } })) === 0 && (await prismaUnscoped.orderReturn.count({ where: { tenantId: B.storeId } })) === 0 && (await prismaUnscoped.heldSale.count({ where: { tenantId: B.storeId } })) === 0);
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
