import { Prisma } from "@prisma/client";
import { Types } from "mongoose";
import { prismaUnscoped } from "../../lib/prisma";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";
import { logger } from "../../lib/logger";
import { isDemoSlug, sqlIsDemo, sqlNotDemo } from "../../lib/demo";
import { Product } from "../../models/Product.model";
import { Category } from "../../models/Category.model";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { checkLines, type Fact } from "../trends/trends.report";
import { displayCategory, normaliseCategory } from "../trends/trends.aggregate";
import { computeTrends, type MarketTrends, type ProductTypeFigures, type ScoutOptions } from "./scout.aggregate";

/**
 * Product Scout (2026-10-22): what is selling across ZYRO, for owners deciding what to stock.
 *
 * Once a day, for each scope ("live": real stores; "demo": the demo stores only), market and period
 * (7 and 30 days), it adds up paid orders across stores (scout.aggregate.ts keeps only figures that
 * cannot point to one store), has the AI write a "why it's trending" line for each product type from
 * those figures only (each line is checked: every number must be in the figures it cites), and a short
 * starter description an owner can adapt. All of it is saved as one snapshot row. The platform pays
 * for the AI; no store's allowance is touched. A store's page only reads the saved snapshot: no heavy
 * query and no AI call happen when an owner opens it.
 */

export type Scope = "live" | "demo";
export const PERIODS = [7, 30] as const;
export type PeriodDays = (typeof PERIODS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Product types given a starter description each day, per market and period. */
const STARTERS = 12;
/** Market-data reports older than this are not offered as a fallback. */
const MARKET_DATA_MAX_AGE_DAYS = 42;

export const scoutOptions = (): ScoutOptions => ({ minStores: env.scout.minStores, maxShare: env.scout.maxShare, minGrowthUnits: 5 });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The current and previous periods of `days` ending (exclusive) at `windowEnd`. */
export function windows(windowEnd: Date, days: number) {
  const end = windowEnd.getTime();
  return {
    current: { from: new Date(end - days * DAY_MS), to: new Date(end) },
    previous: { from: new Date(end - 2 * days * DAY_MS), to: new Date(end - days * DAY_MS) },
  };
}

/**
 * Every store's order lines in both periods, one per store, order and product, with the product's
 * category from the catalog. Orders that are paid, being fulfilled or completed count; pending,
 * cancelled and refunded ones never do, and returned units are taken off. `scope` keeps the demo
 * stores apart; `onlyTenantIds` limits it to some stores (tests use it, so other stores' sales never
 * mix in).
 */
async function salesRows(scope: Scope, windowEnd: Date, days: number, onlyTenantIds?: string[]) {
  const w = windows(windowEnd, days);
  const only = onlyTenantIds ? Prisma.sql`AND o."tenantId" = ANY(${onlyTenantIds}::text[])` : Prisma.empty;
  // Across every store on purpose, so the unscoped client; only store, order and product totals leave the query.
  // For the 30-day period, which week of it each line falls in (scout.aggregate.ts checks what subtraction would show).
  const recentFrom = new Date(windowEnd.getTime() - 7 * DAY_MS);
  const priorFrom = new Date(windowEnd.getTime() - 14 * DAY_MS);
  const rows = await prismaUnscoped.$queryRaw<{ tenant_id: string; market: string; order_id: string; product_id: string; title: string; period: "current" | "previous"; segment: "recent" | "prior" | "older"; units: number }[]>`
    SELECT o."tenantId" AS tenant_id,
           upper(o."currency") AS market,
           o."id" AS order_id,
           oi."productId" AS product_id,
           min(oi."productTitleSnapshot") AS title,
           CASE WHEN o."createdAt" >= ${w.current.from} THEN 'current' ELSE 'previous' END AS period,
           CASE WHEN o."createdAt" >= ${recentFrom} THEN 'recent' WHEN o."createdAt" >= ${priorFrom} THEN 'prior' ELSE 'older' END AS segment,
           sum(oi."quantity" - oi."returnedQuantity")::int AS units
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    JOIN "Tenant" t ON t."id" = o."tenantId"
    WHERE o."createdAt" >= ${w.previous.from} AND o."createdAt" < ${w.current.to}
      AND o."status" IN ('PAID', 'FULFILLED', 'COMPLETED')
      AND ${scope === "demo" ? sqlIsDemo("t") : sqlNotDemo("t")}
      ${only}
    GROUP BY 1, 2, 3, 4, 6, 7`;

  // Categories live in the catalog (MongoDB): one lookup per store. A deleted product cannot be placed.
  const byTenant = new Map<string, Set<string>>();
  for (const r of rows) if (Types.ObjectId.isValid(r.product_id)) byTenant.set(r.tenant_id, (byTenant.get(r.tenant_id) ?? new Set()).add(r.product_id));
  const categoryOf = new Map<string, string>();
  for (const [tenantId, ids] of byTenant) {
    const docs = await Product.find({ storeId: tenantId, _id: { $in: [...ids] } }).select("category").lean();
    for (const d of docs) categoryOf.set(`${tenantId}:${d._id.toString()}`, d.category);
  }
  return rows.flatMap((r) => {
    const category = categoryOf.get(`${r.tenant_id}:${r.product_id}`);
    if (!category) return [];
    const segment = days === 30 && r.period === "current" ? r.segment : undefined;
    return [{ tenantId: r.tenant_id, market: r.market, orderId: r.order_id, category, title: r.title, period: r.period, units: r.units, ...(segment ? { segment } : {}) }];
  });
}

// ---------------------------------------------------------------------------------------------
// The AI layer: words around figures it is given, never figures of its own
// ---------------------------------------------------------------------------------------------

const PLATFORM_SOURCE = "ZYRO sales across stores (anonymised)";

/** The one fact about a product type: every figure an explanation may use. */
export function productFact(p: ProductTypeFigures, days: number, windowTo: Date): string {
  const to = shortDate(new Date(windowTo.getTime() - DAY_MS));
  const base = `${p.name} (${p.categoryName.toLowerCase()}) sold ${p.units} units in ${p.orders} orders across ${p.stores} stores in the ${days} days to ${to}`;
  if (p.growthPercent !== null) {
    const move = p.growthPercent === 0 ? "the same as" : `${p.growthPercent > 0 ? "up" : "down"} ${Math.abs(p.growthPercent)}% on`;
    return `${base}, ${move} the ${days} days before (${p.previousUnits} units).`;
  }
  return p.isNew ? `${base}; none sold in the ${days} days before.` : `${base}.`;
}

const EXPLAIN_SYSTEM =
  "You explain to small shop owners, in plain English, why products are selling well across many shops. " +
  "Use ONLY the numbered facts you are given. Write exactly one line per fact, in the same order. Each line is one " +
  "short sentence (under 30 words) and ends with the id of its fact in square brackets, for example [F1]. Every " +
  "number you write must appear in that fact. Do not add causes, seasons, predictions, prices or any number that " +
  "is not in the fact. No markdown, no greeting.";

/** A "why it's trending" line per product type, checked against its own fact; a failed line becomes the fact itself. */
async function explain(products: ProductTypeFigures[], days: number, windowTo: Date): Promise<Map<string, { text: string; source: "ai" | "template" }>> {
  const facts: Fact[] = products.map((p, i) => ({ id: `F${i + 1}`, kind: "platform", text: productFact(p, days, windowTo), source: PLATFORM_SOURCE, date: isoDay(windowTo) }));
  const out = new Map<string, { text: string; source: "ai" | "template" }>();
  products.forEach((p, i) => out.set(p.id, { text: facts[i].text, source: "template" }));
  if (products.length === 0) return out;
  try {
    const result = await aiGenerate({
      tenantId: "platform",
      promptType: "scout_explain",
      system: EXPLAIN_SYSTEM,
      prompt: facts.map((f) => `${f.id}: ${f.text}`).join("\n"),
      maxTokens: 60 * products.length + 100,
      billedTo: "platform",
    });
    for (const line of result.text.split(/\r?\n/).filter((l) => l.trim())) {
      const checked = checkLines(line, facts);
      if (!checked || checked.length !== 1 || checked[0].cites.length !== 1) continue;
      const index = Number(checked[0].cites[0].slice(1)) - 1;
      if (products[index]) out.set(products[index].id, { text: checked[0].text, source: "ai" });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[scout] explanations fell back to the plain figures");
  }
  return out;
}

const STARTER_SYSTEM =
  "You write starter product descriptions that a small shop owner will edit before publishing. For each numbered " +
  "product, write two short sentences describing that kind of product in general. No numbers, prices, sizes, brand " +
  "names, materials or claims you cannot know; no markdown. Reply with one line per product: its id, a colon, the " +
  "description. For example: P1: A practical ...";

export const templateStarter = (name: string, categoryName: string) =>
  `A popular ${name.toLowerCase()} for your ${categoryName.toLowerCase()} range. Add your own details: what it is made of, its size, and what makes yours special.`;

/** A starter description per product type; anything with a number, too short or too long, becomes the template. */
async function starters(products: ProductTypeFigures[]): Promise<Map<string, { text: string; source: "ai" | "template" }>> {
  const out = new Map(products.map((p) => [p.id, { text: templateStarter(p.name, p.categoryName), source: "template" as "ai" | "template" }]));
  if (products.length === 0) return out;
  try {
    const result = await aiGenerate({
      tenantId: "platform",
      promptType: "scout_starter",
      system: STARTER_SYSTEM,
      prompt: products.map((p, i) => `P${i + 1}: ${p.name} (category: ${p.categoryName})`).join("\n"),
      maxTokens: 90 * products.length + 100,
      billedTo: "platform",
    });
    for (const line of result.text.split(/\r?\n/)) {
      const m = /^\s*P(\d+)\s*:\s*(.+)$/.exec(line);
      if (!m) continue;
      const p = products[Number(m[1]) - 1];
      const text = m[2].trim();
      if (p && !/\d/.test(text) && text.length >= 30 && text.length <= 400) out.set(p.id, { text, source: "ai" });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[scout] starter descriptions fell back to the template");
  }
  return out;
}

/** The newest external Trend Scout report per category in a market, as "market data" for categories the platform cannot speak for. */
async function marketData(market: string, now: Date) {
  const since = new Date(now.getTime() - MARKET_DATA_MAX_AGE_DAYS * DAY_MS);
  const reports = await prismaUnscoped.trendReport.findMany({
    where: { market, status: "published", createdAt: { gte: since } },
    orderBy: { weekStart: "desc" },
    select: { category: true, weekStart: true, lines: true, facts: true },
  });
  const latest = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latest.has(r.category)) latest.set(r.category, r);
  return [...latest.values()].flatMap((r) => {
    // Only the lines built from external sources: the platform's own figures there follow Trend Scout's rules, not these.
    const facts = r.facts as unknown as Fact[];
    const external = new Set(facts.filter((f) => f.kind === "external").map((f) => f.id));
    const lines = (r.lines as unknown as { text: string; cites: string[] }[]).filter((l) => l.cites.length > 0 && l.cites.every((c) => external.has(c)));
    const sources = [...new Set(facts.filter((f) => external.has(f.id)).map((f) => f.source))];
    return lines.length ? [{ category: r.category, name: displayCategory(r.category), weekStart: r.weekStart, lines: lines.map((l) => l.text), sources }] : [];
  });
}

/** What one snapshot row holds (ProductScoutSnapshot.data). */
export interface SnapshotData {
  market: string;
  periodDays: PeriodDays;
  window: { from: string; to: string };
  rules: { minStores: number; maxSharePercent: number };
  categories: MarketTrends["categories"];
  products: (ProductTypeFigures & { why: string; whySource: "ai" | "template"; starter: string; starterSource: "ai" | "template" })[];
  topSellers: string[];
  fastestGrowing: string[];
  rising: MarketTrends["rising"];
  marketData: Awaited<ReturnType<typeof marketData>>;
}

export const scoutService = {
  /**
   * The daily run: every scope, market and period, saved one row each. A market with no sales any
   * more has its old row removed, so nothing stale is shown. Returns what it did, for the log.
   */
  async refresh(opts: { scopes?: Scope[]; now?: Date; onlyTenantIds?: string[] } = {}) {
    const now = opts.now ?? new Date();
    const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // up to the end of yesterday
    const done: string[] = [];
    for (const scope of opts.scopes ?? (["live", "demo"] as Scope[])) {
      for (const days of PERIODS) {
        const rows = await salesRows(scope, windowEnd, days, opts.onlyTenantIds);
        const markets = computeTrends(rows, scoutOptions());
        const w = windows(windowEnd, days);
        for (const m of markets) {
          const featured = new Set([...m.topSellers, ...m.fastestGrowing, ...m.rising.flatMap((r) => r.products)]);
          const shown = m.products.filter((p) => featured.has(p.id));
          const [whys, starts, external] = await Promise.all([
            explain(shown, days, w.current.to),
            starters(shown.slice(0, STARTERS)),
            marketData(m.market, now),
          ]);
          const publishable = new Set([...m.categories.map((c) => c.key), ...m.products.map((p) => p.category)]);
          const data: SnapshotData = {
            market: m.market,
            periodDays: days,
            window: { from: isoDay(w.current.from), to: isoDay(new Date(w.current.to.getTime() - DAY_MS)) },
            rules: { minStores: env.scout.minStores, maxSharePercent: Math.round(env.scout.maxShare * 100) },
            categories: m.categories,
            products: shown.map((p) => {
              const why = whys.get(p.id)!;
              const starter = starts.get(p.id) ?? { text: templateStarter(p.name, p.categoryName), source: "template" as const };
              return { ...p, why: why.text, whySource: why.source, starter: starter.text, starterSource: starter.source };
            }),
            topSellers: m.topSellers.filter((id) => featured.has(id)),
            fastestGrowing: m.fastestGrowing,
            rising: m.rising,
            marketData: external.filter((e) => !publishable.has(e.category)),
          };
          await prismaUnscoped.productScoutSnapshot.upsert({
            where: { scope_market_periodDays: { scope, market: m.market, periodDays: days } },
            create: { scope, market: m.market, periodDays: days, windowEnd, data: data as unknown as Prisma.InputJsonValue },
            update: { windowEnd, data: data as unknown as Prisma.InputJsonValue, computedAt: new Date() },
          });
          done.push(`${scope}/${m.market}/${days}d`);
        }
        if (!opts.onlyTenantIds) {
          await prismaUnscoped.productScoutSnapshot.deleteMany({ where: { scope, periodDays: days, market: { notIn: markets.map((m) => m.market) } } });
        }
      }
    }
    return { windowEnd: isoDay(windowEnd), snapshots: done };
  },

  /**
   * What a store's panel shows: the saved snapshot for the store's own market (demo stores see the
   * demo one), filtered by category, plus market data where the platform has too little, the
   * store's own categories with no data at all, and what onboarding needs. Reads only; never
   * computes trends and never calls the AI.
   */
  async forStore(storeId: string, query: { period: PeriodDays; category?: string }) {
    const tenant = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { currency: true, slug: true } });
    if (!tenant) throw Errors.notFound("Store");
    const scope: Scope = isDemoSlug(tenant.slug) ? "demo" : "live";
    const market = tenant.currency.toUpperCase();
    const [row, ownCategories, productCount] = await Promise.all([
      prismaUnscoped.productScoutSnapshot.findUnique({ where: { scope_market_periodDays: { scope, market, periodDays: query.period } } }),
      Category.find({ storeId, active: true }).select("name").lean(),
      Product.countDocuments({ storeId }),
    ]);
    const data = row?.data as unknown as SnapshotData | undefined;
    const wanted = query.category ? normaliseCategory(query.category) : undefined;
    const inCategory = (key: string) => !wanted || key === wanted;
    const byId = new Map((data?.products ?? []).map((p) => [p.id, p]));
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p && inCategory(p.category));
    // A category has ZYRO data when its total is shown or any product in it is (the total can be
    // withheld on its own, when subtracting the products shown would reveal too few stores).
    const publishable = new Set([...(data?.categories ?? []).map((c) => c.key), ...(data?.products ?? []).map((p) => p.category)]);
    const market_ = data?.marketData ?? (await marketData(market, new Date())); // a market with no snapshot yet still gets market data
    const own = ownCategories.map((c) => ({ key: normaliseCategory(c.name), name: c.name }));

    return {
      status: row ? ("ready" as const) : ("no_data" as const),
      demo: scope === "demo",
      market,
      periodDays: query.period,
      window: data?.window ?? null,
      generatedAt: row?.computedAt ?? null,
      rules: data?.rules ?? { minStores: env.scout.minStores, maxSharePercent: Math.round(env.scout.maxShare * 100) },
      categories: (data?.categories ?? []).filter((c) => inCategory(c.key)),
      topSellers: pick(data?.topSellers ?? []),
      fastestGrowing: pick(data?.fastestGrowing ?? []),
      rising: (data?.rising ?? []).filter((r) => inCategory(r.category)).map((r) => ({ category: r.category, name: displayCategory(r.category), products: pick(r.products) })),
      marketData: market_.filter((m) => inCategory(m.category) && !publishable.has(m.category)),
      notEnoughData: own.filter((c) => inCategory(c.key) && !publishable.has(c.key) && !market_.some((m) => m.category === c.key)).map((c) => c.name),
      store: { productCount, categories: ownCategories.map((c) => ({ id: c._id.toString(), name: c.name })) },
    };
  },
};
