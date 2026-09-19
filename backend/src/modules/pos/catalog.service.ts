import { Product } from "../../models/Product.model";
import { prisma, PrismaTx } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { customerService } from "../customers/customer.service";
import type { CustomerInput } from "./pos.validation";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toCustomerView = (c: { id: string; name: string | null; email: string | null; phone: string | null }) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
});

/** Product and customer lookup for the register. */
export const posCatalogService = {
  /**
   * Finds products by what a cashier has: a scanned barcode or SKU (exact), or part of a
   * title. Returns on-hand stock at the store's location so the register can warn before
   * the customer is at the counter with something that is not there.
   */
  async searchProducts(tenantId: string, query: { q?: string; code?: string; limit: number }) {
    const filter: Record<string, unknown> = { storeId: tenantId };
    if (query.code) {
      filter.$or = [{ barcode: query.code }, { sku: query.code }];
    } else if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ title: pattern }, { sku: pattern }, { barcode: query.q }];
    }

    const docs = await Product.find(filter).sort({ title: 1 }).limit(query.limit);
    const locationId = await inventoryService.getDefaultLocationId(prisma, tenantId);
    const stock = await inventoryService.getTotals(prisma, tenantId, docs.map((d) => d._id.toString()), locationId);

    return docs.map((d) => ({
      id: d._id.toString(),
      title: d.title,
      price: Number(d.price.toString()),
      taxable: d.taxable !== false,
      sku: d.sku ?? null,
      barcode: d.barcode ?? null,
      category: d.category,
      image: d.images[0] ?? null,
      stock: stock.get(d._id.toString()) ?? 0,
    }));
  },

  async searchCustomers(tenantId: string, q?: string) {
    const rows = await prisma.customer.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map(toCustomerView);
  },

  /** Finds the customer with this email or creates one; without an email, always creates. */
  async upsertCustomer(db: PrismaTx | typeof prisma, tenantId: string, input: CustomerInput) {
    if (!input.name && !input.email && !input.phone) throw Errors.validation("Enter a name, email or phone for the customer");
    const tx = db as PrismaTx;
    let id: string | undefined;
    if (input.email) {
      id = await customerService.findOrCreate(tx, { tenantId, email: input.email, name: input.name, phone: input.phone });
    } else {
      id = (await tx.customer.create({ data: { tenantId, name: input.name, phone: input.phone } })).id;
    }
    const row = await tx.customer.findFirst({ where: { id, tenantId } });
    return toCustomerView(row!);
  },

  async requireCustomer(db: PrismaTx | typeof prisma, tenantId: string, customerId: string) {
    const row = await db.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!row) throw Errors.notFound("Customer");
    return toCustomerView(row);
  },
};
