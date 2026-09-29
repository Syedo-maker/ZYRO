import type { Festival } from "./festivals";

/**
 * The Growth Advisor's checks (Part C). Plain code over figures the server already has: no AI is
 * involved in deciding anything, so a check is cheap, repeatable and testable. The AI (or the
 * template, when it is unavailable) only puts the fired checks into words.
 */

/** Everything the checks look at, computed by advisor.service.ts. Totals only: no customer data. */
export interface AdvisorFacts {
  currency: string;
  /** Net sales and orders over the last 30 days, and the 30 days before. */
  last30: { netSales: number; orders: number };
  prev30: { netSales: number; orders: number };
  /** Best sellers of the last 30 days that are low on stock or will run out within a week. */
  lowStockBestSellers: { title: string; quantity: number; daysOfSupply: number | null; unitsSold30d: number }[];
  /** Products in stock that have not sold once in 30 days (and are at least 30 days old). */
  slowMovers: { count: number; examples: string[] };
  /** Abandoned-cart reminder emails sent in the last 7 days, and how many became orders. */
  abandonedCarts: { sent7d: number; converted7d: number };
  aiQuota: { used: number; limit: number };
  products: { used: number; limit: number };
  plan: { name: string; nextPlan: string | null };
  festivals: Festival[];
}

export type RuleKey =
  | "best_seller_low_stock"
  | "festival"
  | "sales_up"
  | "sales_down"
  | "abandoned_carts"
  | "slow_movers"
  | "ai_quota_high"
  | "near_product_limit";

export interface FiredRule {
  key: RuleKey;
  /** Lower comes first. */
  priority: number;
  /** praise: good news; tip: something to do; upgrade: the plan is genuinely running out. */
  kind: "praise" | "tip" | "upgrade";
  /** The figures that fired it, exactly as they will be handed to the writer. */
  facts: Record<string, unknown>;
}

export const THRESHOLDS = {
  salesChangePercent: 30,
  /** Too few orders and a percentage means nothing ("up 100%" from one order to two). */
  minOrdersForTrend: 5,
  abandonedCartsPerWeek: 5,
  slowMoversMin: 3,
  usageRatio: 0.8,
};

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);

export function evaluateRules(f: AdvisorFacts): FiredRule[] {
  const fired: FiredRule[] = [];

  const low = f.lowStockBestSellers[0];
  if (low) {
    fired.push({ key: "best_seller_low_stock", priority: 1, kind: "tip", facts: { product: low.title, left: low.quantity, daysOfSupply: low.daysOfSupply, soldLast30Days: low.unitsSold30d } });
  }

  const fest = f.festivals[0];
  if (fest) {
    fired.push({ key: "festival", priority: 2, kind: "tip", facts: { festival: fest.name, startsAround: fest.date, daysAway: fest.daysAway, approximate: fest.approximate, advice: fest.advice } });
  }

  const enoughOrders = f.last30.orders >= THRESHOLDS.minOrdersForTrend && f.prev30.orders >= THRESHOLDS.minOrdersForTrend && f.prev30.netSales > 0;
  if (enoughOrders) {
    const change = pct(f.last30.netSales, f.prev30.netSales);
    const facts = { changePercent: change, last30DaysSales: f.last30.netSales, previous30DaysSales: f.prev30.netSales, currency: f.currency };
    if (change >= THRESHOLDS.salesChangePercent) fired.push({ key: "sales_up", priority: 3, kind: "praise", facts });
    else if (change <= -THRESHOLDS.salesChangePercent) fired.push({ key: "sales_down", priority: 3, kind: "tip", facts });
  }

  if (f.abandonedCarts.sent7d >= THRESHOLDS.abandonedCartsPerWeek) {
    fired.push({ key: "abandoned_carts", priority: 4, kind: "tip", facts: { remindersSentLast7Days: f.abandonedCarts.sent7d, becameOrders: f.abandonedCarts.converted7d } });
  }

  if (f.slowMovers.count >= THRESHOLDS.slowMoversMin) {
    fired.push({ key: "slow_movers", priority: 5, kind: "tip", facts: { productsNotSoldIn30Days: f.slowMovers.count, examples: f.slowMovers.examples } });
  }

  // An upgrade is suggested only when a limit is genuinely close, and only if a bigger plan exists.
  if (f.aiQuota.limit > 0 && f.aiQuota.used / f.aiQuota.limit >= THRESHOLDS.usageRatio) {
    fired.push({ key: "ai_quota_high", priority: 6, kind: "upgrade", facts: { aiGenerationsUsed: f.aiQuota.used, aiGenerationsIncluded: f.aiQuota.limit, plan: f.plan.name, biggerPlan: f.plan.nextPlan } });
  }
  if (f.plan.nextPlan && f.products.limit > 0 && f.products.used / f.products.limit >= THRESHOLDS.usageRatio) {
    fired.push({ key: "near_product_limit", priority: 7, kind: "upgrade", facts: { products: f.products.used, productLimit: f.products.limit, plan: f.plan.name, biggerPlan: f.plan.nextPlan } });
  }

  return fired.sort((a, b) => a.priority - b.priority);
}

/**
 * What this week's tip is about: one main point, plus the good news if there is any, plus one
 * upgrade line only if a limit is close. Nothing said in the last few weeks is said again (a
 * merchant told about Eid last week does not need the same tip, and an upgrade line every week
 * would be nagging), except a best-seller running out, which is always worth saying while it is
 * true. An empty result means there is nothing new to say, and no tip is written this week.
 */
export function chooseTopics(fired: FiredRule[], recentKeys: RuleKey[]): FiredRule[] {
  const fresh = fired.filter((r) => r.key === "best_seller_low_stock" || !recentKeys.includes(r.key));
  const main = fresh.find((r) => r.kind === "tip");
  const praise = fresh.find((r) => r.kind === "praise");
  const upgrade = fresh.find((r) => r.kind === "upgrade");
  return [main, praise, upgrade].filter((r): r is FiredRule => !!r);
}
