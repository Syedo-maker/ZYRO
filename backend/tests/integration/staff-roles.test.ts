/**
 * Staff roles (2026-10-22): a Manager runs the catalogue (products, stock, categories, the AI tools,
 * which spend the store's own allowance); a Cashier works the register only; billing, the team, plans
 * and AI packs, and the store's settings stay with the owner. Every check below goes through the API,
 * so it is the server that refuses, whatever a page shows. Only the owner changes a role; a staff
 * member can change neither their own nor anyone else's, and the owner cannot be changed at all.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
process.env.AI_QUEUE_NAME = `ai-generate-verify-roles-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let Category: typeof import("../../src/models/Category.model").Category;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const providerCalls: string[] = [];
let reply = "A short description.";

async function api(method: string, p: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string) {
  const reg = await api("POST", "/auth/register", {
    body: { email: `verify-roles-${tag}-${suffix}@example.com`, password: "password123", storeName: `Roles ${tag}`, storeSlug: `verify-roles-${tag}-${suffix}`, currency: "PKR" },
  });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
}

/** Adds a staff member with a role, the way the Team page does, and signs them in. */
async function staff(o: { token: string; storeId: string }, tag: string, role: "cashier" | "manager") {
  const email = `verify-roles-${tag}-${suffix}@example.com`;
  const added = await api("POST", `/stores/${o.storeId}/staff`, { token: o.token, body: { email, password: "staff-pass-123", role } });
  expect(added.status).toBe(201);
  const login = await api("POST", "/auth/login", { body: { email, password: "staff-pass-123" } });
  created.userIds.push(login.json.user.id);
  return { token: login.json.accessToken as string, staffId: added.json.id as string, member: added.json };
}

let O: Awaited<ReturnType<typeof owner>>;
let other: Awaited<ReturnType<typeof owner>>;
let manager: Awaited<ReturnType<typeof staff>>;
let cashier: Awaited<ReturnType<typeof staff>>;
let categoryId = "";
let productId = "";

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ Category } = await import("../../src/models/Category.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      providerCalls.push(p.system.slice(0, 40));
      return { text: reply, model: "fake-model-roles", inputTokens: 30, outputTokens: 10 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  O = await owner("o");
  other = await owner("x");
  manager = await staff(O, "m", "manager");
  cashier = await staff(O, "c", "cashier");
  categoryId = (await api("POST", `/stores/${O.storeId}/categories`, { token: O.token, body: { name: "Kitchen" } })).json.id;
  productId = (await api("POST", `/stores/${O.storeId}/products`, { token: O.token, body: { title: "Copper Kettle", description: "Hand-hammered.", actualPrice: 2500, stock: 11, categoryId } })).json.id;
}, 120_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  await Category.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

const productBody = (title: string) => ({ title, actualPrice: 900, stock: 3, categoryId });

describe("roles are defined on the server", () => {
  it("a role sent when adding staff becomes that role's permissions", () => {
    expect(manager.member).toMatchObject({ role: "manager" });
    expect(manager.member.permissions.sort()).toEqual(["analytics_read", "discounts_write", "orders_write", "pos_sell", "products_write", "refunds"]);
    expect(cashier.member).toMatchObject({ role: "cashier", permissions: ["pos_sell"] });
  });

  it("an explicit permission list from an older caller still works, and is shown as custom", async () => {
    // In the second store: the first is at the Free plan's staff limit already.
    const res = await api("POST", `/stores/${other.storeId}/staff`, { token: other.token, body: { email: `verify-roles-legacy-${suffix}@example.com`, password: "staff-pass-123", permissions: ["orders_write"] } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ role: "custom", permissions: ["orders_write"] });
    created.userIds.push(res.json.userId);
  });

  it("adding staff with neither a role nor permissions, or an unknown role, is refused", async () => {
    expect((await api("POST", `/stores/${O.storeId}/staff`, { token: O.token, body: { email: `verify-roles-none-${suffix}@example.com`, password: "staff-pass-123" } })).status).toBe(400);
    expect((await api("POST", `/stores/${O.storeId}/staff`, { token: O.token, body: { email: `verify-roles-none-${suffix}@example.com`, password: "staff-pass-123", role: "admin" } })).status).toBe(400);
  });

  it("a manager's store lists the Products permission, so the admin offers the catalogue", async () => {
    const mine = (await api("GET", "/users/me/stores", { token: manager.token })).json;
    expect(mine[0].permissions).toContain("products_write");
  });
});

describe("a Manager runs the catalogue", () => {
  it("creates and edits products, and changes stock", async () => {
    const made = await api("POST", `/stores/${O.storeId}/products`, { token: manager.token, body: productBody("Steel Pot") });
    expect(made.status).toBe(201);
    const edited = await api("PUT", `/stores/${O.storeId}/products/${made.json.id}`, { token: manager.token, body: { ...productBody("Steel Pot, large"), discountPrice: 800 } });
    expect(edited.status).toBe(200);
    expect(edited.json).toMatchObject({ title: "Steel Pot, large", salePrice: 800 });
    const stock = await api("PATCH", `/stores/${O.storeId}/products/${productId}/stock`, { token: manager.token, body: { stock: 7 } });
    expect(stock.json).toEqual({ id: productId, stock: 7 });
  });

  it("manages categories", async () => {
    const made = await api("POST", `/stores/${O.storeId}/categories`, { token: manager.token, body: { name: "Bath" } });
    expect(made.status).toBe(201);
    expect((await api("PATCH", `/stores/${O.storeId}/categories/${made.json.id}`, { token: manager.token, body: { name: "Bathroom" } })).status).toBe(200);
  });

  it("uses the AI tools, and each use comes out of the store's own allowance", async () => {
    const before = (await api("GET", `/stores/${O.storeId}/ai-usage`, { token: O.token })).json.generationsUsed;
    reply = "Hand-hammered copper, made to last.";
    expect((await api("POST", `/stores/${O.storeId}/products/${productId}/ai-description/generate`, { token: manager.token })).status).toBe(202);
    reply = "Title: Copper Kettle | Handmade\nDescription: A hand-hammered copper kettle.";
    expect((await api("POST", `/stores/${O.storeId}/products/${productId}/seo-metadata/generate`, { token: manager.token })).status).toBe(200);
    reply = "Category: Kitchen\nTags: copper, kettle";
    expect((await api("POST", `/stores/${O.storeId}/products/${productId}/auto-tag`, { token: manager.token })).status).toBe(200);
    const after = (await api("GET", `/stores/${O.storeId}/ai-usage`, { token: O.token })).json.generationsUsed;
    expect(after).toBe(before + 3);
    // The manager sees the same figures as the owner: one allowance per store.
    expect((await api("GET", `/stores/${O.storeId}/ai-usage`, { token: manager.token })).json.generationsUsed).toBe(after);
  }, 60_000);

  it("still cannot reach billing, the team or the store's settings", async () => {
    expect((await api("GET", `/stores/${O.storeId}/billing`, { token: manager.token })).status).toBe(403);
    expect((await api("POST", `/stores/${O.storeId}/billing/top-up`, { token: manager.token, body: { pack: "small" } })).status).toBe(403);
    expect((await api("GET", `/stores/${O.storeId}/staff`, { token: manager.token })).status).toBe(403);
    expect((await api("PATCH", `/stores/${O.storeId}/branding`, { token: manager.token, body: { themeColor: "#112233" } })).status).toBe(403);
    expect((await api("PATCH", `/stores/${O.storeId}/currency`, { token: manager.token, body: { currency: "USD" } })).status).toBe(403);
  });
});

describe("a Cashier works the register only", () => {
  it.each([
    ["create a product", "POST", () => `/stores/${O.storeId}/products`, () => productBody("Clay Cup")],
    ["edit a product", "PUT", () => `/stores/${O.storeId}/products/${productId}`, () => productBody("Copper Kettle")],
    ["change stock", "PATCH", () => `/stores/${O.storeId}/products/${productId}/stock`, () => ({ stock: 1 })],
    ["delete a product", "DELETE", () => `/stores/${O.storeId}/products/${productId}`, () => undefined],
    ["list categories", "GET", () => `/stores/${O.storeId}/categories`, () => undefined],
    ["create a category", "POST", () => `/stores/${O.storeId}/categories`, () => ({ name: "Toys" })],
    ["generate a description", "POST", () => `/stores/${O.storeId}/products/${productId}/ai-description/generate`, () => undefined],
    ["generate SEO", "POST", () => `/stores/${O.storeId}/products/${productId}/seo-metadata/generate`, () => undefined],
    ["auto-tag", "POST", () => `/stores/${O.storeId}/products/${productId}/auto-tag`, () => undefined],
    ["Write with AI", "POST", () => `/stores/${O.storeId}/product-ideas`, () => ({ title: "Cup" })],
    ["read the AI meter", "GET", () => `/stores/${O.storeId}/ai-usage`, () => undefined],
  ])("is refused (403) when trying to %s, and no AI call is made", async (_what, method, path, body) => {
    const calls = providerCalls.length;
    const res = await api(method, path(), { token: cashier.token, body: body() });
    expect(res.status).toBe(403);
    expect(res.json.detail).toMatch(/Products/);
    expect(providerCalls.length).toBe(calls);
  });

  it("is refused the admin's list of shipping zones (403); checkout's public list stays open", async () => {
    const manage = `/stores/${O.storeId}/shipping-zones/manage`;
    const refused = await api("GET", manage, { token: cashier.token });
    expect(refused.status).toBe(403);
    expect(refused.json.detail).toMatch(/Orders/);
    expect((await api("GET", manage, { token: manager.token })).status).toBe(200);
    expect((await api("GET", manage, { token: O.token })).status).toBe(200);
    expect((await api("GET", manage)).status).toBe(401);
    expect((await api("GET", `/stores/${O.storeId}/shipping-zones`)).status).toBe(200);
  });

  it("can still use the register", async () => {
    expect((await api("GET", `/stores/${O.storeId}/pos/products?q=kettle`, { token: cashier.token })).status).toBe(200);
  });
});

describe("only the owner changes roles", () => {
  it("a manager cannot change their own role, another staff member's, or remove anyone", async () => {
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${manager.staffId}`, { token: manager.token, body: { role: "cashier" } })).status).toBe(403);
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: manager.token, body: { role: "manager" } })).status).toBe(403);
    expect((await api("DELETE", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: manager.token })).status).toBe(403);
  });

  it("a cashier cannot promote themselves", async () => {
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: cashier.token, body: { role: "manager" } })).status).toBe(403);
    const mine = (await api("GET", "/users/me/stores", { token: cashier.token })).json;
    expect(mine[0].permissions).toEqual(["pos_sell"]);
  });

  it("the owner cannot be changed: there is no staff record for them, here or through another store", async () => {
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${O.userId}`, { token: O.token, body: { role: "cashier" } })).status).toBe(404);
    expect((await api("PATCH", `/stores/${other.storeId}/staff/${manager.staffId}`, { token: other.token, body: { role: "cashier" } })).status).toBe(404);
    expect((await api("GET", `/stores/${O.storeId}/billing`, { token: O.token })).status).toBe(200);
  });

  it("refuses an unknown role", async () => {
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: O.token, body: { role: "owner" } })).status).toBe(400);
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: O.token, body: {} })).status).toBe(400);
  });

  it("the owner promotes a cashier to manager, and it applies on their very next request", async () => {
    const res = await api("PATCH", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: O.token, body: { role: "manager" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: cashier.staffId, role: "manager" });
    expect((await api("POST", `/stores/${O.storeId}/products`, { token: cashier.token, body: productBody("Clay Cup") })).status).toBe(201);
  });

  it("and back to cashier: the catalogue is closed to them again at once", async () => {
    expect((await api("PATCH", `/stores/${O.storeId}/staff/${cashier.staffId}`, { token: O.token, body: { role: "cashier" } })).json.role).toBe("cashier");
    expect((await api("POST", `/stores/${O.storeId}/products`, { token: cashier.token, body: productBody("Clay Bowl") })).status).toBe(403);
  });
});
