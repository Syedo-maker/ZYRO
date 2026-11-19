import type { PlanTier } from "@prisma/client";
import { prismaUnscoped } from "../../lib/prisma";
import { PLAN_ORDER, PLANS, effectiveTier } from "../../lib/plans";
import { Errors } from "../../errors/AppError";
import { activatePlan, endPlan } from "./planActivation";

/**
 * Changing a store's plan by hand (the owners' decision of 2026-11-14): while ZYRO runs without Stripe
 * Billing, a platform admin moves a store to Pro or Business after it has paid another way (a bank
 * transfer, say), using scripts/set-plan.ts. A paid plan needs an end date, exactly as a Stripe
 * subscription has one; when it passes (plus the usual grace) the store is on Free again by itself.
 *
 * A store with a live Stripe subscription is refused: Stripe's next webhook would overwrite the
 * change. Cancel the subscription first, or let Stripe manage that store. The change itself goes
 * through the shared plan switch (planActivation.ts), so it is in the plan audit log like every other.
 */
export async function setPlanByHand(storeId: string, tier: PlanTier, months = 1) {
  if (!PLAN_ORDER.includes(tier)) throw Errors.validation(`Plan must be one of ${PLAN_ORDER.join(", ")}`);
  if (tier !== "FREE" && (!Number.isInteger(months) || months < 1 || months > 24)) throw Errors.validation("Months must be a whole number from 1 to 24");
  const store = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { id: true, name: true, stripeSubscriptionId: true } });
  if (!store) throw Errors.notFound("Store");
  if (store.stripeSubscriptionId) throw Errors.conflict("This store has a Stripe subscription, which would overwrite a change made by hand. Cancel it in Stripe first.");

  const now = new Date();
  const until = tier === "FREE" ? null : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate(), 23, 59, 59));
  const actor = { kind: "script" as const };
  const updated = await prismaUnscoped.$transaction((tx) =>
    tier === "FREE"
      ? endPlan(tx, { tenantId: storeId, actor, action: "plan_set_by_script" })
      : activatePlan(tx, { tenantId: storeId, tier: tier as "PRO" | "BUSINESS", until: until!, actor, action: "plan_set_by_script", details: { months } }),
  );
  return { store: store.name, plan: PLANS[updated.plan].name, until: updated.planExpiresAt, effective: PLANS[effectiveTier(updated)].name };
}
