/**
 * Every request ends, even when what it depends on does not answer (Production_Readiness.md,
 * Phase 4). Each outside service is made to hang, and the request that needs it must come back
 * quickly with something a person can act on: a 503 problem document, or the page without the
 * optional part. Nothing may wait for the platform's 4-minute ingress timeout.
 *
 *   the AI provider hangs            -> the AI request is a 503 within the job timeout
 *   the recommendation service hangs -> the product page still loads, without recommendations
 *   Stripe hangs                     -> checkout gets the request-timeout 503, not a hung connection
 *
 * The time limits are shortened for the test (env below); production uses the same code paths with
 * its own values.
 */
import net from "node:net";

process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-deps-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";
process.env.AI_JOB_TIMEOUT_MS = "1500";
process.env.REQUEST_TIMEOUT_MS = "3000";
// Test-only values, set here so the suite never depends on a developer's own .env (CI has none).
process.env.STRIPE_SECRET_KEY = "sk_test_verifyonly";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_verifyonly";
process.env.RECOMMENDATION_TIMEOUT_MS = "800";
process.env.RECOMMENDATION_SERVICE_TOKEN = "verify-deps-token";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let blackHole: net.Server;
const sockets = new Set<net.Socket>();

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let owner: { token: string; storeId: string };
let productId = "";

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  const started = Date.now();
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  // Each call gets its own limit, well above anything these tests expect, so that a hang names the
  // call that hung instead of ending as a bare Jest timeout. (One full run, 2026-10-21, timed out
  // the AI test after 120 s; it has not reproduced in any run since.)
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body))).timeout(15_000).catch((err: Error) => {
    throw new Error(`${method} ${p} did not answer within 15 s: ${err.message}`);
  });
  return { status: res.status as number, json: res.body, ms: Date.now() - started };
}

beforeAll(async () => {
  // A server that accepts connections and never says a word: the worst kind of outage, because
  // nothing fails, it just never answers.
  blackHole = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => blackHole.listen(0, "127.0.0.1", resolve));
  process.env.RECOMMENDATION_SERVICE_URL = `http://127.0.0.1:${(blackHole.address() as net.AddressInfo).port}`;

  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();

  // The AI provider takes far longer than anyone waits (and then does answer, so the worker can
  // be closed at the end of the file).
  (await import("../../src/lib/aiProvider")).setAiProvider({
    generate: (p) => new Promise((resolve) => setTimeout(() => resolve({ text: "late", model: p.model, inputTokens: 1, outputTokens: 1 }), 4000)),
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  // Stripe accepts the request and never replies.
  const { getStripeGateway, setStripeGateway } = await import("../../src/lib/stripe");
  setStripeGateway({ ...getStripeGateway(), createCheckoutSession: () => new Promise(() => undefined) });

  const reg = await api("POST", "/auth/register", { body: { email: `verify-deps-${suffix}@example.com`, password: "password123", storeName: "Deps", storeSlug: `verify-deps-${suffix}`, currency: "PKR" } });
  owner = { token: reg.json.accessToken, storeId: (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id };
  created.tenantIds.push(owner.storeId);
  created.userIds.push(reg.json.user.id);
  productId = (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title: "Clay Chai Cup", price: 450, stock: 10, category: "kitchen" } })).json.id;
}, 240_000);

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => blackHole.close(resolve));
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
}, 60_000);

describe("when an outside service hangs, the request still ends", () => {
  it("the AI provider: a 503 problem within the job timeout, and the store's allowance is given back", async () => {
    const before = (await api("GET", `/stores/${owner.storeId}/ai-usage`, { token: owner.token })).json;
    const res = await api("POST", `/stores/${owner.storeId}/products/${productId}/ai-description/generate`, { token: owner.token, body: {} });
    expect(res.status).toBe(503);
    expect(res.json.type).toBe("https://zyro.dev/errors/service-unavailable");
    expect(res.ms).toBeLessThan(3000);
    const after = (await api("GET", `/stores/${owner.storeId}/ai-usage`, { token: owner.token })).json;
    // The attempt that never produced anything is not charged.
    expect(after.generationsUsed).toBe(before.generationsUsed);
  });

  it("the recommendation service: the product page loads without recommendations, in under a second and a half", async () => {
    const page = await api("GET", `/stores/${owner.storeId}/products/${productId}`);
    expect(page.status).toBe(200);
    const recs = await api("GET", `/stores/${owner.storeId}/products/${productId}/recommendations`);
    expect(recs.status).toBe(200);
    expect(recs.ms).toBeLessThan(1500);
  });

  it("Stripe: checkout answers with the request-timeout problem instead of hanging", async () => {
    const guest = `guest-deps-${suffix}`;
    expect((await api("POST", `/stores/${owner.storeId}/cart/items`, { guest, body: { productId, quantity: 1 } })).status).toBe(200);
    const res = await api("POST", `/stores/${owner.storeId}/checkout/session`, { guest, body: {} });
    expect(res.status).toBe(503);
    expect(res.json.type).toBe("https://zyro.dev/errors/request-timeout");
    expect(res.ms).toBeGreaterThanOrEqual(2900);
    expect(res.ms).toBeLessThan(5000);
  });

  it("and the API is still healthy afterwards", async () => {
    expect((await request(app).get("/ready")).status).toBe(200);
  });
});
