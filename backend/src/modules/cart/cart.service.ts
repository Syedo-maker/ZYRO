import { Types } from "mongoose";
import { getRedis } from "../../lib/redis";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";

/** Who a cart belongs to: a logged-in user, or an anonymous browser session. */
export interface CartOwner {
  kind: "user" | "guest";
  id: string;
}

export interface CartItemView {
  id: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Units the store can currently ship online; the cart shows a warning when quantity exceeds it. */
  availableStock: number;
}

export interface CartView {
  items: CartItemView[];
  subtotal: number;
}

/**
 * Carts live in Redis as one hash per store and shopper (field = productId, value =
 * quantity), expiring after CART_TTL_SECONDS of inactivity. Only ids and quantities are
 * stored: prices, titles and stock are looked up fresh on every read, so a cart can never
 * hold a stale or tampered price.
 */
export function cartKey(storeId: string, owner: CartOwner): string {
  return `cart:${storeId}:${owner.kind === "user" ? "u" : "g"}:${owner.id}`;
}

async function resolveProduct(storeId: string, productId: string) {
  if (!Types.ObjectId.isValid(productId)) throw Errors.notFound("Product");
  const product = await Product.findOne({ _id: productId, storeId });
  if (!product) throw Errors.notFound("Product");
  return product;
}

async function availableFor(storeId: string, productId: string): Promise<number> {
  const locationId = await inventoryService.getDefaultLocationId(prisma, storeId);
  const totals = await inventoryService.getTotals(prisma, storeId, [productId], locationId);
  return totals.get(productId) ?? 0;
}

async function touch(key: string) {
  await getRedis().expire(key, env.cartTtlSeconds);
}

export const cartService = {
  async get(storeId: string, owner: CartOwner): Promise<CartView> {
    const key = cartKey(storeId, owner);
    const raw = await getRedis().hgetall(key);
    const productIds = Object.keys(raw);
    if (productIds.length === 0) return { items: [], subtotal: 0 };

    const validIds = productIds.filter((id) => Types.ObjectId.isValid(id));
    const products = await Product.find({ storeId, _id: { $in: validIds } });
    const byId = new Map(products.map((p) => [p._id.toString(), p]));

    // A product deleted since it was added silently drops out of the cart.
    const gone = productIds.filter((id) => !byId.has(id));
    if (gone.length > 0) await getRedis().hdel(key, ...gone);

    const locationId = await inventoryService.getDefaultLocationId(prisma, storeId);
    const stock = await inventoryService.getTotals(prisma, storeId, [...byId.keys()], locationId);

    let subtotalCents = 0;
    const items: CartItemView[] = [];
    for (const [id, product] of byId) {
      const quantity = Number(raw[id]);
      const unitPrice = Number(product.price.toString());
      const lineCents = Math.round(unitPrice * 100) * quantity;
      subtotalCents += lineCents;
      items.push({
        id,
        productId: id,
        title: product.title,
        imageUrl: product.images[0] ?? null,
        quantity,
        unitPrice,
        lineTotal: lineCents / 100,
        availableStock: stock.get(id) ?? 0,
      });
    }
    return { items, subtotal: subtotalCents / 100 };
  },

  /** Adds to the existing quantity. Rejects if the total would exceed available stock. */
  async addItem(storeId: string, owner: CartOwner, productId: string, quantity: number): Promise<CartView> {
    await resolveProduct(storeId, productId);
    const key = cartKey(storeId, owner);
    const current = Number((await getRedis().hget(key, productId)) ?? 0);
    const wanted = current + quantity;

    const available = await availableFor(storeId, productId);
    if (wanted > available) {
      throw Errors.insufficientStock(`Only ${available} in stock; you already have ${current} in your cart`);
    }

    await getRedis().hset(key, productId, wanted);
    await touch(key);
    return this.get(storeId, owner);
  },

  /** Sets an exact quantity. */
  async setQuantity(storeId: string, owner: CartOwner, productId: string, quantity: number): Promise<CartView> {
    const key = cartKey(storeId, owner);
    if ((await getRedis().hexists(key, productId)) === 0) throw Errors.notFound("Cart item");

    const available = await availableFor(storeId, productId);
    if (quantity > available) {
      throw Errors.insufficientStock(`Only ${available} in stock`);
    }

    await getRedis().hset(key, productId, quantity);
    await touch(key);
    return this.get(storeId, owner);
  },

  async removeItem(storeId: string, owner: CartOwner, productId: string): Promise<CartView> {
    const key = cartKey(storeId, owner);
    await getRedis().hdel(key, productId);
    return this.get(storeId, owner);
  },

  async clear(key: string): Promise<void> {
    await getRedis().del(key);
  },
};
