import { Types, type HydratedDocument } from "mongoose";
import { Product } from "../../models/Product.model";
import { ProductReview, type ProductReviewDocument } from "../../models/ProductReview.model";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import type { CreateReviewInput, ListReviewsQuery, MerchantListQuery, ModerateReviewInput, UpdateReviewInput } from "./review.validation";

type ReviewDoc = HydratedDocument<ProductReviewDocument>;

const isDuplicateKey = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
const round = (n: number, places = 2) => Number(n.toFixed(places));

function objectId(id: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw Errors.notFound(what);
  return new Types.ObjectId(id);
}

/** "Sam Okafor" becomes "Sam O."; without a name the reviewer is simply "Customer". The email is never shown. */
export function displayName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Customer";
  const first = parts[0].slice(0, 30);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

/** What shoppers see of a review. The reviewer's id and email are never part of it. */
const toPublic = (r: ReviewDoc) => ({
  id: r._id.toString(),
  productId: r.productId.toString(),
  authorName: r.authorName,
  rating: r.rating,
  title: r.title ?? null,
  comment: r.comment ?? null,
  verifiedPurchase: r.verifiedPurchase,
  merchantReply: r.merchantReply ?? null,
  merchantRepliedAt: r.merchantRepliedAt ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** The reviewer's own view of their review: adds its moderation status. */
const toOwn = (r: ReviewDoc) => ({ ...toPublic(r), status: r.status });

/**
 * Average rating and review count for many products at once, computed on read from the
 * published reviews (Implementation_Plan.md Phase 3: not stored on the product, so there is
 * nothing to fall out of sync). One aggregation per page of products. Aggregations skip the
 * tenant-scoping plugin, so the store is part of the match.
 */
export async function ratingsFor(storeId: string, productIds: string[]) {
  const ids = productIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const out = new Map<string, { averageRating: number; reviewCount: number }>();
  if (ids.length === 0) return out;
  const rows = await ProductReview.aggregate<{ _id: Types.ObjectId; avg: number; count: number }>([
    { $match: { storeId, productId: { $in: ids }, status: "published" } },
    { $group: { _id: "$productId", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  for (const r of rows) out.set(r._id.toString(), { averageRating: round(r.avg), reviewCount: r.count });
  return out;
}

/** The rating summary of one product: average, count and how many gave each star. */
async function summaryFor(storeId: string, productId: Types.ObjectId) {
  const rows = await ProductReview.aggregate<{ _id: number; count: number }>([
    { $match: { storeId, productId, status: "published" } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);
  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    distribution[String(r._id)] = r.count;
    total += r.count;
    sum += r._id * r.count;
  }
  return { averageRating: total > 0 ? round(sum / total) : null, reviewCount: total, distribution };
}

/** Owners and staff may not review the products they sell: it would be a fake review. */
async function isStoreInsider(userId: string, tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerId: true } });
  if (tenant?.ownerId === userId) return true;
  return !!(await prisma.staffMember.findFirst({ where: { tenantId, userId } }));
}

/**
 * A verified purchase: the reviewer has a paid order in this store that includes the product
 * and has not been refunded or cancelled. Checked once, when the review is written (a later
 * refund does not remove the badge).
 */
async function hasPurchased(userId: string, tenantId: string, productId: string): Promise<boolean> {
  const order = await prisma.order.findFirst({
    where: {
      tenantId,
      status: { in: ["PAID", "FULFILLED", "COMPLETED"] },
      customer: { is: { userId } },
      items: { some: { productId } },
    },
    select: { id: true },
  });
  return !!order;
}

async function requireProduct(storeId: string, productId: string): Promise<Types.ObjectId> {
  const id = objectId(productId, "Product");
  if (!(await Product.exists({ _id: id, storeId }))) throw Errors.notFound("Product");
  return id;
}

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
} as const;

export const reviewService = {
  /**
   * Published reviews of a product with the rating summary. A signed-in shopper also gets their
   * own review (even a hidden one), so the page can offer edit and delete instead of "write a review".
   */
  async list(storeId: string, productId: string, q: ListReviewsQuery, viewerId?: string) {
    const pid = await requireProduct(storeId, productId);
    const filter: Record<string, unknown> = { storeId, productId: pid, status: "published", ...(q.rating ? { rating: q.rating } : {}) };
    const [docs, total, summary, mine] = await Promise.all([
      ProductReview.find(filter).sort(SORTS[q.sort]).skip(q.offset).limit(q.limit),
      ProductReview.countDocuments(filter),
      summaryFor(storeId, pid),
      viewerId ? ProductReview.findOne({ storeId, productId: pid, customerId: viewerId }) : Promise.resolve(null),
    ]);
    return {
      data: docs.map(toPublic),
      pagination: { total, limit: q.limit, offset: q.offset },
      ...summary,
      myReview: mine ? toOwn(mine) : null,
    };
  },

  async create(storeId: string, productId: string, userId: string, input: CreateReviewInput) {
    const pid = await requireProduct(storeId, productId);
    if (await isStoreInsider(userId, storeId)) {
      throw Errors.forbidden("Store owners and staff cannot review their own store's products");
    }
    const user = await prismaUnscoped.user.findUnique({ where: { id: userId }, select: { name: true } });
    try {
      const doc = await ProductReview.create({
        storeId,
        productId: pid,
        customerId: userId,
        authorName: displayName(user?.name),
        rating: input.rating,
        title: input.title || undefined,
        comment: input.comment || undefined,
        verifiedPurchase: await hasPurchased(userId, storeId, productId),
      });
      return toOwn(doc);
    } catch (err) {
      if (isDuplicateKey(err)) throw Errors.conflict("You have already reviewed this product; edit your review instead");
      throw err;
    }
  },

  /** Changing your own review keeps its place and its verified badge; a hidden review stays hidden. */
  async updateMine(storeId: string, productId: string, userId: string, input: UpdateReviewInput) {
    const pid = await requireProduct(storeId, productId);
    const doc = await ProductReview.findOne({ storeId, productId: pid, customerId: userId });
    if (!doc) throw Errors.notFound("Your review");
    if (input.rating !== undefined) doc.rating = input.rating;
    if (input.title !== undefined) doc.title = input.title || undefined;
    if (input.comment !== undefined) doc.comment = input.comment || undefined;
    await doc.save();
    return toOwn(doc);
  },

  async removeMine(storeId: string, productId: string, userId: string) {
    const pid = await requireProduct(storeId, productId);
    const { deletedCount } = await ProductReview.deleteOne({ storeId, productId: pid, customerId: userId });
    if (deletedCount === 0) throw Errors.notFound("Your review");
  },

  // ---- Merchant side ----

  /** Every review in the store, hidden ones included, for the moderation page. */
  async merchantList(storeId: string, q: MerchantListQuery) {
    const filter: Record<string, unknown> = {
      storeId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.rating ? { rating: q.rating } : {}),
      ...(q.productId ? { productId: objectId(q.productId, "Product") } : {}),
    };
    const [docs, total] = await Promise.all([
      ProductReview.find(filter).sort({ createdAt: -1, _id: -1 }).skip(q.offset).limit(q.limit),
      ProductReview.countDocuments(filter),
    ]);
    const titles = new Map(
      (await Product.find({ storeId, _id: { $in: [...new Set(docs.map((d) => d.productId.toString()))] } }).select("title")).map((p) => [p._id.toString(), p.title])
    );
    return {
      data: docs.map((d) => ({ ...toOwn(d), productTitle: titles.get(d.productId.toString()) ?? "Deleted product" })),
      pagination: { total, limit: q.limit, offset: q.offset },
    };
  },

  /** Hide or show a review, and add or remove the store's public reply. The reviewer's own words are never edited. */
  async moderate(storeId: string, reviewId: string, input: ModerateReviewInput) {
    const doc = await ProductReview.findOne({ _id: objectId(reviewId, "Review"), storeId });
    if (!doc) throw Errors.notFound("Review");
    if (input.status !== undefined) doc.status = input.status;
    if (input.reply !== undefined) {
      if (input.reply === null || input.reply === "") {
        doc.merchantReply = undefined;
        doc.merchantRepliedAt = undefined;
      } else if (doc.merchantReply !== input.reply) {
        doc.merchantReply = input.reply;
        doc.merchantRepliedAt = new Date();
      }
    }
    await doc.save();
    const product = await Product.findOne({ _id: doc.productId, storeId }).select("title");
    return { ...toOwn(doc), productTitle: product?.title ?? "Deleted product" };
  },

  /** Removes all reviews of a product that is being deleted. */
  async removeForProduct(storeId: string, productId: string) {
    if (Types.ObjectId.isValid(productId)) await ProductReview.deleteMany({ storeId, productId: new Types.ObjectId(productId) });
  },
};
