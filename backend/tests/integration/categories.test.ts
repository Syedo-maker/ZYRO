/**
 * A store's own categories (the supervisor's product-listing change): one name per store whatever
 * the capitals or spacing, nothing visible or changeable from another store, a rename that reaches
 * every product in the category, and no deleting a category that still has products.
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

async function api(method: string, p: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string) {
  const reg = await api("POST", "/auth/register", {
    body: { email: `verify-cat-${tag}-${suffix}@example.com`, password: "password123", storeName: `Cat ${tag}`, storeSlug: `verify-cat-${tag}-${suffix}`, currency: "PKR" },
  });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId };
}

let A: Awaited<ReturnType<typeof owner>>;
let B: Awaited<ReturnType<typeof owner>>;
let cashierToken = "";
let toys = "";

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ Category } = await import("../../src/models/Category.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  await Category.syncIndexes();
  A = await owner("a");
  B = await owner("b");
  const email = `verify-cat-cashier-${suffix}@example.com`;
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

describe("one name per store, whatever the capitals or spacing", () => {
  it("creates a category and keeps the name as the owner typed it", async () => {
    const res = await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "  Toys " } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Toys", active: true, productCount: 0 });
    toys = res.json.id;
  });

  it.each([["toys"], ["TOYS"], [" TOYS "], ["tOyS"], ["Toys\t"]])("refuses %j as the same category, with a clear message", async (name) => {
    const res = await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name } });
    expect(res.status).toBe(409);
    expect(res.json.detail).toMatch(/already exists/);
  });

  it("treats inner runs of spaces as one space, and keeps the display tidy", async () => {
    const first = await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "Kids   Shoes" } });
    expect(first.status).toBe(201);
    expect(first.json.name).toBe("Kids Shoes");
    expect((await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "kids shoes" } })).status).toBe(409);
  });

  it("the database itself refuses a duplicate, not only the API", async () => {
    await expect(Category.create({ storeId: A.storeId, name: "TOYS", normalizedName: "toys", active: true })).rejects.toMatchObject({ code: 11000 });
  });

  it("refuses an empty name, a name over 60 characters, and an update with nothing in it", async () => {
    expect((await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "   " } })).status).toBe(400);
    expect((await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "x".repeat(61) } })).status).toBe(400);
    expect((await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: {} })).status).toBe(400);
  });
});

describe("each store's categories are its own", () => {
  it("another store may have a category with the same name", async () => {
    const res = await api("POST", `/stores/${B.storeId}/categories`, { token: B.token, body: { name: "toys" } });
    expect(res.status).toBe(201);
  });

  it("another store's owner cannot list, create, rename or delete in this store", async () => {
    expect((await api("GET", `/stores/${A.storeId}/categories`, { token: B.token })).status).toBe(403);
    expect((await api("POST", `/stores/${A.storeId}/categories`, { token: B.token, body: { name: "Mine now" } })).status).toBe(403);
    expect((await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: B.token, body: { name: "Hacked" } })).status).toBe(403);
    expect((await api("DELETE", `/stores/${A.storeId}/categories/${toys}`, { token: B.token })).status).toBe(403);
  });

  it("a category id from another store is not found, even through the caller's own store", async () => {
    expect((await api("PATCH", `/stores/${B.storeId}/categories/${toys}`, { token: B.token, body: { name: "Hacked" } })).status).toBe(404);
    expect((await api("DELETE", `/stores/${B.storeId}/categories/${toys}`, { token: B.token })).status).toBe(404);
    const mine = (await api("GET", `/stores/${B.storeId}/categories`, { token: B.token })).json as { id: string }[];
    expect(mine.map((c) => c.id)).not.toContain(toys);
    expect((await Category.findOne({ _id: toys, storeId: A.storeId }))!.name).toBe("Toys");
  });

  it("staff without the products permission cannot manage categories; nobody signed out can", async () => {
    expect((await api("GET", `/stores/${A.storeId}/categories`, { token: cashierToken })).status).toBe(403);
    expect((await api("POST", `/stores/${A.storeId}/categories`, { token: cashierToken, body: { name: "Snacks" } })).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/categories`)).status).toBe(401);
  });
});

describe("a category and its products", () => {
  let productId = "";

  it("a product is put in a category by id, and carries its name", async () => {
    const res = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Rubber Duck", price: 300, stock: 4, categoryId: toys } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ categoryId: toys, category: "Toys" });
    productId = res.json.id;
    const list = (await api("GET", `/stores/${A.storeId}/categories`, { token: A.token })).json as { id: string; productCount: number }[];
    expect(list.find((c) => c.id === toys)!.productCount).toBe(1);
  });

  it("a product needs a category, from this store", async () => {
    const base = { title: "Kite", price: 500, stock: 1 };
    expect((await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: base })).status).toBe(400);
    const bToys = (await api("GET", `/stores/${B.storeId}/categories`, { token: B.token })).json[0].id as string;
    const foreign = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { ...base, categoryId: bToys } });
    expect(foreign.status).toBe(400);
    expect(foreign.json.detail).toMatch(/this store's categories/);
    expect((await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { ...base, categoryId: "not-an-id" } })).status).toBe(400);
  });

  it("a disabled category cannot take a new product", async () => {
    await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { active: false } });
    const res = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Kite", price: 500, stock: 1, categoryId: toys } });
    expect(res.status).toBe(400);
    expect(res.json.detail).toMatch(/disabled/);
    await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { active: true } });
  });

  it("a product already in a disabled category can still be edited, but no other product can move in", async () => {
    await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { active: false } });
    const edit = await api("PUT", `/stores/${A.storeId}/products/${productId}`, { token: A.token, body: { title: "Rubber Duck", price: 320, stock: 4, categoryId: toys } });
    expect(edit.status).toBe(200);
    expect(edit.json).toMatchObject({ categoryId: toys, actualPrice: 320 });
    const other = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Ball", price: 90, stock: 1, category: "Kids Shoes" } });
    const move = await api("PUT", `/stores/${A.storeId}/products/${other.json.id}`, { token: A.token, body: { title: "Ball", price: 90, stock: 1, categoryId: toys } });
    expect(move.status).toBe(400);
    await api("DELETE", `/stores/${A.storeId}/products/${other.json.id}`, { token: A.token });
    await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { active: true } });
  });

  it("an older caller naming a category by text gets the existing one, not a duplicate", async () => {
    const res = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Spinning Top", price: 150, stock: 2, category: "  TOYS " } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ categoryId: toys, category: "Toys" });
    expect((await Category.countDocuments({ storeId: A.storeId, normalizedName: "toys" }))).toBe(1);
    await api("DELETE", `/stores/${A.storeId}/products/${res.json.id}`, { token: A.token });
  });

  it("an edit can move a product to another category", async () => {
    const shoes = (await api("GET", `/stores/${A.storeId}/categories`, { token: A.token })).json.find((c: { name: string }) => c.name === "Kids Shoes").id as string;
    const moved = await api("PUT", `/stores/${A.storeId}/products/${productId}`, { token: A.token, body: { title: "Rubber Duck", price: 300, stock: 4, categoryId: shoes } });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ categoryId: shoes, category: "Kids Shoes" });
    await api("PUT", `/stores/${A.storeId}/products/${productId}`, { token: A.token, body: { title: "Rubber Duck", price: 300, stock: 4, categoryId: toys } });
  });

  it("a rename reaches every product in the category", async () => {
    const res = await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { name: "Kids Toys" } });
    expect(res.status).toBe(200);
    expect(res.json.name).toBe("Kids Toys");
    expect((await api("GET", `/stores/${A.storeId}/products/${productId}`)).json.category).toBe("Kids Toys");
  });

  it("a rename onto another category's name is refused", async () => {
    expect((await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { name: "KIDS shoes" } })).status).toBe(409);
  });

  it("can be disabled and enabled again", async () => {
    expect((await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { active: false } })).json.active).toBe(false);
    expect((await api("PATCH", `/stores/${A.storeId}/categories/${toys}`, { token: A.token, body: { active: true } })).json.active).toBe(true);
  });

  it("cannot be deleted while it has products, and says how many to move", async () => {
    const res = await api("DELETE", `/stores/${A.storeId}/categories/${toys}`, { token: A.token });
    expect(res.status).toBe(409);
    expect(res.json.detail).toMatch(/1 product\b.*another category/);
  });

  it("can be deleted once its products have moved", async () => {
    const other = await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "Bath" } });
    await Product.updateOne({ _id: productId, storeId: A.storeId }, { $set: { categoryId: other.json.id, category: "Bath" } });
    expect((await api("DELETE", `/stores/${A.storeId}/categories/${toys}`, { token: A.token })).status).toBe(204);
    expect((await api("GET", `/stores/${A.storeId}/categories`, { token: A.token })).json.map((c: { id: string }) => c.id)).not.toContain(toys);
  });
});
