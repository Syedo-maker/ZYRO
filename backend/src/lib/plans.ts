import type { PlanTier } from "@prisma/client";
import { env } from "../config/env";

/**
 * The plan catalog (Part A, revenue model): what Free, Pro and Business include, what they
 * cost, and the AI top-up packs. It lives in code rather than the database so a limit or price
 * change is one reviewed edit, and so the profitability check below can refuse to start the
 * server with a plan that would lose money.
 */

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  /** Monthly price in the smallest unit of BILLING_CURRENCY. Zero for Free. */
  priceCents: number;
  maxProducts: number;
  /** Staff accounts besides the owner. */
  maxStaff: number;
  aiGenerationsPerMonth: number;
  aiChatMessagesPerMonth: number;
  /** Longest window one analytics request may cover, in days. */
  analyticsMaxDays: number;
  customDomain: boolean;
}

export const BILLING_CURRENCY = "usd";

export const PLAN_ORDER: PlanTier[] = ["FREE", "PRO", "BUSINESS"];

export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: "FREE",
    name: "Free",
    priceCents: 0,
    maxProducts: 50,
    maxStaff: 2,
    // The env variables are the Free plan's AI allowance (they predate plans): kept so a
    // deployment or a script can lower it without a code change.
    aiGenerationsPerMonth: env.ai.monthlyGenerationsLimit,
    aiChatMessagesPerMonth: env.ai.monthlyChatMessagesLimit,
    analyticsMaxDays: 30,
    customDomain: false,
  },
  PRO: {
    tier: "PRO",
    name: "Pro",
    priceCents: 1200,
    maxProducts: 1000,
    maxStaff: 5,
    aiGenerationsPerMonth: 200,
    aiChatMessagesPerMonth: 700,
    analyticsMaxDays: 90,
    customDomain: false,
  },
  BUSINESS: {
    tier: "BUSINESS",
    name: "Business",
    priceCents: 3900,
    // Matches the recommendation service's per-store cap (MAX_PRODUCTS_PER_STORE), so a store
    // never outgrows brute-force similarity without anyone noticing.
    maxProducts: 5000,
    maxStaff: 20,
    aiGenerationsPerMonth: 800,
    aiChatMessagesPerMonth: 2500,
    analyticsMaxDays: 366, // the longest window analytics accepts at all (MAX_RANGE_DAYS)
    customDomain: true,
  },
};

export interface TopUpPack {
  id: string;
  name: string;
  generations: number;
  chatMessages: number;
  priceCents: number;
}

export const TOP_UP_PACKS: TopUpPack[] = [
  { id: "small", name: "Small AI pack", generations: 100, chatMessages: 300, priceCents: 500 },
  { id: "large", name: "Large AI pack", generations: 400, chatMessages: 1200, priceCents: 1900 },
];

export const findTopUpPack = (id: string) => TOP_UP_PACKS.find((p) => p.id === id);

// ---------------------------------------------------------------------------------------------
// What a tenant may use right now
// ---------------------------------------------------------------------------------------------

/**
 * The plan a store can actually use. A paid plan counts only while its paid period (plus a short
 * grace, because Stripe's renewal webhook can arrive a little after the period ends) has not
 * passed; otherwise the store is on Free. This is what makes "if renewal fails, fall back to
 * Free" true even if no webhook ever arrives to say so.
 */
export function effectiveTier(tenant: { plan: PlanTier; planExpiresAt: Date | null }, now = new Date()): PlanTier {
  if (tenant.plan === "FREE" || !tenant.planExpiresAt) return "FREE";
  const graceMs = env.billing.graceHours * 60 * 60 * 1000;
  return tenant.planExpiresAt.getTime() + graceMs > now.getTime() ? tenant.plan : "FREE";
}

// ---------------------------------------------------------------------------------------------
// Profitability guard: "plan prices must stay above the AI cost plus server cost"
// ---------------------------------------------------------------------------------------------

/**
 * Ceilings on what one AI call can cost, in US dollars. They are ceilings, not averages: they
 * assume every call fills the prompt-size cap and the output cap. See lib/aiModels.ts for the
 * models and the input/output limits they are derived from:
 *   generation, Sonnet 5 ($2 in / $10 out per million tokens): 4,000 in + 1,024 out = about $0.018
 *   chat, Haiku 4.5 ($1 in / $5 out): 4,000 in + 300 out = about $0.0055
 * Rounded up. Real usage is far below this; the point is a hard upper bound on the worst month.
 */
export const AI_COST_CEILING_USD = { generation: 0.02, chat: 0.006 };

/** Hosting, database and email share per paying store per month (an estimate, in US dollars). */
export const SERVER_COST_USD: Record<PlanTier, number> = { FREE: 0.1, PRO: 1.5, BUSINESS: 4 };

/** Stripe's card fee: 2.9% plus 30 cents. */
const stripeFeeUsd = (priceCents: number) => (priceCents > 0 ? (priceCents * 0.029 + 30) / 100 : 0);

export const aiCeilingCostUsd = (generations: number, chatMessages: number) =>
  generations * AI_COST_CEILING_USD.generation + chatMessages * AI_COST_CEILING_USD.chat;

/** Worst-case monthly cost of a plan to the platform, in US dollars. */
export function worstCaseMonthlyCostUsd(plan: PlanDefinition): number {
  return aiCeilingCostUsd(plan.aiGenerationsPerMonth, plan.aiChatMessagesPerMonth) + SERVER_COST_USD[plan.tier] + stripeFeeUsd(plan.priceCents);
}

/** The most a Free store is allowed to cost the platform in a month, in US dollars. */
export const FREE_PLAN_COST_BUDGET_USD = 1;

export function planEconomics() {
  return [...PLAN_ORDER.map((t) => PLANS[t]), ...TOP_UP_PACKS].map((item) => {
    const isPlan = "tier" in item;
    const cost = isPlan
      ? worstCaseMonthlyCostUsd(item)
      : aiCeilingCostUsd(item.generations, item.chatMessages) + stripeFeeUsd(item.priceCents);
    const price = item.priceCents / 100;
    return { id: isPlan ? item.tier : item.id, priceUsd: price, worstCaseCostUsd: Number(cost.toFixed(2)), profitable: price > cost };
  });
}

/**
 * Refuses to run with a paid plan or pack priced at or below its worst-case cost. Runs when this
 * module loads, so a bad edit to the numbers above fails at startup instead of losing money
 * quietly. The Free plan's AI allowance can be lowered or raised with environment variables, so
 * an operator (or a test script) raising it past the budget gets a warning, not a refusal to start.
 */
export function assertPlanEconomics(): void {
  for (const row of planEconomics()) {
    if (row.priceUsd === 0) {
      if (row.worstCaseCostUsd > FREE_PLAN_COST_BUDGET_USD) {
        console.warn(`[plans] The Free plan could cost $${row.worstCaseCostUsd} a month per store in the worst case (budget $${FREE_PLAN_COST_BUDGET_USD})`);
      }
    } else if (!row.profitable) {
      throw new Error(`Plan ${row.id} costs $${row.priceUsd} but could cost the platform $${row.worstCaseCostUsd} a month`);
    }
  }
}
assertPlanEconomics();
