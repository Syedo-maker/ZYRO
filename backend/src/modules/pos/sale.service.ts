import { Prisma } from "@prisma/client";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { hasStorePermission } from "../../lib/permissions";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { createOrder, priceFromCatalog, OrderSnapshot } from "../commerce/order.service";
import { calculateTotals } from "../commerce/pricing.service";
import { discountService, type ResolvedDiscount } from "../discounts/discount.service";
import { orderInclude, toOrderView } from "../orders/order.presenter";
import { posCatalogService } from "./catalog.service";
import { shiftService, toCents } from "./shift.service";
import type { CreateSaleInput, ListSalesQuery, ManualDiscount } from "./pos.validation";

/** The order plus what a receipt needs: the store's name, the cashier, and the change given. */
async function presentSale(tenantId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId, channel: "POS" },
    include: orderInclude,
  });
  if (!order) throw Errors.notFound("Sale");
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, currency: true } });
  const cashier = order.cashierUserId
    ? await prismaUnscoped.user.findUnique({ where: { id: order.cashierUserId }, select: { id: true, name: true, email: true } })
    : null;
  const view = toOrderView(order);
  const changeDue = view.payments.reduce((sum, p) => sum + (p.changeGiven ?? 0), 0);
  return {
    ...view,
    store: { name: tenant?.name ?? "", currency: tenant?.currency ?? order.currency },
    cashier: cashier ? { id: cashier.id, name: cashier.name || cashier.email } : null,
    changeDue: Number(changeDue.toFixed(2)),
  };
}

export const saleService = {
  presentSale,

  /**
   * Prices a cart exactly as a sale would be charged and checks the manual discount against
   * the cashier's limit. The register calls this on every cart change, so the totals on
   * screen and the amount charged can never disagree.
   */
  async quote(
    tenantId: string,
    userId: string,
    items: { productId: string; quantity: number }[],
    discount?: ManualDiscount | null,
    discountCode?: string
  ) {
    if (discount && discountCode) throw Errors.validation("Use either a discount code or a manual discount, not both");
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Errors.notFound("Store");
    if (discount?.type === "PERCENTAGE" && discount.value > 100) {
      throw Errors.validation("A percentage discount cannot be more than 100");
    }

    let priced: OrderSnapshot = await priceFromCatalog(
      { tenantId, items, discount: discount ? { type: discount.type, value: discount.value } : null },
      Number(tenant.taxRate.toString())
    );

    // A store code is set by the merchant, so it is not held to the cashier's manual-discount
    // limit; it must still pass its own rules (active, unexpired, under its limit, minimum spend).
    let code: ResolvedDiscount | null = null;
    if (discountCode) {
      code = await discountService.resolve(prisma, tenantId, discountCode, toCents(priced.totals.subtotal));
      priced = {
        lines: priced.lines,
        totals: calculateTotals({
          lines: priced.lines,
          discount: { type: code.type, value: code.value },
          taxRatePercent: Number(tenant.taxRate.toString()),
        }),
      };
    }

    const subtotalCents = toCents(priced.totals.subtotal);
    const discountCents = toCents(priced.totals.discountAmount);
    const discountPercent = subtotalCents > 0 ? Number(((discountCents / subtotalCents) * 100).toFixed(2)) : 0;
    if (discount && discountCents > 0) {
      const limit = Number(tenant.posMaxDiscountPercent.toString());
      // Compared in cents with the same rounding the pricing uses, so a discount of exactly
      // the limit is never refused by a half-cent (5% of 50.50 is 2.53, not 2.525).
      const limitCents = Math.round((subtotalCents * Math.round(limit * 100)) / 10000);
      if (discountCents > limitCents && !(await hasStorePermission(userId, tenantId, "DISCOUNTS_WRITE"))) {
        throw Errors.forbidden(
          `This discount is ${discountPercent}% of the sale. Cashiers may give up to ${limit}%; ask the owner or a manager with the discounts permission.`
        );
      }
    }

    const locationId = await inventoryService.getDefaultLocationId(prisma, tenantId);
    const stock = await inventoryService.getTotals(prisma, tenantId, [...new Set(items.map((i) => i.productId))], locationId);
    const wanted = new Map<string, number>();
    for (const i of items) wanted.set(i.productId, (wanted.get(i.productId) ?? 0) + i.quantity);
    const shortages = [...wanted.entries()]
      .filter(([id, qty]) => (stock.get(id) ?? 0) < qty)
      .map(([productId, quantity]) => ({ productId, requested: quantity, available: stock.get(productId) ?? 0 }));

    const t = priced.totals;
    return {
      priced,
      code,
      view: {
        currency: tenant.currency,
        taxRate: Number(tenant.taxRate.toString()),
        lines: priced.lines.map((l, i) => ({
          productId: l.productId,
          title: l.title,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          taxable: l.taxable,
          lineTotal: Number(t.lineTotals[i]),
        })),
        subtotal: Number(t.subtotal),
        discountAmount: Number(t.discountAmount),
        discountCode: code?.code ?? null,
        discountPercent,
        taxAmount: Number(t.taxAmount),
        total: Number(t.total),
        shortages,
      },
    };
  },

  async create(tenantId: string, userId: string, input: CreateSaleInput) {
    const existing = input.clientRequestId
      ? await prisma.order.findFirst({ where: { tenantId, clientRequestId: input.clientRequestId }, select: { id: true } })
      : null;
    if (existing) return { sale: await presentSale(tenantId, existing.id), replayed: true };

    const shift = await shiftService.getOpen(prisma, tenantId);
    if (!shift) throw Errors.conflict("Open a shift (count the starting cash) before selling");

    const { priced, view, code } = await this.quote(tenantId, userId, input.items, input.discount, input.discountCode);
    if (view.shortages.length > 0) {
      const s = view.shortages[0];
      throw Errors.insufficientStock(
        `Not enough stock for ${priced.lines.find((l) => l.productId === s.productId)?.title ?? "an item"}: ${s.available} available, ${s.requested} requested`
      );
    }
    const totalCents = priced.totals.totalCents;
    if (totalCents <= 0) throw Errors.validation("There is nothing to charge on this sale");

    const paidCents = input.payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
    if (paidCents !== totalCents) {
      throw Errors.validation(`Payments (${(paidCents / 100).toFixed(2)}) must add up to the total (${priced.totals.total})`);
    }
    for (const p of input.payments) {
      if (p.method !== "CASH" && p.tendered !== undefined) {
        throw Errors.validation("Only a cash payment has a tendered amount");
      }
      if (p.method === "CASH" && p.tendered !== undefined && Math.round(p.tendered * 100) < Math.round(p.amount * 100)) {
        throw Errors.validation("The cash handed over is less than the cash payment");
      }
    }

    try {
      const orderId = await prisma.$transaction(async (tx) => {
        // Share-locks the shift so closing the drawer waits for this sale (and counts it).
        await shiftService.lockOpenForSale(tx, tenantId, shift.id);

        let customerId: string | undefined;
        if (input.customerId) customerId = (await posCatalogService.requireCustomer(tx, tenantId, input.customerId)).id;
        else if (input.customer) customerId = (await posCatalogService.upsertCustomer(tx, tenantId, input.customer)).id;

        const order = await createOrder(
          {
            tenantId,
            channel: "POS",
            locationId: shift.locationId,
            cashierUserId: userId,
            shiftId: shift.id,
            discountReason: input.discount?.reason ?? (code ? `Code ${code.code}` : undefined),
            // Counted inside the sale itself: if the code stopped being usable meanwhile, the sale is refused.
            discountCodeId: code?.codeId,
            redeem: "strict",
            clientRequestId: input.clientRequestId,
            customerId,
            snapshot: priced,
            payments: input.payments.map((p) => ({
              method: p.method,
              amount: p.amount,
              tenderedAmount: p.method === "CASH" ? (p.tendered ?? p.amount) : undefined,
            })),
          },
          tx
        );
        return order.id;
      });
      return { sale: await presentSale(tenantId, orderId), replayed: false };
    } catch (err) {
      // Two identical submissions raced: the loser hits the unique key and gets the winner's sale.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && input.clientRequestId) {
        const winner = await prisma.order.findFirst({ where: { tenantId, clientRequestId: input.clientRequestId }, select: { id: true } });
        if (winner) return { sale: await presentSale(tenantId, winner.id), replayed: true };
      }
      throw err;
    }
  },

  async list(tenantId: string, q: ListSalesQuery) {
    const where: Prisma.OrderWhereInput = { tenantId, channel: "POS" };
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.q) {
      const asNumber = /^\d+$/.test(q.q) ? Number(q.q) : null;
      where.OR = [
        ...(asNumber !== null ? [{ orderNumber: asNumber }] : []),
        { customer: { is: { email: { contains: q.q, mode: "insensitive" as const } } } },
        { customer: { is: { name: { contains: q.q, mode: "insensitive" as const } } } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: "desc" }, skip: q.offset, take: q.limit }),
      prisma.order.count({ where }),
    ]);
    return { data: rows.map(toOrderView), pagination: { total, limit: q.limit, offset: q.offset } };
  },
};
