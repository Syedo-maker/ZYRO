import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { analyticsService } from "../analytics/analytics.service";
import { Product } from "../../models/Product.model";

/**
 * AI business insights (Implementation_Plan.md Phase 5, the last item this phase asks for):
 * sales trend, best sellers, low-stock alerts and simple demand forecasting, computed from real
 * data (the same analytics module Phase 3 built, plus the `StockMovement` ledger and the
 * `InventoryLevel.lowStockThreshold` field - a Phase 0 schema field nothing had used until now),
 * then written up in plain language by the AI orchestrator. The numbers are never the AI's own;
 * it only turns already-correct facts into something readable, the same rule every other AI
 * feature in this codebase follows.
 */

interface LowStockItem {
  productId: string;
  title: string;
  quantity: number;
  threshold: number;
  dailyVelocity: number | null;
  daysOfSupply: number | null;
}

interface Facts {
  currency: string;
  salesTrend: { thisWeek: number; lastWeek: number; changePercent: number | null };
  bestSellers: { title: string; unitsSold: number; revenue: number }[];
  lowStock: LowStockItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every product's on-hand quantity (summed across locations) and its low-stock threshold (the
 *  smallest one set across its locations, so a store with several is never less cautious than
 *  its strictest one; the env fallback when nothing was ever configured). */
async function stockLevels(tenantId: string): Promise<Map<string, { quantity: number; threshold: number }>> {
  const rows = await prisma.inventoryLevel.findMany({ where: { tenantId }, select: { productId: true, quantity: true, lowStockThreshold: true } });
  const out = new Map<string, { quantity: number; threshold: number }>();
  for (const r of rows) {
    const existing = out.get(r.productId);
    const threshold = r.lowStockThreshold ?? env.insights.lowStockFallbackThreshold;
    if (!existing) {
      out.set(r.productId, { quantity: r.quantity, threshold });
    } else {
      existing.quantity += r.quantity;
      existing.threshold = Math.min(existing.threshold, threshold);
    }
  }
  return out;
}

/** Units sold per product over the trailing velocity window, from the StockMovement ledger
 *  (SALE rows carry a negative quantityChange; see inventory.service.ts). */
async function salesVelocity(tenantId: string): Promise<Map<string, number>> {
  const since = new Date(Date.now() - env.insights.velocityWindowDays * DAY_MS);
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { tenantId, type: "SALE", createdAt: { gte: since } },
    _sum: { quantityChange: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.productId, -(r._sum.quantityChange ?? 0) / env.insights.velocityWindowDays);
  return out;
}

async function computeLowStock(tenantId: string): Promise<LowStockItem[]> {
  const [levels, velocity, products] = await Promise.all([
    stockLevels(tenantId),
    salesVelocity(tenantId),
    Product.find({ storeId: tenantId }).select("title"),
  ]);
  const titles = new Map(products.map((p): [string, string] => [p._id.toString(), p.title]));

  const items: LowStockItem[] = [];
  for (const [productId, { quantity, threshold }] of levels) {
    const dailyVelocity = velocity.get(productId) ?? null;
    const daysOfSupply = dailyVelocity && dailyVelocity > 0 ? Math.round((quantity / dailyVelocity) * 10) / 10 : null;
    const belowThreshold = quantity <= threshold;
    const runningOutSoon = daysOfSupply !== null && daysOfSupply <= env.insights.forecastDaysThreshold;
    if (belowThreshold || runningOutSoon) {
      items.push({ productId, title: titles.get(productId) ?? "Deleted product", quantity, threshold, dailyVelocity, daysOfSupply });
    }
  }
  // Soonest to run out (or already lowest stock, for anything with no sales velocity to forecast from) first.
  items.sort((a, b) => (a.daysOfSupply ?? Infinity) - (b.daysOfSupply ?? Infinity) || a.quantity - b.quantity);
  return items.slice(0, 10);
}

async function computeFacts(tenantId: string): Promise<Facts> {
  const now = new Date();
  const [thisWeek, lastWeek, lowStock] = await Promise.all([
    analyticsService.summary(tenantId, { from: new Date(now.getTime() - 7 * DAY_MS), to: now, tzOffsetMinutes: 0 }),
    analyticsService.summary(tenantId, { from: new Date(now.getTime() - 14 * DAY_MS), to: new Date(now.getTime() - 7 * DAY_MS), tzOffsetMinutes: 0 }),
    computeLowStock(tenantId),
  ]);

  const changePercent = lastWeek.totals.netSales > 0 ? Math.round(((thisWeek.totals.netSales - lastWeek.totals.netSales) / lastWeek.totals.netSales) * 1000) / 10 : null;

  return {
    currency: thisWeek.currency,
    salesTrend: { thisWeek: thisWeek.totals.netSales, lastWeek: lastWeek.totals.netSales, changePercent },
    bestSellers: thisWeek.topProducts.slice(0, 5).map((p: { title: string; unitsSold: number; revenue: number }) => ({ title: p.title, unitsSold: p.unitsSold, revenue: p.revenue })),
    lowStock,
  };
}

const SYSTEM_PROMPT =
  "You write a short business insights summary for a small store's owner, from the facts given: 3 to 5 short " +
  "sentences, plain prose, no markdown, no headings. Cover the sales trend, name the top seller(s), and call out " +
  "any product running low or forecast to run out soon, with roughly how many days of supply are left when given. " +
  "Never state a number that is not in the facts, and never invent a product not listed.";

function factsToPrompt(facts: Facts): string {
  const trend =
    facts.salesTrend.changePercent === null
      ? `This week's net sales: ${facts.currency} ${facts.salesTrend.thisWeek} (no comparable sales last week).`
      : `This week's net sales: ${facts.currency} ${facts.salesTrend.thisWeek}, vs ${facts.currency} ${facts.salesTrend.lastWeek} last week (${facts.salesTrend.changePercent > 0 ? "+" : ""}${facts.salesTrend.changePercent}%).`;
  const sellers = facts.bestSellers.length > 0 ? facts.bestSellers.map((p) => `${p.title} (${p.unitsSold} units, ${facts.currency} ${p.revenue})`).join(", ") : "none this week";
  const stock =
    facts.lowStock.length > 0
      ? facts.lowStock.map((i) => `${i.title}: ${i.quantity} left${i.daysOfSupply !== null ? `, about ${i.daysOfSupply} days of supply left` : ""}`).join("; ")
      : "nothing is low right now";
  return `Sales trend: ${trend}\nBest sellers this week: ${sellers}\nLow stock / running out soon: ${stock}`;
}

function present(row: { text: string; model: string; generatedAt: Date; facts: unknown }) {
  return { text: row.text, model: row.model, generatedAt: row.generatedAt, facts: row.facts as Facts };
}

export const insightsService = {
  /** The cached write-up (or null if never generated) and whether it is old enough to offer
   *  regenerating. Free: never calls the AI or recomputes the underlying facts. */
  async get(tenantId: string) {
    const row = await prisma.aiBusinessInsight.findFirst({ where: { tenantId } });
    return {
      insight: row ? present(row) : null,
      stale: row ? Date.now() - row.generatedAt.getTime() >= env.insights.staleAfterHours * 60 * 60 * 1000 : false,
    };
  },

  /** Recomputes the facts, asks the orchestrator to write them up, and replaces the cached row. */
  async generate(tenantId: string) {
    const facts = await computeFacts(tenantId);
    const result = await aiGenerate({
      tenantId,
      promptType: "business_insights",
      system: SYSTEM_PROMPT,
      prompt: factsToPrompt(facts),
      maxTokens: 350,
    });

    const now = new Date();
    const data = { text: result.text, model: result.model, facts: facts as object, generatedAt: now };
    const existing = await prisma.aiBusinessInsight.findFirst({ where: { tenantId } });
    const row = existing
      ? await prisma.aiBusinessInsight.updateMany({ where: { tenantId }, data }).then(() => ({ ...existing, ...data }))
      : await prisma.aiBusinessInsight.create({ data: { tenantId, ...data } });
    return present(row);
  },
};
