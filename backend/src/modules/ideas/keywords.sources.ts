import { prismaUnscoped } from "../../lib/prisma";
import { getRedis } from "../../lib/redis";
import { normaliseCategory } from "../trends/trends.aggregate";
import type { TrendSeries } from "../trends/trends.csv";

/**
 * Where the trending keywords behind AI product suggestions come from (Issue 1).
 *
 * Three providers behind one small interface, so another can be added without touching the
 * suggestion code. Every one reports **real data or nothing**: a provider with too little to say
 * returns an empty list, and the AI is then told plainly that there is no trend data for this
 * category rather than being left to invent some.
 *
 * Privacy runs through all of it. Nothing here can name a shop, and the two cross-shop providers are
 * held to the same rule Part D applies to sales: a keyword is only reported once enough different
 * shops have used it, so one shop's catalogue or one shop's shoppers can never be read back out.
 */

export interface TrendingKeyword {
  word: string;
  /** Where it came from, shown to the merchant so they can judge it. */
  source: "best_sellers" | "google_trends" | "shopper_searches";
  /** Roughly how much interest, for ordering. Never shown as a number: the units differ per source. */
  weight: number;
}

export interface KeywordSource {
  id: string;
  /** Keywords for a market and category, or an empty list when there is not enough real data. */
  keywordsFor(market: string, category: string): Promise<TrendingKeyword[]>;
}

/** A keyword must come from at least this many different shops before it is reported to anyone. */
const MIN_SHOPS = 5;
/** How far back shopper searches are counted. */
const SEARCH_DAYS = 30;
/** How long the blended list is kept. Refreshed daily, as asked. */
const CACHE_SECONDS = 24 * 60 * 60;
/** At most this many keywords reach the AI; more is noise and encourages stuffing. */
const MAX_KEYWORDS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayString = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What sells: the keywords Part D already computes from titles of products selling across shops,
 * with its privacy rules (at least 5 shops, no shop over 60% of a keyword) applied before they were
 * ever stored. Read from the latest published report, so this costs one indexed query.
 */
export const bestSellerSource: KeywordSource = {
  id: "best_sellers",
  async keywordsFor(market, category) {
    const report = await prismaUnscoped.trendReport.findFirst({
      where: { market, category, status: "published" },
      orderBy: { weekStart: "desc" },
      select: { facts: true },
    });
    if (!report) return [];

    const facts = (report.facts as unknown as { kind: string; text: string }[]) ?? [];
    const words: TrendingKeyword[] = [];
    for (const fact of facts) {
      if (fact.kind !== "platform") continue;
      // The platform facts quote their keywords: 'Products with "chai", "clay" or "cup" in the title'.
      for (const m of fact.text.matchAll(/"([^"]{2,30})"/g)) {
        words.push({ word: m[1].toLowerCase(), source: "best_sellers", weight: 3 });
      }
    }
    return words;
  },
};

/** What people search for on Google, from the files a platform administrator imported (Part D). */
export const googleTrendsSource: KeywordSource = {
  id: "google_trends",
  async keywordsFor(market, category) {
    const latest = await prismaUnscoped.trendSignalImport.findFirst({
      where: { source: "google_trends_csv", market, category },
      orderBy: { createdAt: "desc" },
      select: { series: true },
    });
    if (!latest) return [];

    const series = (latest.series as unknown as TrendSeries[]) ?? [];
    return series.flatMap((s) => {
      // The last few readings say how much interest there is now, which is what orders the list.
      const recent = s.points.slice(-4);
      const average = recent.length > 0 ? recent.reduce((sum, p) => sum + p.value, 0) / recent.length : 0;
      return average > 0 ? [{ word: s.term.toLowerCase(), source: "google_trends" as const, weight: average / 25 }] : [];
    });
  },
};

/**
 * What shoppers actually type into shop search boxes. The newest source and the slowest to become
 * useful: it says nothing until real shoppers have searched, across at least five different shops.
 * Until then it returns nothing, which is the honest answer.
 */
export const shopperSearchSource: KeywordSource = {
  id: "shopper_searches",
  async keywordsFor(market, category) {
    const since = dayString(new Date(Date.now() - SEARCH_DAYS * DAY_MS));
    // Grouped by term AND shop, because the rule below is about how many different shops saw a word.
    // Grouping by term alone would count rows, and a row is one shop on one day: a single shop
    // searching "lawn suit" on five days would look like five shops and leak its own searches back.
    const rows = await prismaUnscoped.searchTermDaily.groupBy({
      by: ["term", "tenantId"],
      where: { day: { gte: since }, OR: [{ category }, { category: "all" }] },
      _sum: { count: true },
    });

    const perTerm = new Map<string, { shops: Set<string>; total: number }>();
    for (const row of rows) {
      const entry = perTerm.get(row.term) ?? { shops: new Set<string>(), total: 0 };
      entry.shops.add(row.tenantId);
      entry.total += row._sum.count ?? 0;
      perTerm.set(row.term, entry);
    }

    return [...perTerm.entries()]
      // The rule that makes this safe to share: a word is only reported once enough DIFFERENT shops
      // have seen it, so no one shop's shoppers can be read back out of the blended list.
      .filter(([, e]) => e.shops.size >= MIN_SHOPS)
      .map(([word, e]) => ({ word, source: "shopper_searches" as const, weight: Math.min(4, e.total / 25) }));
  },
};

let sources: KeywordSource[] = [bestSellerSource, googleTrendsSource, shopperSearchSource];

export const getKeywordSources = (): KeywordSource[] => sources;

/** Tests swap the providers; `undefined` restores the shipped three. */
export function setKeywordSources(next: KeywordSource[] | undefined): void {
  sources = next ?? [bestSellerSource, googleTrendsSource, shopperSearchSource];
}

export interface KeywordSet {
  keywords: TrendingKeyword[];
  /** Which providers actually had something, for the merchant and for the documents. */
  sourcesUsed: string[];
  /** True when no provider had anything: the suggestions then come from the merchant's own details. */
  empty: boolean;
}

const cacheKey = (market: string, category: string) => `ideas:keywords:${market}:${category}`;

/**
 * The blended list for a market and category. Every provider is asked, a failing one is skipped
 * rather than failing the whole thing, and the result is cached for a day as asked.
 *
 * A word that more than one provider knows is worth more than a word only one knows, so weights are
 * added rather than replaced: something people both search for and buy rises to the top.
 */
export async function trendingKeywords(market: string, category: string): Promise<KeywordSet> {
  const key = cacheKey(market, normaliseCategory(category));
  try {
    const cached = await getRedis().get(key);
    if (cached) return JSON.parse(cached) as KeywordSet;
  } catch {
    // Redis down: work it out now rather than fail. Slower, not broken.
  }

  const normalisedCategory = normaliseCategory(category);
  const gathered = await Promise.all(
    getKeywordSources().map((s) =>
      s.keywordsFor(market, normalisedCategory).catch((err: Error) => {
        console.error(`[ideas] keyword source ${s.id} failed: ${err.message}`);
        return [] as TrendingKeyword[];
      })
    )
  );

  const byWord = new Map<string, TrendingKeyword>();
  const sourcesUsed = new Set<string>();
  for (const list of gathered) {
    for (const k of list) {
      const word = k.word.trim().toLowerCase();
      if (word.length < 3) continue;
      sourcesUsed.add(k.source);
      const existing = byWord.get(word);
      if (existing) existing.weight += k.weight;
      else byWord.set(word, { ...k, word });
    }
  }

  const keywords = [...byWord.values()].sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word)).slice(0, MAX_KEYWORDS);
  const result: KeywordSet = { keywords, sourcesUsed: [...sourcesUsed].sort(), empty: keywords.length === 0 };

  try {
    await getRedis().set(key, JSON.stringify(result), "EX", CACHE_SECONDS);
  } catch {
    // Not caching it is not a reason to fail.
  }
  return result;
}

/** Drops the cached list, so a test or an administrator can see a change straight away. */
export async function forgetKeywords(market: string, category: string): Promise<void> {
  try {
    await getRedis().del(cacheKey(market, normaliseCategory(category)));
  } catch {
    // It expires on its own.
  }
}
