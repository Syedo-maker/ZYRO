import { prisma, PrismaTx } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";

type Db = PrismaTx | typeof prisma;

export interface DeductItem {
  productId: string;
  quantity: number;
}

/**
 * The only code that changes stock. Both sales channels (online checkout, POS) go through
 * here, and every change writes a StockMovement row, so InventoryLevel.quantity is always
 * explainable from the ledger.
 */
export const inventoryService = {
  async getDefaultLocationId(db: Db, tenantId: string): Promise<string> {
    const location = await db.location.findFirst({ where: { tenantId, isDefault: true } });
    if (!location) throw Errors.notFound("Default location");
    return location.id;
  },

  /** Creates the tenant's default location. Called once, from registration. */
  async createDefaultLocation(db: Db, tenantId: string): Promise<string> {
    const location = await db.location.create({
      data: { tenantId, name: "Main Store", isDefault: true },
    });
    return location.id;
  },

  /** Total on-hand per product across all of the tenant's locations. Missing = 0. */
  async getTotals(db: Db, tenantId: string, productIds: string[]): Promise<Map<string, number>> {
    const totals = new Map<string, number>(productIds.map((id) => [id, 0]));
    if (productIds.length === 0) return totals;
    const rows = await db.inventoryLevel.groupBy({
      by: ["productId"],
      where: { tenantId, productId: { in: productIds } },
      _sum: { quantity: true },
    });
    for (const row of rows) totals.set(row.productId, row._sum.quantity ?? 0);
    return totals;
  },

  /**
   * Sets the on-hand quantity at a location to an exact target (initial stock, a stock
   * count, a merchant edit). Records the difference as a movement. No-op if unchanged.
   */
  async setQuantity(
    tx: PrismaTx,
    args: {
      tenantId: string;
      locationId: string;
      productId: string;
      target: number;
      type: "INITIAL" | "ADJUSTMENT";
      userId?: string;
      note?: string;
    }
  ): Promise<void> {
    const { tenantId, locationId, productId, target } = args;
    const existing = await tx.inventoryLevel.findFirst({ where: { tenantId, locationId, productId } });

    if (!existing) {
      await tx.inventoryLevel.create({ data: { tenantId, locationId, productId, quantity: target } });
      if (target !== 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            locationId,
            productId,
            type: "INITIAL",
            quantityChange: target,
            quantityAfter: target,
            createdByUserId: args.userId,
            note: args.note,
          },
        });
      }
      return;
    }

    const change = target - existing.quantity;
    if (change === 0) return;

    await tx.inventoryLevel.updateMany({
      where: { tenantId, locationId, productId },
      data: { quantity: target },
    });
    await tx.stockMovement.create({
      data: {
        tenantId,
        locationId,
        productId,
        type: args.type === "INITIAL" ? "ADJUSTMENT" : args.type,
        quantityChange: change,
        quantityAfter: target,
        createdByUserId: args.userId,
        note: args.note,
      },
    });
  },

  /**
   * Deducts sold quantities. The decrement is a single conditional UPDATE
   * (`quantity >= n`), so two sales racing for the last unit cannot both succeed:
   * whichever statement runs second matches zero rows and the whole transaction rolls back.
   * Items are processed in productId order so concurrent multi-item sales lock rows in the
   * same order and cannot deadlock each other.
   */
  async deduct(
    tx: PrismaTx,
    args: { tenantId: string; locationId: string; orderId: string; items: DeductItem[]; userId?: string }
  ): Promise<void> {
    const { tenantId, locationId, orderId } = args;
    const merged = new Map<string, number>();
    for (const item of args.items) {
      merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
    }
    const ordered = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

    for (const [productId, quantity] of ordered) {
      const { count } = await tx.inventoryLevel.updateMany({
        where: { tenantId, locationId, productId, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      });
      if (count === 0) {
        throw Errors.insufficientStock(`Not enough stock for product ${productId}`);
      }

      const level = await tx.inventoryLevel.findFirst({ where: { tenantId, locationId, productId } });
      await tx.stockMovement.create({
        data: {
          tenantId,
          locationId,
          productId,
          type: "SALE",
          quantityChange: -quantity,
          quantityAfter: level?.quantity ?? 0,
          orderId,
          createdByUserId: args.userId,
        },
      });
    }
  },
};
