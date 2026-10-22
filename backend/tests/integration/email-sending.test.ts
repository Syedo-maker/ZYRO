/**
 * Email sending behind its small provider interface (2026-10-22), as abandoned-cart recovery uses it:
 * off, and saying so, while the provider's settings are missing; a reminder's AI generation counted
 * only once the email has actually gone; the settings' names reported, never their values; the key
 * never in a log line. A fake AI provider and fake email gateways stand in for the real ones.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
delete process.env.SENDGRID_API_KEY;
delete process.env.SENDGRID_FROM_EMAIL;
delete process.env.EMAIL_PROVIDER;
process.env.AI_QUEUE_NAME = `ai-generate-verify-email-${Date.now().toString(36)}`;
process.env.CART_RECOVERY_QUEUE_NAME = `cart-recovery-verify-email-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

const SECRET = "SG.this-must-never-appear-anywhere";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let env: typeof import("../../src/config/env").env;
let getRedis: typeof import("../../src/lib/redis").getRedis;
let email: typeof import("../../src/lib/email");
let cartRecoveryService: typeof import("../../src/modules/cart-recovery/cartRecovery.service").cartRecoveryService;
let logger: typeof import("../../src/lib/logger").logger;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let aiCalls = 0;
let O: { token: string; storeId: string };
let cartKey = "";

async function api(method: string, p: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}
const used = async () => (await api("GET", `/stores/${O.storeId}/ai-usage`, { token: O.token })).json.generationsUsed as number;
const events = () => prismaUnscoped.cartRecoveryEvent.count({ where: { tenantId: O.storeId } });
/** Every argument of every log call during `fn`, as one string, to search for the key. */
async function logsDuring(fn: () => Promise<unknown>): Promise<string> {
  const spies = (["info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(logger, level));
  try {
    await fn();
    return JSON.stringify(spies.flatMap((s) => s.mock.calls));
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ env } = await import("../../src/config/env"));
  ({ getRedis } = await import("../../src/lib/redis"));
  email = await import("../../src/lib/email");
  ({ cartRecoveryService } = await import("../../src/modules/cart-recovery/cartRecovery.service"));
  ({ logger } = await import("../../src/lib/logger"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate() {
      aiCalls++;
      return { text: "Your copper kettle is waiting for you.", model: "fake-model-email", inputTokens: 30, outputTokens: 10 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  const reg = await api("POST", "/auth/register", {
    body: { email: `verify-email-o-${suffix}@example.com`, password: "password123", storeName: "Email", storeSlug: `verify-email-o-${suffix}`, currency: "PKR" },
  });
  O = { token: reg.json.accessToken, storeId: (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id };
  created.tenantIds.push(O.storeId);
  created.userIds.push(reg.json.user.id);
  const productId = (await api("POST", `/stores/${O.storeId}/products`, { token: O.token, body: { title: "Copper Kettle", actualPrice: 2500, stock: 5, category: "Kitchen" } })).json.id;
  const shopper = await api("POST", "/auth/register-customer", { body: { email: `verify-email-c-${suffix}@example.com`, password: "password123" } });
  created.userIds.push(shopper.json.user.id);
  await api("POST", `/stores/${O.storeId}/cart/items`, { token: shopper.json.accessToken, body: { productId, quantity: 1 } });
  cartKey = `cart:${O.storeId}:u:${shopper.json.user.id}`;
  await getRedis().expire(cartKey, env.cartTtlSeconds - (env.cartRecovery.abandonedAfterHours + 1) * 60 * 60);
}, 120_000);

afterAll(async () => {
  email.setEmailGateway(undefined);
  await getRedis().del(cartKey);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/cartRecoveryQueue")).closeCartRecoveryQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("whether email is set up", () => {
  it("without the provider's settings it is off, and names what is missing", () => {
    expect(email.emailStatus()).toEqual({ configured: false, provider: "sendgrid", missing: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"] });
  });

  it("with only the key, the key's value appears nowhere in the status or the error", () => {
    env.email.sendgridApiKey = SECRET;
    const status = email.emailStatus();
    expect(status).toEqual({ configured: false, provider: "sendgrid", missing: ["SENDGRID_FROM_EMAIL"] });
    let message = "";
    try {
      email.getEmailGateway();
    } catch (err) {
      message = (err as { detail?: string }).detail ?? "";
    }
    expect(message).toBe("Email sending is not set up (missing SENDGRID_FROM_EMAIL)");
    expect(JSON.stringify(status) + message).not.toContain(SECRET);
    env.email.sendgridApiKey = undefined;
  });

  it("an unknown provider is reported as missing EMAIL_PROVIDER", () => {
    env.email.provider = "carrier-pigeon";
    expect(email.emailStatus()).toMatchObject({ configured: false, missing: ["EMAIL_PROVIDER"] });
    env.email.provider = "sendgrid";
  });

  it("the Marketing figures say email sending is not set up", async () => {
    const perf = await api("GET", `/stores/${O.storeId}/cart-recovery/performance`, { token: O.token });
    expect(perf.status).toBe(200);
    expect(perf.json.emailConfigured).toBe(false);
  });
});

describe("a reminder is charged only once it is sent", () => {
  it("while email is off, a due cart costs no AI call and no allowance", async () => {
    const before = { calls: aiCalls, used: await used() };
    await cartRecoveryService.scan();
    expect(aiCalls).toBe(before.calls);
    expect(await used()).toBe(before.used);
    expect(await events()).toBe(0);
  }, 60_000);

  it("when the provider refuses the email, the generation is given back and nothing is recorded", async () => {
    env.email.sendgridApiKey = SECRET; // set, so a careless log of the settings would show it
    email.setEmailGateway({
      async send() {
        throw new Error("provider responded 503: try again later");
      },
    });
    const before = { calls: aiCalls, used: await used() };
    const logs = await logsDuring(() => cartRecoveryService.scan());
    expect(aiCalls).toBe(before.calls + 1); // the message was written
    expect(await used()).toBe(before.used); // but not charged, because it was not sent
    expect(await events()).toBe(0);
    expect(logs).toMatch(/a cart recovery email could not be sent/);
    expect(logs).not.toContain(SECRET);
    env.email.sendgridApiKey = undefined;
  }, 60_000);

  it("when the email goes, it is charged once and recorded once", async () => {
    const sent: string[] = [];
    email.setEmailGateway({
      async send(m) {
        sent.push(m.to);
      },
    });
    const before = await used();
    await cartRecoveryService.scan();
    expect(sent).toHaveLength(1);
    expect(await used()).toBe(before + 1);
    expect(await events()).toBe(1);
    const perf = await api("GET", `/stores/${O.storeId}/cart-recovery/performance`, { token: O.token });
    expect(perf.json).toMatchObject({ emailConfigured: true, sent: 1 });
    // The next scan is inside the cooldown: no second email, no second charge.
    await cartRecoveryService.scan();
    expect(sent).toHaveLength(1);
    expect(await used()).toBe(before + 1);
  }, 60_000);
});

describe("revocable generations", () => {
  it("giving one back twice returns one turn, not two", async () => {
    const { generateRevocable } = await import("../../src/modules/ai/ai.orchestrator");
    const { tenantContext } = await import("../../src/lib/tenantContext");
    const before = await used();
    // Outside a request, as the recovery job runs it: inside the store's tenant context.
    const g = await tenantContext.run(O.storeId, () => generateRevocable({ tenantId: O.storeId, promptType: "cart_recovery", system: "Write one line.", prompt: "Test" }));
    expect(await used()).toBe(before + 1);
    await tenantContext.run(O.storeId, async () => {
      await g.release();
      await g.release();
    });
    expect(await used()).toBe(before);
  }, 60_000);
});
