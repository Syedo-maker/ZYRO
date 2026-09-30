/**
 * The Trend Scout's anonymising aggregation (Part D). Pure functions over sales rows from every store,
 * so the privacy rules can be tested on their own:
 *
 * - Sales are grouped by market (the store currency) and category, never across currencies.
 * - A figure is published only when enough distinct stores sold in BOTH the week reported and the
 *   weeks it is compared with (`minStores`), so no number can be one store's sales.
 * - Even then, when one store makes up most of a figure (`maxShare`), it is withheld: "5 stores" where
 *   one sold 95% of the units would still be describing that one store.
 * - Title keywords are held to the same two rules, per keyword.
 *
 * What comes out carries no store ids, names or product ids: only totals, changes and a store-count band.
 */

/** One row per store, product and period, from the sales query in trends.service.ts. */
export interface SalesRow {
  tenantId: string;
  market: string;
  category: string;
  title: string;
  period: "current" | "baseline";
  units: number;
}

export interface AggregateOptions {
  /** Fewest distinct stores a published figure may come from. */
  minStores: number;
  /** Largest share of a figure's units one store may hold, 0 to 1. */
  maxShare: number;
  /** How many weeks the baseline covers (the week reported is compared with their weekly average). */
  baselineWeeks: number;
}

export const DEFAULT_OPTIONS: AggregateOptions = { minStores: 5, maxShare: 0.6, baselineWeeks: 4 };

/** Up to this many rising and this many falling keywords per category. */
const MAX_RISING = 3;
const MAX_FALLING = 2;
/** A keyword counts as moving only past this change, and with at least this many units this week. */
const MIN_CHANGE_PERCENT = 20;
const MIN_KEYWORD_UNITS = 5;

export interface KeywordTrend {
  keyword: string;
  currentUnits: number;
  baselineWeeklyUnits: number;
  changePercent: number;
}

export interface CategoryTrend {
  market: string;
  category: string;
  /** Distinct stores with sales in either period (kept for the platform's own records, never shown exactly). */
  storeCount: number;
  /** False when the category's own figures are withheld (too few stores, or one dominates). */
  publishable: boolean;
  currentUnits: number;
  baselineWeeklyUnits: number;
  /** Null when there were no sales in the baseline to compare with. */
  changePercent: number | null;
  rising: KeywordTrend[];
  falling: KeywordTrend[];
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/**
 * One name per category across stores, which each type their own: "Home & Kitchen ", "home and kitchen"
 * and "HOME  AND KITCHEN" are the same category. Empty or missing becomes "uncategorised".
 */
export function normaliseCategory(raw: string | null | undefined): string {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return s || "uncategorised";
}

/** "home and kitchen" as a heading: "Home and kitchen". */
export function displayCategory(normalised: string): string {
  return normalised.charAt(0).toUpperCase() + normalised.slice(1);
}

const STOPWORDS = new Set(
  "the and for with from this that pack set pcs piece pieces new best sale free size small medium large extra per item items one two three of in on to by a an x".split(" ")
);

/** The words in a product title worth tracking: lowercase, letters only, three or more letters, no filler. Each word once. */
export function titleKeywords(title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

// ---------------------------------------------------------------------------------------------
// The privacy rules
// ---------------------------------------------------------------------------------------------

/** Units per store in one period. */
type PerStore = Map<string, number>;

const total = (m: PerStore) => [...m.values()].reduce((s, n) => s + n, 0);

/** True when these per-store totals may be published: enough stores, and none holding too much of it. */
export function safeToPublish(perStore: PerStore, opts: AggregateOptions): boolean {
  const stores = [...perStore.values()].filter((n) => n > 0);
  if (stores.length < opts.minStores) return false;
  const sum = stores.reduce((s, n) => s + n, 0);
  return sum > 0 && Math.max(...stores) / sum <= opts.maxShare;
}

const change = (current: number, baselineWeekly: number): number | null =>
  baselineWeekly > 0 ? Math.round(((current - baselineWeekly) / baselineWeekly) * 100) : null;

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------------------------

interface Bucket {
  current: PerStore;
  baseline: PerStore;
}

const bucket = (): Bucket => ({ current: new Map(), baseline: new Map() });
const add = (b: Bucket, row: SalesRow) => {
  const m = b[row.period];
  m.set(row.tenantId, (m.get(row.tenantId) ?? 0) + row.units);
};

/** Groups the rows by market and category and applies the rules. Categories come out sorted, for stable output. */
export function aggregate(rows: SalesRow[], opts: AggregateOptions = DEFAULT_OPTIONS): CategoryTrend[] {
  const groups = new Map<string, { market: string; category: string; all: Bucket; keywords: Map<string, Bucket> }>();

  for (const row of rows) {
    if (row.units <= 0) continue;
    const key = `${row.market}\u0000${row.category}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { market: row.market, category: row.category, all: bucket(), keywords: new Map() }));
    add(g.all, row);
    for (const word of titleKeywords(row.title)) {
      let kb = g.keywords.get(word);
      if (!kb) g.keywords.set(word, (kb = bucket()));
      add(kb, row);
    }
  }

  const out: CategoryTrend[] = [];
  for (const g of groups.values()) {
    const stores = new Set([...g.all.current.keys(), ...g.all.baseline.keys()]);
    const publishable = safeToPublish(g.all.current, opts) && safeToPublish(g.all.baseline, opts);
    const currentUnits = total(g.all.current);
    const baselineWeeklyUnits = round1(total(g.all.baseline) / opts.baselineWeeks);

    const moving: KeywordTrend[] = [];
    if (publishable) {
      for (const [keyword, kb] of g.keywords) {
        if (!safeToPublish(kb.current, opts) || !safeToPublish(kb.baseline, opts)) continue;
        const cur = total(kb.current);
        const base = round1(total(kb.baseline) / opts.baselineWeeks);
        const pct = change(cur, base);
        if (pct === null || Math.abs(pct) < MIN_CHANGE_PERCENT) continue;
        if (pct > 0 && cur < MIN_KEYWORD_UNITS) continue;
        moving.push({ keyword, currentUnits: cur, baselineWeeklyUnits: base, changePercent: pct });
      }
    }
    const byChange = (a: KeywordTrend, b: KeywordTrend) => b.changePercent - a.changePercent || a.keyword.localeCompare(b.keyword);

    out.push({
      market: g.market,
      category: g.category,
      storeCount: stores.size,
      publishable,
      // Withheld figures are zeroed here so nothing downstream can show them by accident.
      currentUnits: publishable ? currentUnits : 0,
      baselineWeeklyUnits: publishable ? baselineWeeklyUnits : 0,
      changePercent: publishable ? change(currentUnits, baselineWeeklyUnits) : null,
      rising: moving.filter((k) => k.changePercent > 0).sort(byChange).slice(0, MAX_RISING),
      falling: moving
        .filter((k) => k.changePercent < 0)
        .sort((a, b) => a.changePercent - b.changePercent || a.keyword.localeCompare(b.keyword))
        .slice(0, MAX_FALLING),
    });
  }
  return out.sort((a, b) => a.market.localeCompare(b.market) || a.category.localeCompare(b.category));
}

/** How many stores, as merchants see it: a band, never the exact count. */
export function storeBand(count: number, minStores: number): string {
  if (count >= 25) return "25 or more stores";
  if (count >= 10) return "10 to 24 stores";
  return `${minStores} or more stores`;
}
