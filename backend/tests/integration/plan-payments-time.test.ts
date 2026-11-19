/**
 * Pro plan payments over time: provisional Pro (switched on here; off by default), approver reminders,
 * plan-ending notices and the downgrade to Free, all from the sweep that runs every 15 minutes.
 */
const suffix = Date.now().toString(36);
const approver = `verify-ptime-appr-${suffix}@example.com`;
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-plan-time-${suffix}`;
process.env.AI_CACHE_SECONDS = "0";
process.env.PLAN_PRICES = '{"PRO":{"PKR":3000}}';
process.env.PLAN_PAYMENT_METHODS = JSON.stringify({ PKR: [{ label: "Bank transfer", accountTitle: "Zyro Demo", accountNumber: "PK00TEST0001" }] });
process.env.PLAN_APPROVER_EMAILS = approver;
process.env.PLAN_PROVISIONAL_ENABLED = "true";
process.env.PLAN_PROVISIONAL_DAILY_CAP = "3";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let runPlanPaymentSweep: typeof import("../../src/modules/planPayments/planPayments.jobs").runPlanPaymentSweep;
let getTenantPlan: typeof import("../../src/modules/billing/plan.service").getTenantPlan;
const sent: { to: string; subject: string; text: string }[] = [];
let aiReply: "pass" | "fail" = "pass";
/** The transaction ID the fake AI reads on the screenshot: the one the owner is about to enter. */
let currentTxn = "";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const users: Record<string, { token: string; userId: string; storeId: string; email: string }> = {};
const HOUR = 3600_000;
let capFiller = "";

async function account(tag: string, email: string) {
  const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", storeName: `Plan Time ${tag}`, storeSlug: `verify-ptime-${tag}-${suffix}`, currency: "PKR" });
  expect(reg.status).toBe(201);
  const storeId = (await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`)).body[0].id;
  users[tag] = { token: reg.body.accessToken, userId: reg.body.user.id, storeId, email };
  return users[tag];
}
/** Another store owned by the same account, made directly: the rule is per owner, not per store. */
async function secondStore(tag: string, base: string) {
  const store = await prismaUnscoped.tenant.create({ data: { name: `Plan Time ${tag}`, slug: `verify-ptime-${tag}-${suffix}`, ownerId: users[base].userId, currency: "PKR" } });
  return store.id;
}
async function pay(tag: string, transactionId: string, storeId = users[tag].storeId) {
  const auth = { Authorization: `Bearer ${users[tag].token}` };
  currentTxn = transactionId;
  const opened = await request(app).post(`/api/v1/stores/${storeId}/plan-payments/requests`).set(auth);
  const up = await request(app).post(`/api/v1/stores/${storeId}/plan-payments/requests/${opened.body.id}/proof-image`).set(auth).attach("file", png, { filename: "p.png", contentType: "image/png" });
  const res = await request(app).post(`/api/v1/stores/${storeId}/plan-payments/requests/${opened.body.id}/submit`).set(auth).send({ imageKey: up.body.key, transactionId });
  expect(res.status).toBe(200);
  return opened.body.id as string;
}
const plan = (storeId: string) => prismaUnscoped.tenant.findUniqueOrThrow({ where: { id: storeId }, select: { plan: true, planExpiresAt: true, planProvisional: true } });

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ runPlanPaymentSweep } = await import("../../src/modules/planPayments/planPayments.jobs"));
  ({ getTenantPlan } = await import("../../src/modules/billing/plan.service"));
  (await import("../../src/lib/email")).setEmailGateway({ send: async (m) => void sent.push({ to: m.to, subject: m.subject, text: m.text }) });
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate() {
      if (aiReply === "fail") throw new Error("provider down");
      const date = new Date().toISOString().slice(0, 10);
      return { text: JSON.stringify({ readable: true, amount: 3000, currency: "PKR", date, receiverName: "Zyro Demo", receiverAccount: "****0001", reference: null, transactionId: currentTxn, editingSigns: [], confidence: 0.98 }), model: "fake", inputTokens: 1, outputTokens: 1 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();
  for (const tag of ["a", "b", "c", "d", "e"]) await account(tag, `verify-ptime-${tag}-${suffix}@example.com`);
  await account("appr", approver);
  await prismaUnscoped.user.update({ where: { email: approver }, data: { platformRole: "SUPER_ADMIN" } });
  // A clean count of today's provisional grants for the daily cap (this is a throwaway test database).
  await prismaUnscoped.planAuditEvent.deleteMany({ where: { action: "provisional_granted" } });
}, 90_000);

afterAll(async () => {
  const stores = (await prismaUnscoped.tenant.findMany({ where: { slug: { contains: `verify-ptime-` } }, select: { id: true } })).map((t) => t.id);
  await prismaUnscoped.planAuditEvent.deleteMany({ where: { tenantId: { in: stores } } });
  if (capFiller) await prismaUnscoped.planAuditEvent.deleteMany({ where: { id: capFiller } });
  await prismaUnscoped.tenant.deleteMany({ where: { id: { in: stores } } });
  await prismaUnscoped.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.userId) } } });
  (await import("../../src/lib/email")).setEmailGateway(undefined);
  (await import("../../src/lib/aiProvider")).setAiProvider(undefined);
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await prismaUnscoped.$disconnect();
});

describe("provisional Pro", () => {
  let requestA = "";
  it("is granted when every check passes with high confidence: 48 hours, lower AI limits, marked provisional", async () => {
    sent.length = 0;
    requestA = await pay("a", `PROV-A-${suffix}`);
    const p = await plan(users.a.storeId);
    expect(p).toMatchObject({ plan: "PRO", planProvisional: true });
    expect(Math.abs(p.planExpiresAt!.getTime() - (Date.now() + 48 * HOUR))).toBeLessThan(60_000);
    const effective = await getTenantPlan(users.a.storeId);
    expect(effective.definition.aiGenerationsPerMonth).toBeLessThan(200);
    expect((await request(app).get(`/api/v1/stores/${users.a.storeId}/plan-payments`).set("Authorization", `Bearer ${users.a.token}`)).body.currentPlan).toMatchObject({ tier: "PRO", provisional: true });
    expect(sent.find((m) => m.to === approver)?.text).toMatch(/Provisional Pro is running until/);
    expect(await prismaUnscoped.planAuditEvent.count({ where: { requestId: requestA, action: "provisional_granted", actorKind: "system" } })).toBe(1);
  });

  it("happens once per owner account: a second store of the same owner does not get it", async () => {
    const storeId = await secondStore("a2", "a");
    await pay("a", `PROV-A2-${suffix}`, storeId);
    expect((await plan(storeId)).plan).toBe("FREE");
  });

  it("is never granted when the AI is unavailable or switched off", async () => {
    aiReply = "fail";
    await pay("b", `PROV-B-${suffix}`);
    expect((await plan(users.b.storeId)).plan).toBe("FREE");
    aiReply = "pass";
    process.env.AI_DISABLED = "true";
    await pay("c", `PROV-C-${suffix}`);
    delete process.env.AI_DISABLED;
    expect((await plan(users.c.storeId)).plan).toBe("FREE");
  });

  it("stops at the daily cap across the platform", async () => {
    await pay("d", `PROV-D-${suffix}`);
    expect((await plan(users.d.storeId)).planProvisional).toBe(true);
    // Someone else's grant today fills the cap of 3 (removed again after the test).
    capFiller = (await prismaUnscoped.planAuditEvent.create({ data: { action: "provisional_granted", actorKind: "system", details: {} } })).id;
    await pay("e", `PROV-E-${suffix}`);
    expect((await plan(users.e.storeId)).plan).toBe("FREE");
  });

  it("becomes the full 30 days from the approval when an approver approves", async () => {
    const res = await request(app).post(`/api/v1/platform/plan-requests/${requestA}/approve`).set("Authorization", `Bearer ${users.appr.token}`).send({});
    expect(res.body.status).toBe("approved");
    const p = await plan(users.a.storeId);
    expect(p).toMatchObject({ plan: "PRO", planProvisional: false });
    expect(Math.abs(p.planExpiresAt!.getTime() - (Date.now() + 30 * 24 * HOUR))).toBeLessThan(60_000);
  });

  it("ends at once, back to Free, when an approver rejects", async () => {
    const pending = await prismaUnscoped.planPaymentRequest.findFirstOrThrow({ where: { tenantId: users.d.storeId, status: "pending" } });
    sent.length = 0;
    await request(app).post(`/api/v1/platform/plan-requests/${pending.id}/reject`).set("Authorization", `Bearer ${users.appr.token}`).send({ reason: "No money arrived" });
    expect(await plan(users.d.storeId)).toMatchObject({ plan: "FREE", planProvisional: false });
    expect(sent.find((m) => m.to === users.d.email)?.text).toMatch(/provisional Pro has ended/);
  });

  it("ends by itself when its time runs out without a decision; the request stays waiting", async () => {
    // Store e: give it a provisional plan that has just run out.
    const pending = await prismaUnscoped.planPaymentRequest.findFirstOrThrow({ where: { tenantId: users.e.storeId, status: "pending" } });
    const past = new Date(Date.now() - 60_000);
    await prismaUnscoped.tenant.update({ where: { id: users.e.storeId }, data: { plan: "PRO", planExpiresAt: past, planProvisional: true } });
    await prismaUnscoped.planPaymentRequest.update({ where: { id: pending.id }, data: { provisionalUntil: past } });
    sent.length = 0;
    const counts = await runPlanPaymentSweep();
    expect(counts.provisionalEnded).toBeGreaterThanOrEqual(1);
    expect((await plan(users.e.storeId)).plan).toBe("FREE");
    expect(await prismaUnscoped.planPaymentRequest.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "pending", provisionalUntil: null });
    expect(sent.find((m) => m.to === users.e.email)?.text).toMatch(/still being reviewed/);
    await runPlanPaymentSweep();
    expect(sent.filter((m) => m.to === users.e.email)).toHaveLength(1);
  });
});

describe("the sweep", () => {
  it("reminds every approver after 24 hours and again after 48, once each", async () => {
    const pending = await prismaUnscoped.planPaymentRequest.findFirstOrThrow({ where: { tenantId: users.b.storeId, status: "pending" } });
    await prismaUnscoped.planPaymentRequest.update({ where: { id: pending.id }, data: { submittedAt: new Date(Date.now() - 25 * HOUR) } });
    sent.length = 0;
    await runPlanPaymentSweep();
    expect(sent.filter((m) => m.to === approver && m.subject.startsWith("Reminder:"))).toHaveLength(1);
    await runPlanPaymentSweep();
    expect(sent.filter((m) => m.to === approver && m.subject.startsWith("Reminder:"))).toHaveLength(1);
    await prismaUnscoped.planPaymentRequest.update({ where: { id: pending.id }, data: { submittedAt: new Date(Date.now() - 49 * HOUR) } });
    await runPlanPaymentSweep();
    const reminders = sent.filter((m) => m.to === approver && m.subject.startsWith("Reminder:"));
    expect(reminders).toHaveLength(2);
    expect(reminders[1].text).toMatch(/waiting for 48 hours/);
  });

  it("tells the owner 7 days and 1 day before a paid plan ends, once each", async () => {
    const until = new Date(Date.now() + 6 * 24 * HOUR);
    await prismaUnscoped.tenant.update({ where: { id: users.c.storeId }, data: { plan: "PRO", planExpiresAt: until, planProvisional: false } });
    sent.length = 0;
    await runPlanPaymentSweep();
    await runPlanPaymentSweep();
    expect(sent.filter((m) => m.to === users.c.email && /in 7 days/.test(m.subject))).toHaveLength(1);
    await prismaUnscoped.tenant.update({ where: { id: users.c.storeId }, data: { planExpiresAt: new Date(Date.now() + 20 * HOUR) } });
    await runPlanPaymentSweep();
    expect(sent.filter((m) => m.to === users.c.email && /tomorrow/.test(m.subject))).toHaveLength(1);
  });

  it("moves a plan past its end (and grace) to Free, tells the owner, and deletes nothing", async () => {
    await prismaUnscoped.tenant.update({ where: { id: users.c.storeId }, data: { plan: "PRO", planExpiresAt: new Date(Date.now() - 30 * HOUR), planProvisional: false } });
    sent.length = 0;
    const counts = await runPlanPaymentSweep();
    expect(counts.downgraded).toBeGreaterThanOrEqual(1);
    expect((await plan(users.c.storeId)).plan).toBe("FREE");
    expect(sent.find((m) => m.to === users.c.email)?.text).toMatch(/Nothing in your store was deleted/);
    expect(await prismaUnscoped.planAuditEvent.count({ where: { tenantId: users.c.storeId, action: "plan_expired", actorKind: "system" } })).toBe(1);
    expect(await prismaUnscoped.tenant.count({ where: { id: users.c.storeId } })).toBe(1);
  });

  it("leaves a store managed by Stripe alone", async () => {
    await prismaUnscoped.tenant.update({ where: { id: users.b.storeId }, data: { plan: "PRO", planExpiresAt: new Date(Date.now() - 30 * HOUR), stripeSubscriptionId: `sub_verify_${suffix}` } });
    await runPlanPaymentSweep();
    expect((await plan(users.b.storeId)).plan).toBe("PRO");
    await prismaUnscoped.tenant.update({ where: { id: users.b.storeId }, data: { plan: "FREE", planExpiresAt: null, stripeSubscriptionId: null } });
  });
});
