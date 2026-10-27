/**
 * Product Scout's trend calculation (2026-10-22). Pure functions over sales rows from every store, so
 * the arithmetic and the privacy rules can be tested on their own; no AI is involved here.
 *
 * - Rows are grouped by market (store currency) and never mixed across markets.
 * - Within a market, by normalised category ("Toys" and " toys" are one) and by product type: the
 *   title's meaningful words ("Copper Kettle 1.5L" and "copper kettle" are one type).
 * - A figure is published only if, in that period, it passes three rules (the standard statistical
 *   disclosure rules): at least `minStores` different stores sold it; no single store sold more than
 *   `maxShare` of its units; and the two biggest stores together sold no more than `maxTopTwoShare`
 *   (so one store cannot work out another's sales by taking its own away). They are applied to every
 *   product type and every category, for the current AND the previous period: anything that fails
 *   any rule in either period is hidden whole, never shown with some of its numbers missing.
 * - Subtraction is checked too (secondary suppression). A category's figure is withheld when what is left of it after the
 *   product types shown in it (the part anyone could work out by taking those away) would fail the
 *   rules; and a 30-day figure is withheld when the part of it before the 7-day figures (days 8 to 30,
 *   or 15 to 30) would. Either way, no figure can be taken away from another to reveal a few stores.
 * - What comes out carries no store id, store name, product id or customer, and no title any one store
 *   wrote: a product type is named from its normalised words.
 */
import { normaliseCategory, displayCategory, titleKeywords } from "../trends/trends.aggregate";

export interface ScoutOptions {
  /** Fewest different stores a published figure may come from (SCOUT_MIN_STORES). */
  minStores: number;
  /** Largest share of a figure's units one store may hold, 0 to 1 (SCOUT_MAX_STORE_SHARE). */
  maxShare: number;
  /** Largest share the two biggest stores may hold together, 0 to 1 (SCOUT_MAX_TOP_TWO_SHARE). */
  maxTopTwoShare: number;
  /** A product type counts as "fastest growing" only with at least this many units in the period. */
  minGrowthUnits: number;
}

export const DEFAULT_SCOUT_OPTIONS: ScoutOptions = { minStores: 3, maxShare: 0.6, maxTopTwoShare: 0.85, minGrowthUnits: 5 };

/** One line per store, order and product, from the sales query (scout.service.ts). */
export interface ScoutRow {
  tenantId: string;
  market: string;
  orderId: string;
  /** The product's category, as the store typed it. */
  category: string;
  title: string;
  period: "current" | "previous";
  /**
   * For the 30-day period only, which part of the current period the line falls in: "recent" (the
   * last 7 days, which are the 7-day figures), "prior" (the 7 days before, the 7-day comparison) or
   * "older" (days 15 to 30). Lets the 30-day figures be checked against what subtraction would show.
   */
  segment?: "recent" | "prior" | "older";
  units: number;
}

export interface Figures {
  units: number;
  orders: number;
  stores: number;
  /** Null only when nothing was sold in the previous period (then `isNew`). */
  previousUnits: number | null;
  /** Rounded percent change on the previous period; null when nothing was sold in it. */
  growthPercent: number | null;
  /** True when nothing at all was sold in the previous period: new this period. */
  isNew: boolean;
}

export interface CategoryFigures extends Figures {
  key: string;
  name: string;
}

export interface ProductTypeFigures extends Figures {
  /** Stable id within a market: "<category>|<type words>". */
  id: string;
  name: string;
  category: string;
  categoryName: string;
}

export interface MarketTrends {
  market: string;
  categories: CategoryFigures[];
  products: ProductTypeFigures[];
  topSellers: string[];
  fastestGrowing: string[];
  rising: { category: string; products: string[] }[];
}

const TOP = 10;
const RISING_PER_CATEGORY = 3;

/** The product type of a title: its meaningful words, in order ("Copper Kettle 1.5L" is "copper kettle"). */
export function productTypeKey(title: string): string {
  return titleKeywords(title.normalize("NFKC")).join(" ");
}

/** "copper kettle" as a name: "Copper kettle". */
export const typeName = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

type PerStore = Map<string, number>;

interface Bucket {
  current: PerStore;
  previous: PerStore;
  recent: PerStore;
  prior: PerStore;
  older: PerStore;
  segmented: boolean;
  orders: Set<string>;
}
const newBucket = (): Bucket => ({ current: new Map(), previous: new Map(), recent: new Map(), prior: new Map(), older: new Map(), segmented: false, orders: new Set() });
const add = (m: PerStore, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
const sum = (m: PerStore) => [...m.values()].reduce((s, n) => s + n, 0);
/**
 * The three rules for one figure's per-store units: enough stores, no store above `maxShare`, and the
 * two biggest together no more than `maxTopTwoShare`.
 */
export function passesRules(perStore: PerStore, opts: Pick<ScoutOptions, "minStores" | "maxShare" | "maxTopTwoShare">): boolean {
  const units = [...perStore.values()].filter((n) => n > 0).sort((a, b) => b - a);
  if (units.length < opts.minStores) return false;
  const total = units.reduce((s, n) => s + n, 0);
  if (total <= 0) return false;
  if (units[0] / total > opts.maxShare) return false;
  return (units[0] + (units[1] ?? 0)) / total <= opts.maxTopTwoShare;
}

const merge = (...maps: PerStore[]) => {
  const out: PerStore = new Map();
  for (const m of maps) for (const [k, v] of m) add(out, k, v);
  return out;
};
const minus = (a: PerStore, ...bs: PerStore[]) => {
  const out: PerStore = new Map(a);
  for (const b of bs) for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) - v);
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
};

/** What a published figure exposes, kept so the category check can take it away. */
interface Shown {
  current: PerStore;
  previous: PerStore;
}

/**
 * The published figures for one group, or null when anything it would show fails a rule: then it is
 * hidden whole, never shown with some numbers missing. `exposed` are the parts of it already shown
 * elsewhere (the product types in a category); what is left after taking them away must also pass,
 * or be nothing.
 */
function figures(b: Bucket, opts: ScoutOptions, exposed: Shown[] = []): { f: Figures; shown: Shown } | null {
  const passes = (m: PerStore) => passesRules(m, opts);
  const passesOrEmpty = (m: PerStore) => sum(m) === 0 || passes(m);
  // This period, and what is left of it after the parts shown elsewhere.
  if (!passes(b.current)) return null;
  if (!passesOrEmpty(minus(b.current, ...exposed.map((e) => e.current)))) return null;
  // The previous period is shown too (as the growth), so it must pass the same way, or be empty (new).
  if (!passesOrEmpty(b.previous)) return null;
  if (!passesOrEmpty(minus(b.previous, ...exposed.map((e) => e.previous)))) return null;
  if (b.segmented) {
    // The 7-day figures are these same days: when they are shown, the rest of the 30 must pass too.
    const recentShown = passes(b.recent);
    const priorShown = recentShown && passes(b.prior);
    if (recentShown && !passesOrEmpty(merge(b.prior, b.older))) return null;
    if (priorShown && !passesOrEmpty(b.older)) return null;
  }
  const units = sum(b.current);
  const previousTotal = sum(b.previous);
  return {
    f: {
      units,
      orders: b.orders.size,
      stores: [...b.current.values()].filter((n) => n > 0).length,
      previousUnits: previousTotal > 0 ? previousTotal : null,
      growthPercent: previousTotal > 0 ? Math.round(((units - previousTotal) / previousTotal) * 100) : null,
      isNew: previousTotal === 0,
    },
    shown: { current: b.current, previous: b.previous },
  };
}

/** Every market's published trends. Rows with nothing sold, or no meaningful title, are ignored. */
export function computeTrends(rows: ScoutRow[], opts: ScoutOptions = DEFAULT_SCOUT_OPTIONS): MarketTrends[] {
  const markets = new Map<string, { categories: Map<string, Bucket>; types: Map<string, Bucket> }>();
  for (const r of rows) {
    if (r.units <= 0) continue;
    const type = productTypeKey(r.title);
    if (!type) continue;
    const category = normaliseCategory(r.category);
    const market = markets.get(r.market) ?? { categories: new Map(), types: new Map() };
    markets.set(r.market, market);
    for (const [map, key] of [
      [market.categories, category],
      [market.types, `${category}|${type}`],
    ] as const) {
      const b = map.get(key) ?? newBucket();
      map.set(key, b);
      if (r.period === "previous") {
        add(b.previous, r.tenantId, r.units);
        continue;
      }
      add(b.current, r.tenantId, r.units);
      b.orders.add(`${r.tenantId}:${r.orderId}`);
      if (r.segment) {
        b.segmented = true;
        add(b[r.segment], r.tenantId, r.units);
      }
    }
  }

  const out: MarketTrends[] = [];
  for (const [market, m] of [...markets].sort(([a], [b]) => a.localeCompare(b))) {
    const products: ProductTypeFigures[] = [];
    const shownByCategory = new Map<string, Shown[]>();
    for (const [id, b] of m.types) {
      const r = figures(b, opts);
      if (!r) continue;
      const [category, type] = id.split("|");
      products.push({ id, name: typeName(type), category, categoryName: displayCategory(category), ...r.f });
      shownByCategory.set(category, [...(shownByCategory.get(category) ?? []), r.shown]);
    }
    products.sort((a, b) => b.units - a.units || a.id.localeCompare(b.id));

    const categories: CategoryFigures[] = [];
    for (const [key, b] of m.categories) {
      const r = figures(b, opts, shownByCategory.get(key) ?? []);
      if (r) categories.push({ key, name: displayCategory(key), ...r.f });
    }
    categories.sort((a, b) => b.units - a.units || a.key.localeCompare(b.key));

    const growing = products
      .filter((p) => p.growthPercent !== null && p.growthPercent > 0 && p.units >= opts.minGrowthUnits)
      .sort((a, b) => b.growthPercent! - a.growthPercent! || b.units - a.units || a.id.localeCompare(b.id));
    const rising = [...new Set(products.map((p) => p.category))]
      .map((category) => ({ category, products: growing.filter((p) => p.category === category).slice(0, RISING_PER_CATEGORY).map((p) => p.id) }))
      .filter((r) => r.products.length > 0)
      .sort((a, b) => a.category.localeCompare(b.category));

    out.push({
      market,
      categories,
      products,
      topSellers: products.slice(0, TOP).map((p) => p.id),
      fastestGrowing: growing.slice(0, TOP).map((p) => p.id),
      rising,
    });
  }
  return out;
}
