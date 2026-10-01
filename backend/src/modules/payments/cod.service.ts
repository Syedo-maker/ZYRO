import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { paymentsService } from "./payments.service";
import { parseRemittanceCsv, reconcile, RemittanceFileError, type ItemStatus } from "./remittance.csv";
import type { CodOutcomeInput, ImportRemittanceInput } from "./payments.validation";

/**
 * Cash on delivery after the order is placed (Part E): the merchant records what the courier came
 * back with, and reconciles a courier's cash file against their own orders.
 *
 * Nothing here is automatic. A COD payment becomes SUCCEEDED only when a person says the cash was
 * collected, and reconciling a file reports what it found without changing a single payment: a
 * courier's spreadsheet is evidence, not authority, and a wrong line in it must never mark an order
 * paid on its own.
 */

const money = (n: { toString(): string }) => Number(n.toString());

export const codService = {
  /** The store's COD orders still waiting for the courier's cash. */
  async pending(tenantId: string) {
    const orders = await prisma.order.findMany({
      where: { tenantId, status: "PENDING", payments: { some: { method: "COD", status: "PENDING" } } },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { codAssessment: true },
    });
    return orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      total: money(o.total),
      currency: o.currency,
      placedAt: o.createdAt,
      shippingName: o.shippingName,
      /** Why the Trust Agent scored it as it did; a merchant can always see the reasoning. */
      risk: o.codAssessment
        ? { score: o.codAssessment.score, band: o.codAssessment.band, reasons: o.codAssessment.reasons, outcome: o.codAssessment.outcome }
        : null,
    }));
  },

  /**
   * The merchant records how a cash delivery ended. "collected" takes the payment to SUCCEEDED and
   * the order to COMPLETED; "refused" cancels the order and puts the stock back. Either way the
   * outcome is added to the platform-wide count for that phone number, as a count and nothing else.
   */
  async recordOutcome(tenantId: string, orderId: string, input: CodOutcomeInput) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: { payments: { where: { method: "COD" } }, items: true },
      });
      if (!order) throw Errors.notFound("Order");
      if (order.payments.length === 0) throw Errors.validation("This is not a cash-on-delivery order.");
      if (order.payments.every((p) => p.status !== "PENDING")) throw Errors.conflict("This cash delivery has already been settled.");

      if (input.outcome === "collected") {
        const total = money(order.total);
        // The courier must hand over the order's full amount: a part payment is not a settled order,
        // and silently accepting one would leave the books wrong.
        if (input.amount !== undefined && Math.round(input.amount * 100) !== Math.round(total * 100)) {
          throw Errors.validation(`The cash collected must be the order total, ${order.currency} ${total.toFixed(2)}.`);
        }
        await tx.payment.updateMany({ where: { orderId: order.id, tenantId, method: "COD", status: "PENDING" }, data: { status: "SUCCEEDED" } });
        await tx.order.updateMany({ where: { id: order.id, tenantId }, data: { status: "COMPLETED" } });
      } else {
        await tx.payment.updateMany({ where: { orderId: order.id, tenantId, method: "COD", status: "PENDING" }, data: { status: "FAILED" } });
        await tx.order.updateMany({ where: { id: order.id, tenantId }, data: { status: "CANCELLED" } });
        // The parcel came back, so the goods are the store's again.
        await restock(tx, tenantId, order.id, order.items);
      }

      await paymentsService.recordCodOutcome(tx, tenantId, order.id, input.outcome === "collected" ? "delivered" : "refused");
      return { orderId: order.id, orderNumber: order.orderNumber, outcome: input.outcome };
    });
  },

  /**
   * Reconciles a courier's cash file against the store's COD orders. Reports only: no payment and no
   * order is changed by importing a file.
   */
  async importRemittance(tenantId: string, userId: string, input: ImportRemittanceInput) {
    let parsed;
    try {
      parsed = parseRemittanceCsv(input.csv);
    } catch (err) {
      if (err instanceof RemittanceFileError) throw Errors.validation(err.message);
      throw err;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
    if (!tenant) throw Errors.notFound("Store");

    const numbers = [...new Set(parsed.rows.map((r) => Number(r.reference.match(/\d+/g)?.reduce((a, b) => (b.length >= a.length ? b : a)) ?? 0)).filter((n) => n > 0))];
    const orders = await prisma.order.findMany({
      where: { tenantId, orderNumber: { in: numbers } },
      select: { id: true, orderNumber: true, total: true, payments: { select: { method: true } } },
    });

    const items = reconcile(
      parsed.rows,
      orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, total: money(o.total), isCod: o.payments.some((p) => p.method === "COD") })),
      tenant.currency
    );

    const matched = items.filter((i) => i.status === "matched");
    const run = await prisma.codRemittanceRun.create({
      data: {
        tenantId,
        courier: input.courier,
        fileName: input.fileName ?? null,
        rowCount: items.length,
        matchedCount: matched.length,
        problemCount: items.length - matched.length,
        fileTotal: items.reduce((s, i) => s + i.amount, 0).toFixed(2),
        matchedTotal: matched.reduce((s, i) => s + i.amount, 0).toFixed(2),
        importedByUserId: userId,
        items: {
          create: items.map((i) => ({
            tenantId,
            reference: i.reference,
            amount: i.amount.toFixed(2),
            orderId: i.orderId,
            status: i.status,
            detail: i.detail,
          })),
        },
      },
      include: { items: true },
    });

    return presentRun(run, parsed.referenceColumn, parsed.amountColumn);
  },

  async listRuns(tenantId: string) {
    const runs = await prisma.codRemittanceRun.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 });
    return runs.map((r) => ({
      id: r.id,
      courier: r.courier,
      fileName: r.fileName,
      rowCount: r.rowCount,
      matchedCount: r.matchedCount,
      problemCount: r.problemCount,
      fileTotal: money(r.fileTotal),
      matchedTotal: money(r.matchedTotal),
      createdAt: r.createdAt,
    }));
  },

  async getRun(tenantId: string, runId: string) {
    const run = await prisma.codRemittanceRun.findFirst({ where: { id: runId, tenantId }, include: { items: { orderBy: { id: "asc" } } } });
    if (!run) throw Errors.notFound("Reconciliation run");
    return presentRun(run);
  },
};

type RunRow = Prisma.CodRemittanceRunGetPayload<{ include: { items: true } }>;

function presentRun(run: RunRow, referenceColumn?: string, amountColumn?: string) {
  const byStatus = run.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {});
  return {
    id: run.id,
    courier: run.courier,
    fileName: run.fileName,
    rowCount: run.rowCount,
    matchedCount: run.matchedCount,
    problemCount: run.problemCount,
    fileTotal: money(run.fileTotal),
    matchedTotal: money(run.matchedTotal),
    byStatus: byStatus as Partial<Record<ItemStatus, number>>,
    ...(referenceColumn ? { readColumns: { reference: referenceColumn, amount: amountColumn } } : {}),
    items: run.items.map((i) => ({
      reference: i.reference,
      amount: money(i.amount),
      orderId: i.orderId,
      status: i.status as ItemStatus,
      detail: i.detail,
    })),
    createdAt: run.createdAt,
  };
}

/** Puts a refused parcel's goods back on the shelf, through the same path a return uses. */
async function restock(tx: PrismaTx, tenantId: string, orderId: string, items: { productId: string; quantity: number }[]) {
  const locationId = await inventoryService.getDefaultLocationId(tx, tenantId);
  await inventoryService.restock(tx, { tenantId, locationId, orderId, items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) });
}
