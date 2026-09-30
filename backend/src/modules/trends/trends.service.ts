import { Prisma } from "@prisma/client";
import { Types } from "mongoose";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { Product } from "../../models/Product.model";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { weekStartOf } from "../advisor/advisor.service";
import { aggregate, displayCategory, normaliseCategory, DEFAULT_OPTIONS, type AggregateOptions, type CategoryTrend, type SalesRow } from "./trends.aggregate";
import { buildFacts, buildPrompt, checkLines, reportWeek, templateLines, SYSTEM_PROMPT, type Fact, type ReportLine } from "./trends.report";
import { getTrendSources } from "./trends.sources";
import { parseGoogleTrendsCsv, TrendsFileError } from "./trends.csv";

/**
 * The Trend Scout (Part D). Once a week, for every market (store currency) and category, it adds up
 * what all stores sold, keeps only the figures that cannot point to one store (trends.aggregate.ts),
 * adds what the external sources say (trends.sources.ts), and writes one short report that every
 * store in that category shares. The AI only rewords numbered facts and every line is checked
 * against them (trends.report.ts). The platform pays for it; no store's allowance is touched.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A store sees the reports for its biggest categories, this many at most. */
const CATEGORIES_PER_STORE = 3;
/** Reports older than this are not shown (the weekly job has stopped, or the category went quiet). */
const SHOW_WEEKS = 5;

export function options(): AggregateOptions {
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    minStores: Math.max(2, Math.floor(num(process.env.TREND_MIN_STORES, DEFAULT_OPTIONS.minStores))),
    maxShare: Math.min(0.95, Math.max(0.3, num(process.env.TREND_MAX_STORE_SHARE, DEFAULT_OPTIONS.maxShare))),
    baselineWeeks: DEFAULT_OPTIONS.baselineWeeks,
  };
}

/**
 * Every store's sales for the week before `weekStart` ("current") and the weeks before that
 * ("baseline"), per store and product, with the product's category from the catalog. Paid orders only,
 * less what came back. `onlyTenantIds` limits it to some stores (tests use it, so real stores' sales
 * never mix into a test).
 */
async function salesRows(weekStart: string, opts: AggregateOptions, onlyTenantIds?: string[]): Promise<SalesRow[]> {
  const monday = Date.parse(`${weekStart}T00:00:00Z`);
  const end = new Date(monday).toISOString();
  const currentFrom = new Date(monday - 7 * DAY_MS).toISOString();
  const from = new Date(monday - 7 * (1 + opts.baselineWeeks) * DAY_MS).toISOString();
  const only = onlyTenantIds ? Prisma.sql`AND o."tenantId" = ANY(${onlyTenantIds}::text[])` : Prisma.empty;

  // Across every store on purpose, so the unscoped client, and only totals per store and product leave the query.
  const rows = await prismaUnscoped.$queryRaw<{ tenant_id: string; market: string; product_id: string; title: string; period: "current" | "baseline"; units: number }[]>`
    SELECT o."tenantId" AS tenant_id,
           upper(o."currency") AS market,
           oi."productId" AS product_id,
           (array_agg(oi."productTitleSnapshot" ORDER BY o."createdAt" DESC))[1] AS title,
           CASE WHEN o."createdAt" >= ${currentFrom}::timestamp THEN 'current' ELSE 'baseline' END AS period,
           sum(oi."quantity" - oi."returnedQuantity")::int AS units
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE o."createdAt" >= ${from}::timestamp AND o."createdAt" < ${end}::timestamp
      AND o."status" NOT IN ('CANCELLED', 'REFUNDED')
      AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))
      ${only}
    GROUP BY 1, 2, 3, 5`;

  // Categories live in the catalog (MongoDB): one lookup per store. A product since deleted has no
  // category any more, so its sales cannot be placed and are left out.
  const byTenant = new Map<string, string[]>();
  for (const r of rows) if (Types.ObjectId.isValid(r.product_id)) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r.product_id]);
  const categoryOf = new Map<string, string>();
  for (const [tenantId, ids] of byTenant) {
    const docs = await Product.find({ storeId: tenantId, _id: { $in: [...new Set(ids)] } }).select("category");
    for (const d of docs) categoryOf.set(`${tenantId}:${d._id.toString()}`, normaliseCategory(d.category));
  }

  return rows.flatMap((r) => {
    const category = categoryOf.get(`${r.tenant_id}:${r.product_id}`);
    return category ? [{ tenantId: r.tenant_id, market: r.market, category, title: r.title, period: r.period, units: r.units }] : [];
  });
}

/** The market and category pairs that have a recent external import, so a report can come from those alone. */
async function importedPairs(weekStart: string, markets?: string[]): Promise<{ market: string; category: string }[]> {
  const since = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 60 * DAY_MS);
  const rows = await prismaUnscoped.trendSignalImport.findMany({
    where: { createdAt: { gte: since }, ...(markets ? { market: { in: markets } } : {}) },
    select: { market: true, category: true },
    distinct: ["market", "category"],
  });
  return rows;
}

async function externalFacts(market: string, category: string, weekStart: string) {
  const all = await Promise.all(
    getTrendSources().map((s) =>
      s.factsFor(market, category, weekStart).catch((err: Error) => {
        // One source failing never stops the report; its facts are simply missing this week.
        console.error(`[trends] source ${s.id} failed for ${market}/${category}: ${err.message}`);
        return [];
      })
    )
  );
  return all.flat();
}

async function writeLines(market: string, category: string, facts: Fact[]) {
  const prompt = buildPrompt(market, category, facts);
  try {
    const result = await aiGenerate({ tenantId: "platform", promptType: "trend_report", system: SYSTEM_PROMPT, prompt, maxTokens: 400, billedTo: "platform" });
    const lines = checkLines(result.text, facts);
    const usage = { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    // An answer that fails a check is not shown at all: the report is written from the facts instead.
    return lines ? { lines, source: "ai" as const, ...usage } : { lines: templateLines(facts), source: "template" as const, ...usage };
  } catch {
    return { lines: templateLines(facts), source: "template" as const, model: null, inputTokens: 0, outputTokens: 0 };
  }
}

type ReportRow = Prisma.TrendReportGetPayload<object>;

/** A report as a merchant sees it: no store count, and for a withheld category no figures at all. */
function present(r: ReportRow) {
  const [from, to] = reportWeek(r.weekStart);
  const facts = r.facts as unknown as Fact[];
  return {
    id: r.id,
    market: r.market,
    category: r.category,
    name: displayCategory(r.category),
    weekStart: r.weekStart,
    covers: { from, to },
    status: r.status as "published" | "no_data" | "suppressed",
    source: r.source,
    lines: r.lines as unknown as ReportLine[],
    facts: facts.map((f) => ({ id: f.id, kind: f.kind, text: f.text, source: f.source, date: f.date, ...(f.url ? { url: f.url } : {}) })),
    createdAt: r.createdAt,
  };
}

export const trendsService = {
  /**
   * The weekly run: one report per market and category for the week before `now`'s Monday. A report
   * that already exists for the week is kept (one per category per week, shared by every store).
   * `only` limits which stores' sales are read and which markets are reported on (tests use it).
   */
  async runWeek(now = new Date(), only?: { tenantIds?: string[]; markets?: string[]; categories?: string[] }) {
    const opts = options();
    const weekStart = weekStartOf(now);
    const wanted = (p: { market: string; category: string }) => (!only?.markets || only.markets.includes(p.market)) && (!only?.categories || only.categories.includes(p.category));
    const trends = aggregate(await salesRows(weekStart, opts, only?.tenantIds), opts).filter(wanted);

    const pairs = new Map<string, { market: string; category: string; trend: CategoryTrend | null }>();
    for (const t of trends) pairs.set(`${t.market}\u0000${t.category}`, { market: t.market, category: t.category, trend: t });
    for (const p of await importedPairs(weekStart, only?.markets)) {
      if (!wanted(p)) continue;
      const key = `${p.market}\u0000${p.category}`;
      if (!pairs.has(key)) pairs.set(key, { ...p, trend: null });
    }

    const outcome = { weekStart, reports: pairs.size, published: 0, suppressed: 0, noData: 0, existing: 0, failed: 0 };
    for (const { market, category, trend } of pairs.values()) {
      try {
        const existing = await prismaUnscoped.trendReport.findUnique({ where: { market_category_weekStart: { market, category, weekStart } } });
        if (existing) {
          outcome.existing++;
          continue;
        }
        const facts = buildFacts(trend, await externalFacts(market, category, weekStart), weekStart, opts);
        const status = facts.length > 0 ? "published" : trend && !trend.publishable ? "suppressed" : "no_data";
        // No facts, no AI call: there is nothing true to say, so nothing is written.
        const written = status === "published" ? await writeLines(market, category, facts) : { lines: [], source: "none" as const, model: null, inputTokens: 0, outputTokens: 0 };
        await prismaUnscoped.trendReport.create({
          data: {
            market,
            category,
            weekStart,
            status,
            facts: facts as unknown as Prisma.InputJsonValue,
            lines: written.lines as unknown as Prisma.InputJsonValue,
            source: written.source,
            model: written.model,
            inputTokens: written.inputTokens,
            outputTokens: written.outputTokens,
            storeCount: trend?.storeCount ?? 0,
          },
        });
        if (status === "published") outcome.published++;
        else if (status === "suppressed") outcome.suppressed++;
        else outcome.noData++;
      } catch (err) {
        // Two runs at once: the unique key keeps exactly one report.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") outcome.existing++;
        else {
          outcome.failed++;
          console.error(`[trends] ${market}/${category}: ${(err as Error).message}`);
        }
      }
    }
    return outcome;
  },

  /** The dashboard card: the store's market and its biggest categories, each with its latest report (or null). */
  async forStore(tenantId: string, now = new Date()) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
    if (!tenant) throw Errors.notFound("Store");
    const market = tenant.currency.toUpperCase();

    const grouped = await Product.aggregate<{ _id: string; n: number }>([{ $match: { storeId: tenantId } }, { $group: { _id: "$category", n: { $sum: 1 } } }]);
    const counts = new Map<string, number>();
    for (const g of grouped) counts.set(normaliseCategory(g._id), (counts.get(normaliseCategory(g._id)) ?? 0) + g.n);
    const categories = [...counts.entries()]
      .filter(([c]) => c !== "uncategorised")
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, CATEGORIES_PER_STORE)
      .map(([c]) => c);

    const newest = weekStartOf(now);
    const oldest = weekStartOf(new Date(now.getTime() - SHOW_WEEKS * 7 * DAY_MS));
    const reports = categories.length
      ? await prismaUnscoped.trendReport.findMany({
          where: { market, category: { in: categories }, weekStart: { gte: oldest, lte: newest } },
          orderBy: { weekStart: "desc" },
        })
      : [];
    return {
      market,
      categories: categories.map((category) => {
        const r = reports.find((x) => x.category === category);
        return { category, name: displayCategory(category), report: r ? present(r) : null };
      }),
    };
  },

  /** Imports a Google Trends CSV for a market and category (platform administrators only). */
  async importGoogleTrends(input: { csv: string; market: string; category: string; fileName?: string }, userId: string) {
    let parsed;
    try {
      parsed = parseGoogleTrendsCsv(input.csv);
    } catch (err) {
      if (err instanceof TrendsFileError) throw Errors.validation(err.message);
      throw err;
    }
    const row = await prismaUnscoped.trendSignalImport.create({
      data: {
        source: "google_trends_csv",
        market: input.market.toUpperCase(),
        category: normaliseCategory(input.category),
        geo: parsed.geo ?? "region not named in the file",
        series: parsed.series as unknown as Prisma.InputJsonValue,
        periodEnd: parsed.periodEnd,
        fileName: input.fileName ?? null,
        importedById: userId,
      },
    });
    return presentImport(row);
  },

  async listImports(limit = 20) {
    const rows = await prismaUnscoped.trendSignalImport.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(presentImport);
  },

  /** The platform's view of the latest week's reports, every market and category. */
  async listReports(now = new Date()) {
    const latest = await prismaUnscoped.trendReport.findFirst({ where: { weekStart: { lte: weekStartOf(now) } }, orderBy: { weekStart: "desc" }, select: { weekStart: true } });
    if (!latest) return { weekStart: null, reports: [] };
    const rows = await prismaUnscoped.trendReport.findMany({ where: { weekStart: latest.weekStart }, orderBy: [{ market: "asc" }, { category: "asc" }] });
    return { weekStart: latest.weekStart, reports: rows.map((r) => ({ ...present(r), storeCount: r.storeCount })) };
  },
};

function presentImport(r: Prisma.TrendSignalImportGetPayload<object>) {
  const series = r.series as unknown as { term: string; points: unknown[] }[];
  return {
    id: r.id,
    source: r.source,
    market: r.market,
    category: r.category,
    geo: r.geo,
    terms: series.map((s) => s.term),
    points: series[0]?.points.length ?? 0,
    periodEnd: r.periodEnd,
    fileName: r.fileName,
    createdAt: r.createdAt,
  };
}
