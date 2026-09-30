import { prismaUnscoped } from "../../lib/prisma";
import { seriesChange, type TrendSeries } from "./trends.csv";

/**
 * External trend sources for the Trend Scout (Part D), behind one small interface so a source can be
 * added, removed or replaced without touching the report code: the weekly run asks every registered
 * source for facts about a market and category, and each fact says where it came from and when.
 *
 * Registered today: imported Google Trends files. Google Trends has no self-serve API (the official one
 * is an invite-only alpha), and the plan rules out scraping, so a platform administrator downloads the
 * CSV from trends.google.com and imports it. If API access is granted later, an API source slots in here.
 */

export interface ExternalFact {
  text: string;
  /** Who the figure comes from, as the merchant will read it. */
  source: string;
  /** The last date the figure covers, "YYYY-MM-DD". */
  date: string;
  /** Where the merchant can look it up themselves, when there is such a page. */
  url?: string;
}

export interface TrendSource {
  id: string;
  factsFor(market: string, category: string, weekStart: string): Promise<ExternalFact[]>;
}

/** An import older than this (by the last date it covers) is too stale to report on. */
const MAX_AGE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const googleTrendsImportSource: TrendSource = {
  id: "google_trends_csv",
  async factsFor(market, category, weekStart) {
    const oldest = new Date(Date.parse(`${weekStart}T00:00:00Z`) - MAX_AGE_DAYS * DAY_MS).toISOString().slice(0, 10);
    const latest = await prismaUnscoped.trendSignalImport.findFirst({
      where: { source: "google_trends_csv", market, category, periodEnd: { gte: oldest, lt: weekStart } },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) return [];

    const facts: ExternalFact[] = [];
    for (const s of latest.series as unknown as TrendSeries[]) {
      const c = seriesChange(s.points);
      if (!c) continue;
      const move = c.changePercent === 0 ? "the same as" : `${c.changePercent > 0 ? "up" : "down"} ${Math.abs(c.changePercent)}% on`;
      facts.push({
        text:
          `Google Trends (${latest.geo}): search interest in "${s.term}" averaged ${c.recentAverage} out of 100 from ${longDate(c.from)} to ${longDate(c.to)}, ` +
          `${move} the ${c.earlierPoints} readings before (average ${c.earlierAverage}).`,
        source: `Google Trends, ${latest.geo} (file imported ${longDate(latest.createdAt.toISOString().slice(0, 10))})`,
        date: c.to,
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(s.term)}`,
      });
    }
    return facts;
  },
};

let sources: TrendSource[] = [googleTrendsImportSource];

export const getTrendSources = (): TrendSource[] => sources;

/** Replaces the registered sources (tests use it to prove a source can be swapped; `undefined` restores the default). */
export function setTrendSources(next: TrendSource[] | undefined): void {
  sources = next ?? [googleTrendsImportSource];
}
