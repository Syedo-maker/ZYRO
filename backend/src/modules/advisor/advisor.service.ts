import { Prisma } from "@prisma/client";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { Errors } from "../../errors/AppError";
import { PLANS, PLAN_ORDER } from "../../lib/plans";
import { Product } from "../../models/Product.model";
import { analyticsService } from "../analytics/analytics.service";
import { computeLowStock } from "../insights/insights.service";
import { getOrCreateQuota } from "../ai/ai.quota.service";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { planService } from "../billing/plan.service";
import { upcomingFestivals } from "./festivals";
import { chooseTopics, evaluateRules, type AdvisorFacts, type FiredRule, type RuleKey } from "./advisor.rules";

/**
 * The Growth Advisor (Part C, extending the Phase 5 business insights). Once a week it checks each
 * store's figures with plain rules (advisor.rules.ts); only when something is worth saying does it
 * write one short tip, and it writes it with the AI only from those figures, never from customer
 * data. If the AI is unavailable (no key, the provider down) the same figures are written up from
 * templates, so the merchant gets the tip either way. The AI cost is the platform's: it never
 * touches the store's allowance.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A tip stays on the dashboard this long (the next weekly check replaces it). */
const SHOW_FOR_DAYS = 7;
/** Nothing said in this many recent tips is said again (except a best-seller running out). */
const RECENT_TIPS = 3;

/** Monday of the week (UTC), "YYYY-MM-DD": the unit "at most one tip a week" is counted in. */
export function weekStartOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const shift = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - shift * DAY_MS).toISOString().slice(0, 10);
}

const money = (n: number, currency: string) => new Intl.NumberFormat("en-PK", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** The figures the checks look at. Must run inside the store's tenant context. */
export async function gatherFacts(tenantId: string, now = new Date()): Promise<AdvisorFacts> {
  const [last30, prev30, lowStock, plan, quota, productCount, carts, slow] = await Promise.all([
    analyticsService.summary(tenantId, { from: new Date(now.getTime() - 30 * DAY_MS), to: now, tzOffsetMinutes: 0 }),
    analyticsService.summary(tenantId, { from: new Date(now.getTime() - 60 * DAY_MS), to: new Date(now.getTime() - 30 * DAY_MS), tzOffsetMinutes: 0 }),
    computeLowStock(tenantId),
    planService.getTenantPlan(tenantId, now),
    getOrCreateQuota(tenantId),
    planService.countProducts(tenantId),
    Promise.all([
      prisma.cartRecoveryEvent.count({ where: { tenantId, sentAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
      prisma.cartRecoveryEvent.count({ where: { tenantId, sentAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, status: "CONVERTED" } }),
    ]),
    slowMovers(tenantId, now),
  ]);

  const sold = new Map<string, number>(last30.topProducts.map((p: { productId: string; unitsSold: number }) => [p.productId, p.unitsSold]));
  const next = PLAN_ORDER[PLAN_ORDER.indexOf(plan.tier) + 1];

  return {
    currency: last30.currency,
    last30: { netSales: last30.totals.netSales, orders: last30.totals.orders },
    prev30: { netSales: prev30.totals.netSales, orders: prev30.totals.orders },
    lowStockBestSellers: lowStock
      .filter((i) => sold.has(i.productId))
      .map((i) => ({ title: i.title, quantity: i.quantity, daysOfSupply: i.daysOfSupply, unitsSold30d: sold.get(i.productId)! })),
    slowMovers: slow,
    abandonedCarts: { sent7d: carts[0], converted7d: carts[1] },
    aiQuota: { used: quota.generationsUsed, limit: quota.generationsLimit },
    products: { used: productCount, limit: plan.definition.maxProducts },
    plan: { name: plan.definition.name, nextPlan: next ? PLANS[next].name : null },
    festivals: upcomingFestivals(now),
  };
}

/** Products in stock, at least 30 days old, with no sale in the last 30 days. */
async function slowMovers(tenantId: string, now: Date): Promise<{ count: number; examples: string[] }> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [levels, sales, old] = await Promise.all([
    prisma.inventoryLevel.groupBy({ by: ["productId"], where: { tenantId }, _sum: { quantity: true } }),
    prisma.stockMovement.findMany({ where: { tenantId, type: "SALE", createdAt: { gte: since } }, select: { productId: true }, distinct: ["productId"] }),
    Product.find({ storeId: tenantId, createdAt: { $lte: since } }).select("title").sort({ createdAt: 1 }),
  ]);
  const inStock = new Set(levels.filter((l) => (l._sum.quantity ?? 0) > 0).map((l) => l.productId));
  const soldRecently = new Set(sales.map((s) => s.productId));
  const slow = old.filter((p) => inStock.has(p._id.toString()) && !soldRecently.has(p._id.toString()));
  return { count: slow.length, examples: slow.slice(0, 3).map((p) => p.title) };
}

// ---------------------------------------------------------------------------------------------
// Writing the tip
// ---------------------------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You write one short, warm, practical message to the owner of a small shop in Pakistan, in plain English. " +
  "Two to four sentences, no markdown, no greeting line, no sign-off. Use only the facts given: never invent a " +
  "number, date, product, trend or promise. If a fact is marked praise, start with it. Give the practical step the " +
  "facts point to. Mention upgrading the plan only if an upgrade fact is given. When a date is marked approximate, " +
  "say 'around' that date.";

function describe(r: FiredRule, currency: string): string {
  const f = r.facts as Record<string, never>;
  switch (r.key) {
    case "best_seller_low_stock":
      return `[tip] Best seller running low: "${f.product}", ${f.left} left${f.daysOfSupply !== null ? `, about ${f.daysOfSupply} days of stock at the current pace` : ""}; sold ${f.soldLast30Days} in the last 30 days.`;
    case "festival":
      return `[tip] ${f.festival} starts ${f.approximate ? "around" : "on"} ${longDate(f.startsAround)} (${f.daysAway} days away${f.approximate ? ", approximate: moon sighting decides" : ""}). ${f.advice}`;
    case "sales_up":
      return `[praise] Net sales in the last 30 days: ${money(f.last30DaysSales, currency)}, up ${f.changePercent}% on the 30 days before (${money(f.previous30DaysSales, currency)}).`;
    case "sales_down":
      return `[tip] Net sales in the last 30 days: ${money(f.last30DaysSales, currency)}, down ${Math.abs(f.changePercent)}% on the 30 days before (${money(f.previous30DaysSales, currency)}). A time-limited discount code or a bundle can bring buyers back.`;
    case "abandoned_carts":
      return `[tip] ${f.remindersSentLast7Days} shoppers left items in their cart this week; ${f.becameOrders} came back and bought. Free delivery or a small discount often wins the rest.`;
    case "slow_movers":
      return `[tip] ${f.productsNotSoldIn30Days} products in stock have not sold in 30 days (for example ${(f.examples as unknown as string[]).map((e) => `"${e}"`).join(", ")}). A bundle with a best seller, a better photo or description, or a small discount can move them.`;
    case "ai_quota_high":
      return `[upgrade] ${f.aiGenerationsUsed} of ${f.aiGenerationsIncluded} AI generations used this month on the ${f.plan} plan.${f.biggerPlan ? ` The ${f.biggerPlan} plan includes more.` : " An AI pack adds more."}`;
    case "near_product_limit":
      return `[upgrade] ${f.products} of ${f.productLimit} products used on the ${f.plan} plan; the ${f.biggerPlan} plan allows more.`;
  }
}

/** The same message without the AI: one sentence per point, praise first. */
function templateMessage(topics: FiredRule[], currency: string): string {
  const ordered = [...topics].sort((a, b) => (a.kind === "praise" ? -1 : b.kind === "praise" ? 1 : 0));
  return ordered.map((r) => describe(r, currency).replace(/^\[\w+\] /, "")).join(" ");
}

async function writeMessage(tenantId: string, topics: FiredRule[], currency: string) {
  const prompt = "Facts:\n" + topics.map((r) => `- ${describe(r, currency)}`).join("\n");
  try {
    const result = await aiGenerate({ tenantId, promptType: "growth_tip", system: SYSTEM_PROMPT, prompt, maxTokens: 250, billedTo: "platform" });
    return { message: result.text, source: "ai" as const, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, prompt };
  } catch {
    // No key, provider down or a timeout: the merchant still gets the tip, written from the same figures.
    return { message: templateMessage(topics, currency), source: "template" as const, model: null, inputTokens: 0, outputTokens: 0, prompt };
  }
}

// ---------------------------------------------------------------------------------------------

const present = (t: { id: string; weekStart: string; message: string; source: string; rules: unknown; createdAt: Date }) => ({
  id: t.id,
  weekStart: t.weekStart,
  message: t.message,
  source: t.source,
  topics: ((t.rules as FiredRule[]) ?? []).map((r) => ({ key: r.key, kind: r.kind })),
  createdAt: t.createdAt,
});

export const advisorService = {
  /**
   * This week's check for one store. Must run inside its tenant context. Returns the week's tip
   * (the existing one if the week already has one), or null when tips are off or nothing new is
   * worth saying.
   */
  async runForTenant(tenantId: string, now = new Date()) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { growthTipsEnabled: true } });
    if (!tenant) throw Errors.notFound("Store");
    if (!tenant.growthTipsEnabled) return null;

    const weekStart = weekStartOf(now);
    const existing = await prisma.growthTip.findFirst({ where: { tenantId, weekStart } });
    if (existing) return present(existing);

    const recent = await prisma.growthTip.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: RECENT_TIPS, select: { rules: true } });
    const recentKeys = recent.flatMap((t) => (t.rules as unknown as FiredRule[]).map((r) => r.key)) as RuleKey[];

    const facts = await gatherFacts(tenantId, now);
    const topics = chooseTopics(evaluateRules(facts), recentKeys);
    if (topics.length === 0) return null;

    const written = await writeMessage(tenantId, topics, facts.currency);
    try {
      const tip = await prisma.growthTip.create({
        data: {
          tenantId,
          weekStart,
          rules: topics as unknown as Prisma.InputJsonValue,
          message: written.message,
          source: written.source,
          model: written.model,
          inputTokens: written.inputTokens,
          outputTokens: written.outputTokens,
        },
      });
      return present(tip);
    } catch (err) {
      // Two checks for the same store ran at once: the week's unique key keeps exactly one tip.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return present((await prisma.growthTip.findFirst({ where: { tenantId, weekStart } }))!);
      }
      throw err;
    }
  },

  /**
   * The weekly job: every store with tips on, one at a time; one store's failure never stops the
   * rest. `onlyTenantIds` limits the run (tests use it, so they never write tips onto real stores).
   */
  async runAll(now = new Date(), onlyTenantIds?: string[]) {
    const tenants = await prismaUnscoped.tenant.findMany({
      where: { growthTipsEnabled: true, ...(onlyTenantIds ? { id: { in: onlyTenantIds } } : {}) },
      select: { id: true },
    });
    const outcome = { stores: tenants.length, tips: 0, quiet: 0, failed: 0 };
    for (const t of tenants) {
      try {
        const tip = await tenantContext.run(t.id, () => advisorService.runForTenant(t.id, now));
        if (tip) outcome.tips++;
        else outcome.quiet++;
      } catch (err) {
        outcome.failed++;
        console.error(`[advisor] store ${t.id}: ${(err as Error).message}`);
      }
    }
    return outcome;
  },

  /** What the dashboard shows: whether tips are on, and the current tip (from the last 7 days, not dismissed). */
  async current(tenantId: string, now = new Date()) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { growthTipsEnabled: true } });
    if (!tenant) throw Errors.notFound("Store");
    const tip = tenant.growthTipsEnabled
      ? await prisma.growthTip.findFirst({
          where: { tenantId, dismissedAt: null, createdAt: { gte: new Date(now.getTime() - SHOW_FOR_DAYS * DAY_MS) } },
          orderBy: { createdAt: "desc" },
        })
      : null;
    return { enabled: tenant.growthTipsEnabled, tip: tip ? present(tip) : null };
  },

  async setEnabled(tenantId: string, enabled: boolean) {
    await prisma.tenant.update({ where: { id: tenantId }, data: { growthTipsEnabled: enabled } });
    return advisorService.current(tenantId);
  },

  async dismiss(tenantId: string, tipId: string) {
    const { count } = await prisma.growthTip.updateMany({ where: { id: tipId, tenantId, dismissedAt: null }, data: { dismissedAt: new Date() } });
    if (count === 0) throw Errors.notFound("Tip");
  },
};

/** For tests: the exact prompt text a set of topics produces (to prove what the AI is and is not given). */
export const __forTests = { describe, templateMessage };
