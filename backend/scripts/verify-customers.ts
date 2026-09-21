/**
 * End-to-end check of the shopper-facing additions (Phase 3 frontend item): customer sign-up,
 * "my orders" without the store's internal fields, and the category list with counts, against
 * the real local Postgres and MongoDB, through the real HTTP API. Creates throwaway stores and
 * users and removes them after.
 * Usage: npx tsx scripts/verify-customers.ts
 */
process.env.RATE_LIMIT_ENABLED = "false"; // verify-security.ts covers the limits
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
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function merchant(tag: string) {
    const email = `verify-cu-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-cu-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }

  try {
    const A = await merchant("a");
    const B = await merchant("b");

    // ---- Customer sign-up ----
    const email1 = `verify-cu-c1-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register-customer", { body: { email: email1, password: "password123", name: "  Aisha Khan " } });
    check("sign-up: a shopper creates an account with just an email and password (201) and is signed in", reg.status === 201 && !!reg.json.accessToken && reg.json.user.email === email1);
    created.userIds.push(reg.json.user.id);
    const c1 = { token: reg.json.accessToken as string, userId: reg.json.user.id as string };
    check("sign-up: the name is trimmed and saved, and a refresh cookie is set", reg.json.user.name === "Aisha Khan" && (reg.headers.get("set-cookie") ?? "").includes("refreshToken="));
    check("sign-up: it is a plain account: no store is created", (await api("GET", "/users/me/stores", { token: c1.token })).json.length === 0);
    check("sign-up: the account can sign in afterwards", (await api("POST", "/auth/login", { body: { email: email1, password: "password123" } })).status === 200);
    check("sign-up: the same email again is 409, and a merchant's email cannot be taken either", (await api("POST", "/auth/register-customer", { body: { email: email1, password: "password123" } })).status === 409 && (await api("POST", "/auth/register-customer", { body: { email: `verify-cu-a-${suffix}@example.com`, password: "password123" } })).status === 409);
    const bad = async (body: unknown) => (await api("POST", "/auth/register-customer", { body })).status;
    check("sign-up: a short password, a bad email, an over-long password or name are all 400", (await bad({ email: `x-${suffix}@example.com`, password: "short" })) === 400 && (await bad({ email: "not-an-email", password: "password123" })) === 400 && (await bad({ email: `y-${suffix}@example.com`, password: "a".repeat(73) })) === 400 && (await bad({ email: `z-${suffix}@example.com`, password: "password123", name: "n".repeat(121) })) === 400);
    check("sign-up: a name is optional", await (async () => { const r = await api("POST", "/auth/register-customer", { body: { email: `verify-cu-c2-${suffix}@example.com`, password: "password123" } }); created.userIds.push(r.json.user.id); return r.status === 201 && r.json.user.name === null; })());
    const c2 = await api("POST", "/auth/login", { body: { email: `verify-cu-c2-${suffix}@example.com`, password: "password123" } });
    const c2token = c2.json.accessToken as string;
    const c2id = c2.json.user.id as string;

    // ---- Orders ----
    const mkProduct = async (s: { token: string; storeId: string }, title: string, price: number, category: string) =>
      (await api("POST", `/stores/${s.storeId}/products`, { token: s.token, body: { title, price, stock: 50, category } })).json.id as string;
    const mug = await mkProduct(A, "Mug", 10, "kitchen");
    const bMug = await mkProduct(B, "Other Mug", 10, "kitchen");
    const customerOf = (tenantId: string, userId: string, email: string) => prismaUnscoped.customer.create({ data: { tenantId, userId, email, name: "C" } });
    const cust1 = await customerOf(A.storeId, c1.userId, email1);
    const cust2 = await customerOf(A.storeId, c2id, `verify-cu-c2-${suffix}@example.com`);
    const custB = await customerOf(B.storeId, c1.userId, email1);
    let pi = 0;
    const place = (storeId: string, productId: string, customerId: string, qty = 1) =>
      tenantContext.run(storeId, () => createOrder({ tenantId: storeId, channel: "ONLINE", customerId, items: [{ productId, quantity: qty }], payments: [{ method: "STRIPE", amount: 10 * qty, stripePaymentIntentId: `pi_cu_${suffix}_${++pi}` }] }));
    const o1 = await place(A.storeId, mug, cust1.id);
    await place(A.storeId, mug, cust1.id, 2);
    const o3 = await place(A.storeId, mug, cust2.id);
    await place(B.storeId, bMug, custB.id);
    const pos = await tenantContext.run(A.storeId, () => createOrder({ tenantId: A.storeId, channel: "POS", customerId: cust1.id, cashierUserId: A.userId, items: [{ productId: mug, quantity: 1 }], payments: [{ method: "CASH", amount: 10 }] }));

    const mine = await api("GET", `/stores/${A.storeId}/orders/mine`, { token: c1.token });
    check("my orders: a shopper sees exactly their own orders at this store, newest first (2 online + 1 in-store)", mine.status === 200 && mine.json.pagination.total === 3 && mine.json.data.length === 3 && mine.json.data[0].orderNumber > mine.json.data[2].orderNumber, `total=${mine.json.pagination?.total}`);
    check("my orders: never another shopper's, and never another store's", !mine.json.data.some((o: { id: string }) => o.id === o3.id) && mine.json.data.every((o: { storeId: string }) => o.storeId === A.storeId));
    check("my orders: none of the store's internal fields (cashier, shift, location, customer id, discount reason)", mine.json.data.every((o: Record<string, unknown>) => !("cashierUserId" in o) && !("shiftId" in o) && !("locationId" in o) && !("customerId" in o) && !("discountReason" in o)));
    check("my orders: the useful parts are there (items, payments, totals, status, shipment)", mine.json.data[2].items.length === 1 && mine.json.data[2].payments.length === 1 && mine.json.data[2].total === 10 && mine.json.data[2].status === "paid" && "shipment" in mine.json.data[2]);
    check("my orders: paging", (await api("GET", `/stores/${A.storeId}/orders/mine?limit=2&offset=2`, { token: c1.token })).json.data.length === 1 && (await api("GET", `/stores/${A.storeId}/orders/mine?limit=51`, { token: c1.token })).status === 400);
    check("my orders: a shopper with no orders here gets an empty list, and needs to be signed in (401)", (await api("GET", `/stores/${B.storeId}/orders/mine`, { token: c2token })).json.pagination.total === 0 && (await api("GET", `/stores/${A.storeId}/orders/mine`)).status === 401);
    check("my orders: 'mine' is not mistaken for an order id, and the merchant list is still for staff only", (await api("GET", `/stores/${A.storeId}/orders`, { token: c1.token })).status === 403);
    const one = await api("GET", `/stores/${A.storeId}/orders/${o1.id}`, { token: c1.token });
    check("order detail: a shopper can open their own order, without internal fields", one.status === 200 && one.json.id === o1.id && !("cashierUserId" in one.json) && !("shiftId" in one.json));
    check("order detail: someone else's order is 404 (ids cannot be probed)", (await api("GET", `/stores/${A.storeId}/orders/${o3.id}`, { token: c1.token })).status === 404);
    const merchantView = await api("GET", `/stores/${A.storeId}/orders/${pos.id}`, { token: A.token });
    check("order detail: the merchant still sees the full view (cashier and shift)", merchantView.status === 200 && merchantView.json.cashierUserId === A.userId && "shiftId" in merchantView.json);

    // ---- Categories ----
    await mkProduct(A, "Bowl", 8, "kitchen");
    await mkProduct(A, "Lamp", 30, "lighting");
    await mkProduct(A, "Poster", 6, "art");
    await mkProduct(A, "Tea Towel", 4, "kitchen");
    const cats = await api("GET", `/stores/${A.storeId}/products/categories`);
    check("categories: public list with counts, biggest first then by name (kitchen 3, art 1, lighting 1)", cats.status === 200 && JSON.stringify(cats.json) === JSON.stringify([{ name: "kitchen", count: 3 }, { name: "art", count: 1 }, { name: "lighting", count: 1 }]), JSON.stringify(cats.json));
    check("categories: another store has its own list, and an empty store has none", JSON.stringify((await api("GET", `/stores/${B.storeId}/products/categories`)).json) === JSON.stringify([{ name: "kitchen", count: 1 }]) && (await api("GET", `/stores/${(await merchant("empty")).storeId}/products/categories`)).json.length === 0);
    check("categories: 'categories' is not mistaken for a product id", cats.status === 200 && Array.isArray(cats.json));

    // ---- Signing in keeps the cart ----
    const guestId = `guest-${suffix}-mergeaaaaaaaa`;
    const stocked = await mkProduct(A, "Limited Print", 9, "art");
    await api("PATCH", `/stores/${A.storeId}/products/${stocked}`, { token: A.token, body: {} }).catch(() => undefined);
    const addGuest = (productId: string, quantity: number) => fetch(`${base}/stores/${A.storeId}/cart/items`, { method: "POST", headers: { "Content-Type": "application/json", "X-Guest-Session-Id": guestId }, body: JSON.stringify({ productId, quantity }) });
    const getCart = async (headers: Record<string, string>) => (await fetch(`${base}/stores/${A.storeId}/cart`, { headers })).json();
    const merge = (token: string | undefined, guest: string | undefined) => fetch(`${base}/stores/${A.storeId}/cart/merge`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(guest ? { "X-Guest-Session-Id": guest } : {}) } });
    const userAdd = (productId: string, quantity: number) => fetch(`${base}/stores/${A.storeId}/cart/items`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${c2token}` }, body: JSON.stringify({ productId, quantity }) });
    await addGuest(mug, 2);
    await addGuest(stocked, 3);
    await userAdd(mug, 1);
    const merged = await (await merge(c2token, guestId)).json();
    const qty = (cart: { items: { productId: string; quantity: number }[] }, id: string) => cart.items.find((i) => i.productId === id)?.quantity;
    check("cart merge: signing in adds the guest cart to the account cart (1 + 2 mugs = 3, plus 3 prints)", qty(merged, mug) === 3 && qty(merged, stocked) === 3);
    check("cart merge: the guest cart is emptied, so nothing is counted twice", (await getCart({ "X-Guest-Session-Id": guestId })).items.length === 0);
    check("cart merge: merging again changes nothing (idempotent)", qty(await (await merge(c2token, guestId)).json(), mug) === 3);
    const scarce = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Scarce", price: 5, stock: 2, category: "art" } })).json.id as string;
    await userAdd(scarce, 1);
    await addGuest(scarce, 1);
    const clamp = await (await merge(c2token, guestId)).json();
    await fetch(`${base}/stores/${A.storeId}/cart/items`, { method: "POST", headers: { "Content-Type": "application/json", "X-Guest-Session-Id": guestId }, body: JSON.stringify({ productId: scarce, quantity: 1 }) });
    check("cart merge: quantities are held to what is in stock (1 + 1 of a product with 2 left is 2, never more)", qty(clamp, scarce) === 2);
    await addGuest(scarce, 1);
    check("cart merge: asking for more than the shelf holds is clamped, not an error", qty(await (await merge(c2token, guestId)).json(), scarce) === 2);
    await addGuest(mug, 2);
    const both = await Promise.all([merge(c2token, guestId), merge(c2token, guestId)]);
    const final = await getCart({ Authorization: `Bearer ${c2token}` });
    check("cart merge: two tabs signing in at once add the guest cart only once (3 + 2 = 5, not 7)", both.every((r) => r.status === 200) && qty(final, mug) === 5);
    check("cart merge: a guest cannot merge (401), and a malformed guest id is 400", (await merge(undefined, guestId)).status === 401 && (await merge(c2token, "short")).status === 400);
    check("cart merge: without a guest id header it is 400; with nothing to merge it is 200 and unchanged", (await merge(c2token, undefined)).status === 400 && qty(await (await merge(c2token, `guest-${suffix}-nothingtomerge`)).json(), mug) === 5);
    await addGuest(mug, 1);
    await api("DELETE", `/stores/${A.storeId}/products/${stocked}`, { token: A.token });
    const skipped = await (await merge(c2token, guestId)).json();
    check("cart merge: a product deleted since it was added is skipped, not an error", qty(skipped, stocked) === undefined && qty(skipped, mug) === 6);
    check("cart merge: another store's cart is untouched", (await (await fetch(`${base}/stores/${B.storeId}/cart`, { headers: { Authorization: `Bearer ${c2token}` } })).json()).items.length === 0);
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
