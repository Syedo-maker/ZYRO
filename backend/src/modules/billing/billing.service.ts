import { prisma, prismaUnscoped } from "../../lib/prisma";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";
import { getStripeGateway } from "../../lib/stripe";
import { BILLING_CURRENCY, PLANS, PLAN_ORDER, TOP_UP_PACKS, findTopUpPack, planEconomics } from "../../lib/plans";
import { getOrCreateQuota, getTopUpBalance } from "../ai/ai.quota.service";
import { planService } from "./plan.service";

/**
 * The store owner's side of billing (Part A): what plan the store is on and what it has used,
 * and the three ways to spend money with ZYRO (subscribe, buy an AI top-up pack, manage the
 * subscription). Every price and every plan comes from the catalog in lib/plans.ts and is chosen
 * here on the server; a request only names a plan or a pack by id. Nothing in this file changes
 * a store's plan or credits: only the verified webhook (billing.webhook.ts) does that, after
 * Stripe has actually taken the money.
 */

const billingConfigured = () => !!env.stripe.secretKey && !!env.stripe.webhookSecret;

const adminUrl = (query: string) => `${env.storefrontUrl.replace(/\/+$/, "")}/admin/billing?${query}`;

const publicPlan = (p: (typeof PLANS)[keyof typeof PLANS]) => ({
  tier: p.tier,
  name: p.name,
  priceCents: p.priceCents,
  currency: BILLING_CURRENCY,
  maxProducts: p.maxProducts,
  maxStaff: p.maxStaff,
  aiGenerationsPerMonth: p.aiGenerationsPerMonth,
  aiChatMessagesPerMonth: p.aiChatMessagesPerMonth,
  analyticsMaxDays: p.analyticsMaxDays,
  customDomain: p.customDomain,
});

export const billingService = {
  /** The public price list: plans and AI top-up packs. */
  catalog() {
    return {
      currency: BILLING_CURRENCY,
      plans: PLAN_ORDER.map((t) => publicPlan(PLANS[t])),
      topUpPacks: TOP_UP_PACKS.map((p) => ({ id: p.id, name: p.name, generations: p.generations, chatMessages: p.chatMessages, priceCents: p.priceCents })),
      billingConfigured: billingConfigured(),
    };
  },

  /** Platform economics for the super-admin: each plan's price against its worst-case cost. */
  economics: planEconomics,

  /** A store's plan, its limits, and how much of each it has used. Runs inside the store's tenant context. */
  async overview(storeId: string) {
    const plan = await planService.getTenantPlan(storeId);
    const [products, staff, quota, topUp] = await Promise.all([
      planService.countProducts(storeId),
      planService.countStaff(storeId),
      getOrCreateQuota(storeId),
      getTopUpBalance(storeId),
    ]);
    return {
      ...this.catalog(),
      plan: {
        tier: plan.tier,
        name: plan.definition.name,
        status: plan.status,
        /** The plan last paid for, when a lapsed subscription has dropped the store to Free. */
        lapsedFrom: plan.tier === "FREE" && plan.paidTier !== "FREE" ? PLANS[plan.paidTier].name : null,
        paidUntil: plan.expiresAt,
        canManageSubscription: plan.hasStripeCustomer,
      },
      limits: publicPlan(plan.definition),
      usage: {
        products: { used: products, limit: plan.definition.maxProducts },
        staff: { used: staff, limit: plan.definition.maxStaff },
        aiGenerations: { used: quota.generationsUsed, limit: quota.generationsLimit },
        aiChatMessages: { used: quota.chatMessagesUsed, limit: quota.chatMessagesLimit },
      },
      topUp: { generations: topUp.generations, chatMessages: topUp.chatMessages },
    };
  },

  /** Starts a subscription checkout. Only a Free store can: a paid store changes plan by cancelling and resubscribing. */
  async startSubscription(storeId: string, ownerId: string, tier: string) {
    const target = tier === "PRO" || tier === "BUSINESS" ? PLANS[tier] : undefined;
    if (!target) throw Errors.validation("Choose the Pro or Business plan");
    const plan = await planService.getTenantPlan(storeId);
    if (plan.tier !== "FREE") {
      throw Errors.conflict(`This store is already on the ${plan.definition.name} plan. Manage or cancel it first, then choose a new plan when it ends.`);
    }
    const [tenant, owner] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: storeId } }),
      prismaUnscoped.user.findUnique({ where: { id: ownerId }, select: { email: true } }),
    ]);
    if (!tenant) throw Errors.notFound("Store");
    const session = await getStripeGateway().createSubscriptionCheckout({
      tenantId: storeId,
      plan: target.tier,
      planName: target.name,
      priceCents: target.priceCents,
      currency: BILLING_CURRENCY,
      customerId: tenant.stripeCustomerId ?? undefined,
      customerEmail: owner?.email,
      successUrl: adminUrl("checkout=success"),
      cancelUrl: adminUrl("checkout=cancelled"),
    });
    return { url: session.url };
  },

  async startTopUp(storeId: string, ownerId: string, packId: string) {
    const pack = findTopUpPack(packId);
    if (!pack) throw Errors.validation("Choose one of the AI top-up packs");
    const [tenant, owner] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: storeId } }),
      prismaUnscoped.user.findUnique({ where: { id: ownerId }, select: { email: true } }),
    ]);
    if (!tenant) throw Errors.notFound("Store");
    const session = await getStripeGateway().createTopUpCheckout({
      tenantId: storeId,
      packId: pack.id,
      packName: pack.name,
      priceCents: pack.priceCents,
      currency: BILLING_CURRENCY,
      customerId: tenant.stripeCustomerId ?? undefined,
      customerEmail: owner?.email,
      successUrl: adminUrl("topup=success"),
      cancelUrl: adminUrl("topup=cancelled"),
    });
    return { url: session.url };
  },

  async openPortal(storeId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
    if (!tenant) throw Errors.notFound("Store");
    if (!tenant.stripeCustomerId) throw Errors.conflict("This store has no subscription to manage yet");
    const session = await getStripeGateway().createBillingPortalSession(tenant.stripeCustomerId, adminUrl("portal=return"));
    return { url: session.url };
  },
};
