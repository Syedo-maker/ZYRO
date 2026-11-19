/**
 * Pro plan payments, the core: one plan switch that always writes an audit entry, renewals that keep
 * the days left, provisional plans with lower AI limits and no grace, and a billing currency that
 * follows the store until it is locked by the first payment.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.PLAN_PRICES = '{"PRO":{"PKR":3000,"USD":12}}';
process.env.PLAN_PAYMENT_METHODS = JSON.stringify({
  PKR: [{ label: "Bank transfer", accountTitle: "Zyro Demo", accountNumber: "PK00TEST0001" }],
  USD: [{ label: "Wise", accountTitle: "Zyro Demo", accountNumber: "WISE-0001" }],
});
process.env.PLAN_APPROVER_EMAILS = "approver@example.com";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let activation: typeof import("../../src/modules/billing/planActivation");
let currency: typeof import("../../src/modules/billing/billingCurrency");
let getTenantPlan: typeof import("../../src/modules/billing/plan.service").getTenantPlan;
let setPlanByHand: typeof import("../../src/modules/billing/manualPlan.service").setPlanByHand;

const suffix = Date.now().toString(36);
const stores: Record<string, { storeId: string; userId: string }> = {};
const DAY = 24 * 60 * 60 * 1000;

async function makeStore(tag: string, storeCurrency: string) {
  const reg = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: `verify-planact-${tag}-${suffix}@example.com`, password: "password123", storeName: `Plan ${tag}`, storeSlug: `verify-planact-${tag}-${suffix}`, currency: storeCurrency });
  expect(reg.status).toBe(201);
  const storeId = (await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`)).body[0].id;
  stores[tag] = { storeId, userId: reg.body.user.id };
  return stores[tag];
}
const audit = (tenantId: string) => prismaUnscoped.planAuditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  activation = await import("../../src/modules/billing/planActivation");
  currency = await import("../../src/modules/billing/billingCurrency");
  ({ getTenantPlan } = await import("../../src/modules/billing/plan.service"));
  ({ setPlanByHand } = await import("../../src/modules/billing/manualPlan.service"));
  await makeStore("pkr", "PKR");
  await makeStore("aed", "AED");
}, 60_000);

afterAll(async () => {
  const ids = Object.values(stores);
  await prismaUnscoped.planAuditEvent.deleteMany({ where: { tenantId: { in: ids.map((s) => s.storeId) } } });
  await prismaUnscoped.planAuditEvent.deleteMany({ where: { details: { path: ["ownerId"], string_contains: suffix } } }).catch(() => undefined);
  await prismaUnscoped.tenant.deleteMany({ where: { id: { in: ids.map((s) => s.storeId) } } });
  await prismaUnscoped.user.deleteMany({ where: { id: { in: ids.map((s) => s.userId) } } });
  await prismaUnscoped.$disconnect();
});

describe("the plan switch", () => {
  it("activates Pro until a date and records who did it, from what to what", async () => {
    const { storeId, userId } = stores.pkr;
    const until = new Date(Date.now() + 30 * DAY);
    await prismaUnscoped.$transaction((tx) =>
      activation.activatePlan(tx, { tenantId: storeId, tier: "PRO", until, actor: { kind: "approver", userId }, action: "plan_payment_approved", requestId: "req-1", details: { amountMinor: 300000, currency: "PKR" } }),
    );
    const plan = await getTenantPlan(storeId);
    expect(plan).toMatchObject({ tier: "PRO", provisional: false });
    const [entry] = await audit(storeId);
    expect(entry).toMatchObject({ actorKind: "approver", actorUserId: userId, action: "plan_payment_approved", requestId: "req-1" });
    expect(entry.details).toMatchObject({ amountMinor: 300000, currency: "PKR", from: { plan: "FREE" }, to: { plan: "PRO", provisional: false } });
  });

  it("ends a plan without deleting anything, and records it", async () => {
    const { storeId } = stores.pkr;
    await prismaUnscoped.$transaction((tx) => activation.endPlan(tx, { tenantId: storeId, actor: { kind: "system" }, action: "plan_expired" }));
    expect((await getTenantPlan(storeId)).tier).toBe("FREE");
    expect((await audit(storeId)).at(-1)).toMatchObject({ actorKind: "system", action: "plan_expired" });
    expect(await prismaUnscoped.tenant.count({ where: { id: storeId } })).toBe(1);
  });

  it("refuses a date in the past", async () => {
    await expect(
      prismaUnscoped.$transaction((tx) => activation.activatePlan(tx, { tenantId: stores.pkr.storeId, tier: "PRO", until: new Date(Date.now() - 1000), actor: { kind: "system" }, action: "x" })),
    ).rejects.toMatchObject({ detail: expect.stringMatching(/future/) });
  });

  it("the set-plan script goes through it, so it is audited too", async () => {
    await setPlanByHand(stores.pkr.storeId, "PRO", 1);
    expect((await audit(stores.pkr.storeId)).at(-1)).toMatchObject({ actorKind: "script", action: "plan_set_by_script" });
    await setPlanByHand(stores.pkr.storeId, "FREE");
  });
});

describe("where a paid period ends", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  it("a first upgrade counts from the approval", () => {
    expect(activation.nextPeriodEnd({ plan: "FREE", planExpiresAt: null, planProvisional: false }, "PRO", 30, now)).toEqual(new Date(now.getTime() + 30 * DAY));
  });
  it("an early renewal keeps the days left", () => {
    const end = new Date(now.getTime() + 10 * DAY);
    expect(activation.nextPeriodEnd({ plan: "PRO", planExpiresAt: end, planProvisional: false }, "PRO", 30, now)).toEqual(new Date(end.getTime() + 30 * DAY));
  });
  it("a provisional plan becoming real counts from the approval", () => {
    const end = new Date(now.getTime() + 1 * DAY);
    expect(activation.nextPeriodEnd({ plan: "PRO", planExpiresAt: end, planProvisional: true }, "PRO", 30, now)).toEqual(new Date(now.getTime() + 30 * DAY));
  });
  it("a lapsed plan counts from the approval", () => {
    const end = new Date(now.getTime() - 5 * DAY);
    expect(activation.nextPeriodEnd({ plan: "PRO", planExpiresAt: end, planProvisional: false }, "PRO", 30, now)).toEqual(new Date(now.getTime() + 30 * DAY));
  });
});

describe("a provisional plan", () => {
  it("has lower AI limits than full Pro, and is marked provisional", async () => {
    const { storeId } = stores.aed;
    await prismaUnscoped.$transaction((tx) =>
      activation.activatePlan(tx, { tenantId: storeId, tier: "PRO", until: new Date(Date.now() + 48 * 3600 * 1000), provisional: true, actor: { kind: "system" }, action: "provisional_granted" }),
    );
    const plan = await getTenantPlan(storeId);
    expect(plan).toMatchObject({ tier: "PRO", provisional: true });
    expect(plan.definition.aiGenerationsPerMonth).toBe(40);
    expect(plan.definition.aiChatMessagesPerMonth).toBe(150);
    expect(plan.definition.maxProducts).toBe(1000);
  });

  it("has no grace period: a minute after it ends, the store is on Free", async () => {
    const { storeId } = stores.aed;
    await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { planExpiresAt: new Date(Date.now() - 60_000) } });
    expect((await getTenantPlan(storeId)).tier).toBe("FREE");
    // A full plan just past its end is still inside the grace period.
    await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { planProvisional: false } });
    expect((await getTenantPlan(storeId)).tier).toBe("PRO");
    await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { plan: "FREE", planExpiresAt: null } });
  });
});

describe("the billing currency", () => {
  it("follows the store until chosen: PKR stays PKR, anything else is USD", async () => {
    expect(await currency.billingCurrencyFor(stores.pkr.userId, "PKR")).toEqual({ currency: "PKR", locked: false, choices: ["PKR", "USD"] });
    expect((await currency.billingCurrencyFor(stores.aed.userId, "AED")).currency).toBe("USD");
  });

  it("can be chosen while unlocked, with an audit entry", async () => {
    await currency.chooseBillingCurrency(stores.aed.userId, "pkr", stores.aed.storeId);
    expect((await currency.billingCurrencyFor(stores.aed.userId, "AED")).currency).toBe("PKR");
    expect((await audit(stores.aed.storeId)).at(-1)).toMatchObject({ actorKind: "owner", action: "billing_currency_chosen", details: { currency: "PKR" } });
  });

  it("refuses a currency the price table does not charge in", async () => {
    await expect(currency.chooseBillingCurrency(stores.aed.userId, "EUR", stores.aed.storeId)).rejects.toMatchObject({ detail: expect.stringMatching(/cannot be paid in EUR/) });
  });

  it("is locked by the first payment: the owner can no longer change it", async () => {
    await currency.lockBillingCurrency(prismaUnscoped, stores.aed.userId, "PKR");
    expect(await currency.billingCurrencyFor(stores.aed.userId, "AED")).toMatchObject({ currency: "PKR", locked: true });
    await expect(currency.chooseBillingCurrency(stores.aed.userId, "USD", stores.aed.storeId)).rejects.toMatchObject({ detail: expect.stringMatching(/locked/) });
  });

  it("a platform admin can still change it, with a reason in the audit log", async () => {
    await currency.adminChangeBillingCurrency(stores.aed.userId, "USD", { kind: "approver", userId: stores.pkr.userId }, "owner moved abroad");
    expect((await currency.billingCurrencyFor(stores.aed.userId, "AED")).currency).toBe("USD");
    const entry = await prismaUnscoped.planAuditEvent.findFirst({ where: { action: "billing_currency_changed_by_admin", actorUserId: stores.pkr.userId }, orderBy: { createdAt: "desc" } });
    expect(entry?.details).toMatchObject({ ownerId: stores.aed.userId, from: "PKR", to: "USD", reason: "owner moved abroad" });
    await prismaUnscoped.planAuditEvent.deleteMany({ where: { id: entry!.id } });
  });
});
