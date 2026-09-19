import { Prisma } from "@prisma/client";
import { Product } from "../../models/Product.model";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { posCatalogService } from "./catalog.service";
import type { ManualDiscount } from "./pos.validation";

const MAX_HELD_SALES = 50;

interface StoredItem {
  productId: string;
  quantity: number;
}

type HeldRow = Prisma.HeldSaleGetPayload<object>;

async function toView(tenantId: string, rows: HeldRow[]) {
  const productIds = [...new Set(rows.flatMap((r) => (r.items as unknown as StoredItem[]).map((i) => i.productId)))];
  const products = productIds.length
    ? await Product.find({ storeId: tenantId, _id: { $in: productIds.filter((id) => /^[a-f0-9]{24}$/i.test(id)) } })
    : [];
  const titleById = new Map(products.map((p) => [p._id.toString(), p.title]));

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((c): c is string => !!c))];
  const customers = customerIds.length ? await prisma.customer.findMany({ where: { tenantId, id: { in: customerIds } } }) : [];
  const customerById = new Map(customers.map((c) => [c.id, c.name || c.email || c.phone]));

  const cashiers = await prismaUnscoped.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.cashierUserId))] } },
    select: { id: true, name: true, email: true },
  });
  const cashierById = new Map(cashiers.map((u) => [u.id, u.name || u.email]));

  return rows.map((r) => {
    const items = (r.items as unknown as StoredItem[]).map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      title: titleById.get(i.productId) ?? "Item no longer in the catalog",
    }));
    return {
      id: r.id,
      label: r.label,
      customerId: r.customerId,
      customerName: r.customerId ? (customerById.get(r.customerId) ?? null) : null,
      cashierName: cashierById.get(r.cashierUserId) ?? null,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      items,
      discount: r.discount as unknown as (ManualDiscount & { type: string }) | null,
      createdAt: r.createdAt,
    };
  });
}

/** Parked carts. They hold no prices and no stock, so resuming always re-prices from the catalog. */
export const heldSaleService = {
  async create(
    tenantId: string,
    userId: string,
    input: { items: StoredItem[]; discount?: ManualDiscount | null; customerId?: string; label?: string }
  ) {
    if ((await prisma.heldSale.count({ where: { tenantId } })) >= MAX_HELD_SALES) {
      throw Errors.conflict(`There are already ${MAX_HELD_SALES} held sales; finish or discard some first`);
    }
    if (input.customerId) await posCatalogService.requireCustomer(prisma, tenantId, input.customerId);
    const row = await prisma.heldSale.create({
      data: {
        tenantId,
        cashierUserId: userId,
        label: input.label,
        customerId: input.customerId,
        items: input.items as unknown as Prisma.InputJsonValue,
        discount: input.discount
          ? ({ type: input.discount.type.toLowerCase(), value: input.discount.value, reason: input.discount.reason } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    return (await toView(tenantId, [row]))[0];
  },

  async list(tenantId: string) {
    const rows = await prisma.heldSale.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: MAX_HELD_SALES });
    return toView(tenantId, rows);
  },

  /** Returns the parked cart and removes it in one step, so two registers cannot both resume it. */
  async resume(tenantId: string, heldId: string) {
    const row = await prisma.heldSale.findFirst({ where: { id: heldId, tenantId } });
    if (!row) throw Errors.notFound("Held sale");
    const { count } = await prisma.heldSale.deleteMany({ where: { id: heldId, tenantId } });
    if (count === 0) throw Errors.notFound("Held sale");
    return (await toView(tenantId, [row]))[0];
  },

  async discard(tenantId: string, heldId: string) {
    const { count } = await prisma.heldSale.deleteMany({ where: { id: heldId, tenantId } });
    if (count === 0) throw Errors.notFound("Held sale");
  },
};
