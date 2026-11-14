import { Prisma } from "@prisma/client";
import { prismaUnscoped } from "../../lib/prisma";
import { getRedis } from "../../lib/redis";
import { getStorage } from "../../lib/storage";
import { Product } from "../../models/Product.model";
import { Category } from "../../models/Category.model";
import { ProductReview } from "../../models/ProductReview.model";
import { AiGeneratedContent } from "../../models/AiGeneratedContent.model";
import { ChatTranscript } from "../../models/ChatTranscript.model";

/**
 * Data lifecycle (production readiness, 2026-11): what an operator needs to answer a store owner
 * leaving, or a person asking for their data or its deletion. Run by an operator through
 * scripts/store-data.ts and scripts/customer-data.ts, never exposed as an endpoint.
 *
 *   exportStore     everything a store has, as plain JSON: profile, team, customers, orders with their
 *                   items, payments, refunds and shipments, discount codes, shipping, payment settings,
 *                   theme, catalogue, reviews and AI content. Never password or token hashes. Private
 *                   files (receipts, voice notes) are listed by key, not copied.
 *   deleteStore     the store and everything in it: PostgreSQL (one cascading delete), MongoDB, its
 *                   files in object storage, and its Redis keys. Owner and staff accounts stay (they may
 *                   own other stores or shop elsewhere); erase a person separately if asked.
 *   exportCustomer  one person's data across every store, by email.
 *   eraseCustomer   removes a person's personal data. Orders stay, because a store must keep its sales
 *                   records, but the name, email, phone and address on them are removed; their reviews,
 *                   chat transcripts, payment-receipt images and session tokens are deleted; their account
 *                   is deleted unless they own a store or work in one (then it is kept and reported).
 */

const ERASED = "Erased on request";

/**
 * A person's reviews and chats can be in any store. The MongoDB tenant guard
 * (models/plugins/tenantScope.plugin.ts) refuses a query without a storeId, so these operator-only,
 * cross-store queries say so explicitly rather than slipping past it.
 */
const EVERY_STORE = { $exists: true };

// ---- Stores ----

export async function exportStore(storeId: string) {
  const db = prismaUnscoped;
  const store = await db.tenant.findUnique({ where: { id: storeId } });
  if (!store) throw new Error(`No store ${storeId}`);
  const where = { tenantId: storeId };
  const [owner, staff, customers, orders, discountCodes, shippingZones, paymentSettings, theme, themeVersions, voiceNotes, proofs] = await Promise.all([
    db.user.findUnique({ where: { id: store.ownerId }, select: { id: true, email: true, name: true, createdAt: true } }),
    db.staffMember.findMany({ where, include: { user: { select: { id: true, email: true, name: true } } } }),
    db.customer.findMany({ where }),
    db.order.findMany({ where, include: { items: true, payments: true, refunds: true, shipment: true }, orderBy: { createdAt: "asc" } }),
    db.discountCode.findMany({ where }),
    db.shippingZone.findMany({ where }),
    db.paymentSettings.findFirst({ where }),
    db.storeTheme.findFirst({ where }),
    db.storeThemeVersion.findMany({ where }),
    db.voiceNote.findMany({ where, select: { id: true, status: true, transcript: true, audioUrl: true, createdAt: true } }),
    db.paymentProof.findMany({ where, select: { id: true, orderId: true, imageUrl: true, declaredAmount: true, declaredReference: true, status: true, createdAt: true } }),
  ]);
  const [products, categories, reviews, aiContent] = await Promise.all([
    Product.find({ storeId }).lean(),
    Category.find({ storeId }).lean(),
    ProductReview.find({ storeId }).lean(),
    AiGeneratedContent.find({ storeId }).lean(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    store,
    owner,
    staff: staff.map((s) => ({ ...s, permissions: s.permissions })),
    customers,
    orders,
    discountCodes,
    shippingZones,
    paymentSettings,
    theme: { current: theme, versions: themeVersions },
    catalogue: { products, categories },
    reviews,
    aiContent,
    voiceNotes,
    paymentProofs: proofs,
    notes: "Private files (payment receipts, voice notes) are listed by key above; copy them from object storage if needed.",
  };
}

/** Every Redis key that holds this store's data. */
async function storeRedisKeys(storeId: string): Promise<string[]> {
  const redis = getRedis();
  const patterns = [`cart:${storeId}:*`, `chat:ctx:${storeId}:*`, `search:vocab:${storeId}`, `analytics:summary:${storeId}:*`, `ai:cache:${storeId}:*`, `ai:daily:*:store:${storeId}`];
  const keys: string[] = [];
  for (const match of patterns) {
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", match, "COUNT", 500);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== "0");
  }
  return keys;
}

/** Clears a store's caches and short-lived data in Redis (carts, chat memory, search, analytics, AI cache). */
export async function clearStoreRedis(storeId: string): Promise<number> {
  const keys = await storeRedisKeys(storeId);
  if (keys.length) await getRedis().del(...keys);
  return keys.length;
}

export async function deleteStore(storeId: string) {
  const store = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) throw new Error(`No store ${storeId}`);
  const mongo = {
    products: (await Product.deleteMany({ storeId })).deletedCount,
    categories: (await Category.deleteMany({ storeId })).deletedCount,
    reviews: (await ProductReview.deleteMany({ storeId })).deletedCount,
    aiContent: (await AiGeneratedContent.deleteMany({ storeId })).deletedCount,
    chatTranscripts: (await ChatTranscript.deleteMany({ storeId })).deletedCount,
  };
  await getStorage().removeStore(storeId);
  const redisKeys = await clearStoreRedis(storeId);
  // Every table hangs off the store with ON DELETE CASCADE (checked in the schema).
  await prismaUnscoped.tenant.delete({ where: { id: storeId } });
  return { storeId, mongo, redisKeys, files: "removed", postgres: "deleted (cascade)" };
}

// ---- People ----

async function personFor(email: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prismaUnscoped.user.findUnique({ where: { email: normalized }, select: { id: true, email: true, name: true, createdAt: true } });
  const customers = await prismaUnscoped.customer.findMany({ where: { OR: [{ email: normalized }, ...(user ? [{ userId: user.id }] : [])] } });
  const orderWhere: Prisma.OrderWhereInput = { OR: [{ guestEmail: normalized }, { customerId: { in: customers.map((c) => c.id) } }] };
  return { normalized, user, customers, orderWhere };
}

export async function exportCustomer(email: string) {
  const { normalized, user, customers, orderWhere } = await personFor(email);
  const orders = await prismaUnscoped.order.findMany({ where: orderWhere, include: { items: true, payments: true, refunds: true, shipment: true } });
  const reviews = user ? await ProductReview.find({ storeId: EVERY_STORE, customerId: user.id }).lean() : [];
  const chats = user ? await ChatTranscript.find({ storeId: EVERY_STORE, customerId: user.id }).lean() : [];
  const recoveryEmails = await prismaUnscoped.cartRecoveryEvent.findMany({ where: { customerEmail: normalized }, select: { tenantId: true, status: true, sentAt: true } });
  return { exportedAt: new Date().toISOString(), email: normalized, account: user, customerRecords: customers, orders, reviews, chats, recoveryEmails };
}

export async function eraseCustomer(email: string) {
  const { normalized, user, customers, orderWhere } = await personFor(email);
  const orders = await prismaUnscoped.order.findMany({ where: orderWhere, select: { id: true, shippingAddress: true } });
  const orderIds = orders.map((o) => o.id);
  const proofs = await prismaUnscoped.paymentProof.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, imageUrl: true } });

  await prismaUnscoped.$transaction(async (tx) => {
    for (const o of orders) {
      // The country stays (sales reports and tax by country); everything that identifies a person goes.
      const country = (o.shippingAddress as { country?: string } | null)?.country ?? null;
      await tx.order.update({ where: { id: o.id }, data: { guestEmail: null, shippingName: ERASED, shippingAddress: country ? { country, erased: true } : { erased: true } } });
    }
    await tx.paymentProof.updateMany({ where: { orderId: { in: orderIds } }, data: { extracted: Prisma.DbNull, declaredReference: null } });
    await tx.customer.updateMany({ where: { id: { in: customers.map((c) => c.id) } }, data: { name: null, email: null, phone: null } });
    await tx.cartRecoveryEvent.deleteMany({ where: { customerEmail: normalized } });
  });
  // Receipt images can show a name and an account number.
  for (const p of proofs) await getStorage().remove(p.imageUrl).catch(() => undefined);

  let reviews = 0;
  let chats = 0;
  let account: "deleted" | "kept: owns or works in a store" | "none" = "none";
  if (user) {
    reviews = (await ProductReview.deleteMany({ storeId: EVERY_STORE, customerId: user.id })).deletedCount;
    chats = (await ChatTranscript.deleteMany({ storeId: EVERY_STORE, customerId: user.id })).deletedCount;
    const ownsOrWorks = (await prismaUnscoped.tenant.count({ where: { ownerId: user.id } })) + (await prismaUnscoped.staffMember.count({ where: { userId: user.id } }));
    if (ownsOrWorks === 0) {
      await prismaUnscoped.customer.updateMany({ where: { userId: user.id }, data: { userId: null } });
      await prismaUnscoped.user.delete({ where: { id: user.id } });
      account = "deleted";
    } else {
      await prismaUnscoped.refreshToken.deleteMany({ where: { userId: user.id } });
      account = "kept: owns or works in a store";
    }
  }
  return { email: normalized, ordersAnonymised: orders.length, customerRecords: customers.length, receiptImages: proofs.length, reviews, chats, account };
}
