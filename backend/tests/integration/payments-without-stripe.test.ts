/**
 * Production readiness, STEP 5: a store can trade with no Stripe at all (Stripe may not be available
 * to a Pakistan-based business), and with no AI either. Cash on delivery and bank transfer with a
 * receipt work end to end; card payment is not offered (it used to be, and paying then failed); a
 * direct attempt at a card checkout gets a plain 503 instead of an error page.
 */
process.env.RATE_LIMIT_ENABLED = "false";
// No Stripe and no AI provider, whatever this machine's backend/.env holds (dotenv never overrides).
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_WEBHOOK_SECRET = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.AI_QUEUE_NAME = `ai-generate-nostripe-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[], keys: [] as string[] };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const shopper = { name: "Ayesha Khan", phone: "03001234567", email: `verify-nostripe-${suffix}@example.com`, address: { line1: "12 Mall Road", city: "Lahore", country: "PK" } };

async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

let owner: { token: string; storeId: string };
let cup: string;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiQueue")).startAiWorker();
  const reg = await api("POST", "/auth/register", { body: { email: `verify-nostripe-o-${suffix}@example.com`, password: "password123", storeName: `Verify No Stripe ${suffix}`, storeSlug: `verify-nostripe-${suffix}`, currency: "PKR" } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  owner = { token: reg.json.accessToken, storeId };
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  cup = (await api("POST", `/stores/${storeId}/products`, { token: owner.token, body: { title: "Clay Chai Cup", price: 450, stock: 20, category: "kitchen" } })).json.id;
  await api("PATCH", `/stores/${storeId}/payments/settings`, { token: owner.token, body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: "Verify Shop", bankAccountNumber: "PK00TEST000011112222", bankName: "Test Bank" } });
}, 120_000);

afterAll(async () => {
  const storage = (await import("../../src/lib/storage")).getStorage();
  for (const k of created.keys) await storage.remove(k).catch(() => undefined);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

it("the shopper is offered cash on delivery and bank transfer, and not card payment", async () => {
  const guest = `guest-nostripe-opts-${suffix}`;
  await api("POST", `/stores/${owner.storeId}/cart/items`, { guest, body: { productId: cup, quantity: 1 } });
  const res = await api("POST", `/stores/${owner.storeId}/payments/options`, { guest, body: { ...shopper, method: "cod" } });
  expect(res.status).toBe(200);
  expect(res.json.card).toEqual({ available: false });
  expect(res.json.cod.available).toBe(true);
  expect(res.json.bankTransfer.available).toBe(true);
});

it("a cash-on-delivery order is placed and the merchant sees it", async () => {
  const guest = `guest-nostripe-cod-${suffix}`;
  await api("POST", `/stores/${owner.storeId}/cart/items`, { guest, body: { productId: cup, quantity: 2 } });
  const placed = await api("POST", `/stores/${owner.storeId}/payments/orders`, { guest, body: { ...shopper, method: "cod" } });
  expect(placed.status).toBe(201);
  const order = await prismaUnscoped.order.findFirst({ where: { tenantId: owner.storeId, id: placed.json.orderId }, include: { payments: true } });
  expect(order?.status).toBe("PENDING");
  expect(order?.payments[0]).toMatchObject({ method: "COD", status: "PENDING" });
  const pending = await api("GET", `/stores/${owner.storeId}/payments/cod/pending`, { token: owner.token });
  expect(JSON.stringify(pending.json)).toContain(placed.json.orderId);
});

it("a bank-transfer order takes a receipt, which waits for the merchant (no AI), who accepts it", async () => {
  const guest = `guest-nostripe-bank-${suffix}`;
  await api("POST", `/stores/${owner.storeId}/cart/items`, { guest, body: { productId: cup, quantity: 1 } });
  const placed = await api("POST", `/stores/${owner.storeId}/payments/orders`, { guest, body: { ...shopper, method: "bank_transfer" } });
  expect(placed.status).toBe(201);
  expect(placed.json.payTo.accountNumber).toBe("PK00TEST000011112222");

  const upload = await request(app)
    .post(`/api/v1/stores/${owner.storeId}/payments/orders/${placed.json.orderId}/proof-image`)
    .set("X-Guest-Session-Id", guest)
    .attach("file", png, { filename: "receipt.png", contentType: "image/png" });
  expect(upload.status).toBe(201);
  created.keys.push(upload.body.key);
  const started = Date.now();
  const proof = await api("POST", `/stores/${owner.storeId}/payments/orders/${placed.json.orderId}/proof`, { guest, body: { imageKey: upload.body.key, declaredAmount: 450, declaredReference: `TRX-${suffix}` } });
  expect(proof.status).toBe(201);
  // With no AI set up the receipt goes straight to the merchant, without waiting on retries.
  expect(Date.now() - started).toBeLessThan(2000);

  const list = (await api("GET", `/stores/${owner.storeId}/payments/proofs`, { token: owner.token })).json as { id: string; orderId: string }[];
  const mine = list.find((p) => p.orderId === placed.json.orderId)!;
  expect(mine).toBeDefined();
  const review = await api("POST", `/stores/${owner.storeId}/payments/proofs/${mine.id}/review`, { token: owner.token, body: { decision: "accept" } });
  expect(review.status).toBe(200);
  const order = await prismaUnscoped.order.findFirst({ where: { tenantId: owner.storeId, id: placed.json.orderId }, include: { payments: true } });
  expect(order?.payments[0]).toMatchObject({ method: "BANK_TRANSFER", status: "SUCCEEDED" });
  expect(order?.status).toBe("PAID");
});

it("a direct card checkout attempt gets a plain 503, not an error page", async () => {
  const guest = `guest-nostripe-card-${suffix}`;
  await api("POST", `/stores/${owner.storeId}/cart/items`, { guest, body: { productId: cup, quantity: 1 } });
  const res = await api("POST", `/stores/${owner.storeId}/checkout/session`, { guest, body: {} });
  expect(res.status).toBe(503);
  expect(res.json.type).toBe("https://zyro.dev/errors/service-unavailable");
});
