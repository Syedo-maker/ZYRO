import type { PlanTier } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { PLANS, PLAN_ORDER, effectiveTier, type PlanDefinition } from "../../lib/plans";

/**
 * Reads a store's plan and enforces what it includes (Part A). Every limit is checked on the
 * server, at the moment of the action, from the plan stored on the tenant, which only a verified
 * Stripe webhook ever changes. Nothing here trusts the client about which plan it is on.
 *
 * A limit that is reached is a 402 carrying an `upgrade` hint (errors/AppError.ts), so the admin
 * can show "upgrade to Pro" instead of a bare error. Lowering a plan (a lapsed subscription)
 * never deletes anything: a store over its new limit keeps what it has and simply cannot add more.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A request for "the last N days" can cover a little over N days once daylight saving is involved. */
const RANGE_SLACK_MS = 3 * HOUR_MS;

export interface TenantPlan {
  /** The plan the store can use right now (Free once a paid period, plus grace, has passed). */
  tier: PlanTier;
  definition: PlanDefinition;
  /** The plan last paid for, which may be higher than `tier` if it lapsed. */
  paidTier: PlanTier;
  expiresAt: Date | null;
  /** active: paid and in period. grace: the period ended a moment ago. free: on Free (never paid or lapsed). */
  status: "free" | "active" | "grace";
  hasStripeCustomer: boolean;
  hasSubscription: boolean;
}

export async function getTenantPlan(tenantId: string, now = new Date()): Promise<TenantPlan> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw Errors.notFound("Store");
  const tier = effectiveTier(tenant, now);
  const status = tier === "FREE" ? "free" : tenant.planExpiresAt && tenant.planExpiresAt > now ? "active" : "grace";
  return {
    tier,
    definition: PLANS[tier],
    paidTier: tenant.plan,
    expiresAt: tenant.planExpiresAt,
    status,
    hasStripeCustomer: !!tenant.stripeCustomerId,
    hasSubscription: !!tenant.stripeSubscriptionId,
  };
}

/** The cheapest plan that lifts a limit, for the upgrade hint. */
function upgradeFor(current: TenantPlan, enough: (p: PlanDefinition) => boolean, feature: string, limit?: number) {
  const required = PLAN_ORDER.map((t) => PLANS[t]).find((p) => PLAN_ORDER.indexOf(p.tier) > PLAN_ORDER.indexOf(current.tier) && enough(p));
  return { feature, currentPlan: current.definition.name, requiredPlan: required?.name ?? null, ...(limit !== undefined ? { limit } : {}) };
}

export const planService = {
  getTenantPlan,

  async countProducts(tenantId: string): Promise<number> {
    return Product.countDocuments({ storeId: tenantId });
  },

  async countStaff(tenantId: string): Promise<number> {
    return prisma.staffMember.count({ where: { tenantId } });
  },

  /**
   * Before creating a product. A check followed by an insert can be overtaken by a burst of
   * simultaneous creates and overshoot the limit by a few products; that is accepted, because it
   * costs the platform nothing (products carry no per-unit cost) and the next attempt is refused.
   */
  async assertCanAddProduct(tenantId: string): Promise<void> {
    const plan = await getTenantPlan(tenantId);
    const limit = plan.definition.maxProducts;
    if ((await this.countProducts(tenantId)) >= limit) {
      throw Errors.planLimit(
        `The ${plan.definition.name} plan includes up to ${limit} products.`,
        upgradeFor(plan, (p) => p.maxProducts > limit, "products", limit)
      );
    }
  },

  /** Before adding a staff account. Must run inside the store's tenant context (StaffMember is tenant-scoped). */
  async assertCanAddStaff(tenantId: string): Promise<void> {
    const plan = await getTenantPlan(tenantId);
    const limit = plan.definition.maxStaff;
    if ((await this.countStaff(tenantId)) >= limit) {
      throw Errors.planLimit(
        `The ${plan.definition.name} plan includes ${limit} staff ${limit === 1 ? "account" : "accounts"}.`,
        upgradeFor(plan, (p) => p.maxStaff > limit, "staff", limit)
      );
    }
  },

  /** A report window longer than the plan allows. */
  async assertAnalyticsRange(tenantId: string, from: Date, to: Date): Promise<void> {
    const plan = await getTenantPlan(tenantId);
    const days = plan.definition.analyticsMaxDays;
    if (to.getTime() - from.getTime() > days * DAY_MS + RANGE_SLACK_MS) {
      throw Errors.planLimit(
        `The ${plan.definition.name} plan can report on up to ${days} days at a time.`,
        upgradeFor(plan, (p) => p.analyticsMaxDays > days, "analytics_range", days)
      );
    }
  },

  async assertCustomDomainAllowed(tenantId: string): Promise<void> {
    const plan = await getTenantPlan(tenantId);
    if (!plan.definition.customDomain) {
      throw Errors.planLimit(
        `A custom domain is not included in the ${plan.definition.name} plan.`,
        upgradeFor(plan, (p) => p.customDomain, "custom_domain")
      );
    }
  },
};
