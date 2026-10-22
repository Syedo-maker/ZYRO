/**
 * Product Scout's trend calculation (2026-10-22). Pure functions over sales rows from every store, so
 * the arithmetic and the privacy rules can be tested on their own; no AI is involved here.
 *
 * - Rows are grouped by market (store currency) and never mixed across markets.
 * - Within a market, by normalised category ("Toys" and " toys" are one) and by product type: the
 *   title's meaningful words ("Copper Kettle 1.5L" and "copper kettle" are one type).
 * - A figure is published only if, in that period, at least `minStores` different stores sold it AND
 *   no single store sold more than `maxShare` of its units. Both rules are applied to every product
 *   type and every category, separately for the current and the previous period, so one dominant
 *   store can never be read off the numbers. A previous period that fails them is not compared
 *   against: the growth is withheld rather than revealed.
 * - What comes out carries no store id, store name, product id or customer, and no title any one store
 *   wrote: a product type is named from its normalised words.
 */
import { normaliseCategory, displayCategory, safeToPublish, titleKeywords } from "../trends/trends.aggregate";

export interface ScoutOptions {
  /** Fewest different stores a published figure may come from (SCOUT_MIN_STORES). */
  minStores: number;
  /** Largest share of a figure's units one store may hold, 0 to 1 (SCOUT_MAX_STORE_SHARE). */
  maxShare: number;
  /** A product type counts as "fastest growing" only with at least this many units in the period. */
  minGrowthUnits: number;
}

export const DEFAULT_SCOUT_OPTIONS: ScoutOptions = { minStores: 3, maxShare: 0.6, minGrowthUnits: 5 };

/** One line per store, order and product, from the sales query (scout.service.ts). */
export interface ScoutRow {
  tenantId: string;
  market: string;
  orderId: string;
  /** The product's category, as the store typed it. */
  category: string;
  title: string;
  period: "current" | "previous";
  units: number;
}

export interface Figures {
  units: number;
  orders: number;
  stores: number;
  /** Null when the previous period cannot be shown (too few stores, or one dominated it). */
  previousUnits: number | null;
  /** Rounded percent change on the previous period; null when it cannot be compared. */
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

interface Bucket {
  current: Map<string, number>;
  previous: Map<string, number>;
  orders: Set<string>;
}
const newBucket = (): Bucket => ({ current: new Map(), previous: new Map(), orders: new Set() });
const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);

/** The published figures for one group, or null when its current period may not be shown. */
function figures(b: Bucket, opts: ScoutOptions): Figures | null {
  const rule = { minStores: opts.minStores, maxShare: opts.maxShare, baselineWeeks: 1 };
  if (!safeToPublish(b.current, rule)) return null;
  const units = sum(b.current);
  const previousTotal = sum(b.previous);
  const previousShown = previousTotal > 0 && safeToPublish(b.previous, rule);
  return {
    units,
    orders: b.orders.size,
    stores: [...b.current.values()].filter((n) => n > 0).length,
    previousUnits: previousShown ? previousTotal : null,
    growthPercent: previousShown ? Math.round(((units - previousTotal) / previousTotal) * 100) : null,
    isNew: previousTotal === 0,
  };
}

/** Every market's published trends. Rows of other periods or with nothing sold are ignored. */
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
      add(r.period === "current" ? b.current : b.previous, r.tenantId, r.units);
      if (r.period === "current") b.orders.add(`${r.tenantId}:${r.orderId}`);
    }
  }

  const out: MarketTrends[] = [];
  for (const [market, m] of [...markets].sort(([a], [b]) => a.localeCompare(b))) {
    const categories: CategoryFigures[] = [];
    for (const [key, b] of m.categories) {
      const f = figures(b, opts);
      if (f) categories.push({ key, name: displayCategory(key), ...f });
    }
    categories.sort((a, b) => b.units - a.units || a.key.localeCompare(b.key));

    const products: ProductTypeFigures[] = [];
    for (const [id, b] of m.types) {
      const f = figures(b, opts);
      if (!f) continue;
      const [category, type] = id.split("|");
      products.push({ id, name: typeName(type), category, categoryName: displayCategory(category), ...f });
    }
    products.sort((a, b) => b.units - a.units || a.id.localeCompare(b.id));

    const growing = products
      .filter((p) => p.growthPercent !== null && p.growthPercent > 0 && p.units >= opts.minGrowthUnits)
      .sort((a, b) => b.growthPercent! - a.growthPercent! || b.units - a.units || a.id.localeCompare(b.id));
    const rising = categories
      .map((c) => ({ category: c.key, products: growing.filter((p) => p.category === c.key).slice(0, RISING_PER_CATEGORY).map((p) => p.id) }))
      .filter((r) => r.products.length > 0);

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
