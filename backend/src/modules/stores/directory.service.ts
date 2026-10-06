import { prismaUnscoped } from "../../lib/prisma";
import { Product } from "../../models/Product.model";

/**
 * The public shop directory behind /shop (Issue 2).
 *
 * A shopper who arrives without a shop in mind has to be able to find one, so this lists shops to
 * anyone, with no login. Three rules decide what appears, all of them the owner's interest rather
 * than ours:
 *
 * 1. **The owner can opt out.** `Tenant.listedInDirectory` is on by default and one switch in the
 *    shop's settings turns it off; an unlisted shop still works perfectly, it is simply not
 *    advertised here.
 * 2. **Empty and test shops are left out**, however the switch is set. This codebase has no
 *    "publish the shop" step and no draft products: a shop is as real as its catalogue, so having
 *    at least `MIN_PRODUCTS` products is what "published" means here. It keeps a half-finished shop
 *    off the front page without asking the owner to remember a checkbox.
 * 3. **Only public information leaves this module.** Name, slug, logo, theme colour, currency, the
 *    owner's own one-line description, and a category worked out from the shop's own products.
 *    Nothing about revenue, orders, plan, staff or the owner.
 */

/** Below this a shop reads as unfinished, so it is not advertised. Three is "a few" without being strict. */
export const MIN_PRODUCTS = 3;
/** One page of the directory. */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

export interface DirectoryStore {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  themeColor: string | null;
  currency: string;
  description: string | null;
  /** The category most of this shop's products are in, or null when it sells a bit of everything. */
  category: string | null;
  productCount: number;
}

interface Counted {
  count: number;
  category: string | null;
}

/**
 * How many products each of these shops has, and the category it mostly sells, in one aggregation.
 *
 * A deliberate cross-shop read: the directory is about many shops at once, so `storeId` is matched
 * against the whole candidate list rather than one shop. Nothing shop-private is read, only the
 * category field and a count.
 */
async function countsByStore(storeIds: string[]): Promise<Map<string, Counted>> {
  if (storeIds.length === 0) return new Map();
  const rows = await Product.aggregate<{ _id: string; count: number; categories: { category: string; n: number }[] }>([
    { $match: { storeId: { $in: storeIds } } },
    { $group: { _id: { storeId: "$storeId", category: "$category" }, n: { $sum: 1 } } },
    {
      $group: {
        _id: "$_id.storeId",
        count: { $sum: "$n" },
        categories: { $push: { category: "$_id.category", n: "$n" } },
      },
    },
  ]);

  const out = new Map<string, Counted>();
  for (const row of rows) {
    const top = [...row.categories].sort((a, b) => b.n - a.n || a.category.localeCompare(b.category))[0];
    // A category is only worth showing if it is most of what the shop sells; otherwise the shop is
    // general and claiming one category would mislead the shopper.
    const dominant = top && top.n / row.count >= 0.4 ? top.category : null;
    out.set(row._id, { count: row.count, category: dominant });
  }
  return out;
}

export const directoryService = {
  /**
   * The listed shops, biggest catalogue first, optionally narrowed by a search over the name and
   * the owner's description and by category.
   */
  /*
   * Note on how this scales: it reads every opted-in shop and counts their products in one
   * aggregation, then pages the result in memory. That is two queries however many shops there are,
   * but the work grows with the number of shops on the platform rather than with the page size.
   * It is the right trade now (the product count and the category live in MongoDB while the opt-in
   * lives in Postgres, so one database cannot sort and page the whole thing), and the honest place
   * to change it later is here: a periodically refreshed summary row per shop in Postgres would
   * make this a single indexed, paged query.
   */
  async list(options: { q?: string; category?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);
    const q = options.q?.trim();

    // Cross-tenant by nature, like "which shops do I belong to": the unscoped client is the only one
    // that can express it (see lib/prisma.ts). Read-only, and only ever the public columns below.
    const candidates = await prismaUnscoped.tenant.findMany({
      where: {
        listedInDirectory: true,
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
      },
      select: { id: true, name: true, slug: true, logoUrl: true, themeColor: true, currency: true, description: true },
      orderBy: { createdAt: "asc" },
    });

    const counts = await countsByStore(candidates.map((c) => c.id));

    const listed: DirectoryStore[] = [];
    for (const shop of candidates) {
      const counted = counts.get(shop.id);
      if (!counted || counted.count < MIN_PRODUCTS) continue;
      if (options.category && counted.category !== options.category) continue;
      listed.push({ ...shop, category: counted.category, productCount: counted.count });
    }

    listed.sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
    return { stores: listed.slice(offset, offset + limit), total: listed.length, limit, offset };
  },

  /** The categories the directory can be filtered by: the ones listed shops actually sell. */
  async categories(): Promise<string[]> {
    const { stores } = await this.list({ limit: MAX_LIMIT });
    return [...new Set(stores.map((s) => s.category).filter((c): c is string => Boolean(c)))].sort();
  },
};
