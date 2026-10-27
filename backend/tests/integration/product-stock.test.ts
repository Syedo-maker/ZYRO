/**
 * The quick stock control (the supervisor's product-listing change): an owner changes a product's
 * stock alone, for example 11 to 7, from the products list. The count is recorded as an adjustment,
 * and the shop and the cart use the new number at once. Nobody else can change it.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let Category: typeof import("../../src/models/Category.model").Category;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string) {
  const reg = await api("POST", "/auth/register", {
    body: { email: `verify-stock-${tag}-${suffix}@example.com`, password: "password123", storeName: `Stock ${tag}`, storeSlug: `verify-stock-${tag}-${suffix}`, currency: "PKR" },
  });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
}

let A: Awaited<ReturnType<typeof owner>>;
let B: Awaited<ReturnType<typeof owner>>;
let cashierToken = "";
let productId = "";
let otherStoreProduct = "";
const stockPath = (storeId: string, id: string) => `/stores/${storeId}/products/${id}/stock`;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ Category } = await import("../../src/models/Category.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  A = await owner("a");
  B = await owner("b");
  productId = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Lamp", actualPrice: 500, stock: 11, category: "Home" } })).json.id;
  otherStoreProduct = (await api("POST", `/stores/${B.storeId}/products`, { token: B.token, body: { title: "Rug", actualPrice: 900, stock: 4, category: "Home" } })).json.id;
  const email = `verify-stock-cashier-${suffix}@example.com`;
  await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email, password: "cashier-pass-1", permissions: ["pos_sell"] } });
  const login = await api("POST", "/auth/login", { body: { email, password: "cashier-pass-1" } });
  cashierToken = login.json.accessToken;
  created.userIds.push(login.json.user.id);
}, 120_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  await Category.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("changing the stock alone", () => {
  it("sets 11 to 7, and the product shows 7 everywhere at once", async () => {
    const res = await api("PATCH", stockPath(A.storeId, productId), { token: A.token, body: { stock: 7 } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: productId, stock: 7 });
    expect((await api("GET", `/stores/${A.storeId}/products/${productId}`)).json.stock).toBe(7);
    const listed = (await api("GET", `/stores/${A.storeId}/products`)).json.data.find((p: { id: string }) => p.id === productId);
    expect(listed.stock).toBe(7);
  });

  it("is recorded as an adjustment by the owner, from 11 to 7", async () => {
    const last = await prismaUnscoped.stockMovement.findFirst({ where: { tenantId: A.storeId, productId }, orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ type: "ADJUSTMENT", quantityChange: -4, quantityAfter: 7, createdByUserId: A.userId });
  });

  it("leaves everything else about the product as it was", async () => {
    const p = (await api("GET", `/stores/${A.storeId}/products/${productId}`)).json;
    expect(p).toMatchObject({ title: "Lamp", actualPrice: 500, salePrice: 500, category: "Home" });
  });

  it("the cart cannot take more than the new count", async () => {
    const guest = `guest-${suffix}-stock001`;
    expect((await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId, quantity: 8 } })).status).toBe(409);
    expect((await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId, quantity: 7 } })).status).toBe(200);
  });

  it("setting it to 0 sells it out", async () => {
    expect((await api("PATCH", stockPath(A.storeId, productId), { token: A.token, body: { stock: 0 } })).json.stock).toBe(0);
    expect((await api("POST", `/stores/${A.storeId}/cart/items`, { guest: `guest-${suffix}-stock002`, body: { productId, quantity: 1 } })).status).toBe(409);
    await api("PATCH", stockPath(A.storeId, productId), { token: A.token, body: { stock: 7 } });
  });

  it.each([
    ["a negative count", { stock: -1 }],
    ["a fraction", { stock: 2.5 }],
    ["text", { stock: "7" }],
    ["nothing", {}],
  ])("refuses %s", async (_label, body) => {
    expect((await api("PATCH", stockPath(A.storeId, productId), { token: A.token, body })).status).toBe(400);
    expect((await api("GET", `/stores/${A.storeId}/products/${productId}`)).json.stock).toBe(7);
  });
});

describe("only this store's product managers can change it", () => {
  it("nobody signed out, and no cashier without the products permission", async () => {
    expect((await api("PATCH", stockPath(A.storeId, productId), { body: { stock: 1 } })).status).toBe(401);
    expect((await api("PATCH", stockPath(A.storeId, productId), { token: cashierToken, body: { stock: 1 } })).status).toBe(403);
  });

  it("another store's owner cannot, directly or through their own store", async () => {
    expect((await api("PATCH", stockPath(A.storeId, productId), { token: B.token, body: { stock: 1 } })).status).toBe(403);
    expect((await api("PATCH", stockPath(B.storeId, productId), { token: B.token, body: { stock: 1 } })).status).toBe(404);
    expect((await api("PATCH", stockPath(A.storeId, otherStoreProduct), { token: A.token, body: { stock: 1 } })).status).toBe(404);
    expect((await api("GET", `/stores/${A.storeId}/products/${productId}`)).json.stock).toBe(7);
    expect((await api("GET", `/stores/${B.storeId}/products/${otherStoreProduct}`)).json.stock).toBe(4);
  });

  it("an unknown product is not found", async () => {
    expect((await api("PATCH", stockPath(A.storeId, "64b7f0f0f0f0f0f0f0f0f0f0"), { token: A.token, body: { stock: 1 } })).status).toBe(404);
    expect((await api("PATCH", stockPath(A.storeId, "not-an-id"), { token: A.token, body: { stock: 1 } })).status).toBe(404);
  });
});
