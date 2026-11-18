/**
 * Changing a store's plan by hand (modules/billing/manualPlan.service.ts): a paid plan with an end
 * date that the plan rules honour, back to Free, and refusals that keep Stripe-managed stores safe.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let setPlanByHand: typeof import("../../src/modules/billing/manualPlan.service").setPlanByHand;
let effectiveTier: typeof import("../../src/lib/plans").effectiveTier;

const suffix = Date.now().toString(36);
let storeId = "";
let userId = "";

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ setPlanByHand } = await import("../../src/modules/billing/manualPlan.service"));
  ({ effectiveTier } = await import("../../src/lib/plans"));
  const reg = await request(app).post("/api/v1/auth/register").send({ email: `verify-plan-${suffix}@example.com`, password: "password123", storeName: `Plan ${suffix}`, storeSlug: `verify-plan-${suffix}` });
  userId = reg.body.user.id;
  storeId = (await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`)).body[0].id;
}, 60_000);

afterAll(async () => {
  await prismaUnscoped.tenant.deleteMany({ where: { id: storeId } });
  await prismaUnscoped.user.deleteMany({ where: { id: userId } });
  await prismaUnscoped.$disconnect();
});

it("moves a store to Pro for three months, and the plan rules count it as Pro", async () => {
  const result = await setPlanByHand(storeId, "PRO", 3);
  expect(result).toMatchObject({ plan: "Pro", effective: "Pro" });
  const t = await prismaUnscoped.tenant.findUniqueOrThrow({ where: { id: storeId }, select: { plan: true, planExpiresAt: true } });
  expect(t.plan).toBe("PRO");
  const days = (t.planExpiresAt!.getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(85);
  expect(days).toBeLessThan(95);
  // Once the end date (plus grace) has passed, it is Free again by itself.
  expect(effectiveTier(t, new Date(t.planExpiresAt!.getTime() + 30 * 86_400_000))).toBe("FREE");
});

it("goes back to Free at once", async () => {
  expect(await setPlanByHand(storeId, "FREE")).toMatchObject({ plan: "Free", until: null, effective: "Free" });
});

it("refuses a store with a Stripe subscription, an unknown plan, a bad number of months and an unknown store", async () => {
  await expect(setPlanByHand(storeId, "PRO", 0)).rejects.toMatchObject({ detail: expect.stringMatching(/Months/) });
  await expect(setPlanByHand(storeId, "GOLD" as never, 1)).rejects.toMatchObject({ detail: expect.stringMatching(/Plan must be/) });
  await expect(setPlanByHand("cnosuchstore000000000000", "PRO", 1)).rejects.toThrow(/not found/i);
  await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { stripeSubscriptionId: `sub_verify_${suffix}` } });
  await expect(setPlanByHand(storeId, "BUSINESS", 1)).rejects.toMatchObject({ detail: expect.stringMatching(/Stripe subscription/) });
  expect((await prismaUnscoped.tenant.findUniqueOrThrow({ where: { id: storeId } })).plan).toBe("FREE");
});
