import { Prisma } from "@prisma/client";
import { prisma, prismaUnscoped, PrismaTx } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";

type Db = PrismaTx | typeof prisma;

export const toCents = (d: Prisma.Decimal | number | string | null | undefined) =>
  d === null || d === undefined ? 0 : Math.round(Number(d.toString()) * 100);
export const money = (cents: number) => Number((cents / 100).toFixed(2));

export interface ShiftTotals {
  salesCount: number;
  grossSales: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  refundsTotal: number;
  cashRefunds: number;
  /** Cash that should be in the drawer: float + cash sales - cash paid back. */
  expectedCash: number;
}

/**
 * What one shift took and paid back so far. Cash counts only the part that paid for the
 * sale (change handed back is not in `Payment.amount`), and cash refunds and returns come
 * out of the drawer, so `expectedCash` is what a correct drawer holds.
 */
export async function computeShiftTotals(db: Db, tenantId: string, shiftId: string, openingFloatCents: number): Promise<ShiftTotals> {
  const [payments, orders, refunds, returns] = await Promise.all([
    db.payment.findMany({
      where: { tenantId, order: { is: { shiftId } }, status: { in: ["SUCCEEDED", "REFUNDED"] } },
      select: { method: true, amount: true },
    }),
    db.order.aggregate({
      where: { tenantId, shiftId, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.refund.findMany({ where: { tenantId, shiftId }, select: { method: true, amount: true } }),
    db.orderReturn.findMany({ where: { tenantId, shiftId }, select: { method: true, amount: true } }),
  ]);

  const byMethod = (m: string) => payments.filter((p) => p.method === m).reduce((s, p) => s + toCents(p.amount), 0);
  const paidBack = [...refunds, ...returns];
  const cashRefunds = paidBack.filter((r) => r.method === "CASH").reduce((s, r) => s + toCents(r.amount), 0);
  const refundsTotal = paidBack.reduce((s, r) => s + toCents(r.amount), 0);
  const cashSales = byMethod("CASH");

  return {
    salesCount: orders._count._all,
    grossSales: money(toCents(orders._sum.total)),
    cashSales: money(cashSales),
    cardSales: money(byMethod("CARD")),
    otherSales: money(byMethod("OTHER")),
    refundsTotal: money(refundsTotal),
    cashRefunds: money(cashRefunds),
    expectedCash: money(openingFloatCents + cashSales - cashRefunds),
  };
}

async function userNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  // User is a global table; this only resolves names for users already tied to this store's shifts.
  const users = await prismaUnscoped.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

type ShiftRow = Prisma.PosShiftGetPayload<object>;

export async function toShiftView(db: Db, shift: ShiftRow) {
  const totals = await computeShiftTotals(db, shift.tenantId, shift.id, toCents(shift.openingFloat));
  const names = await userNames([shift.openedByUserId, shift.closedByUserId]);
  return {
    id: shift.id,
    status: shift.status.toLowerCase(),
    locationId: shift.locationId,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    openedBy: { id: shift.openedByUserId, name: names.get(shift.openedByUserId) ?? null },
    closedBy: shift.closedByUserId ? { id: shift.closedByUserId, name: names.get(shift.closedByUserId) ?? null } : null,
    openingFloat: Number(shift.openingFloat.toString()),
    // Frozen at close; live while the shift is open.
    expectedCash: shift.expectedCash === null ? totals.expectedCash : Number(shift.expectedCash.toString()),
    countedCash: shift.countedCash === null ? null : Number(shift.countedCash.toString()),
    variance: shift.variance === null ? null : Number(shift.variance.toString()),
    note: shift.note,
    totals,
  };
}

export const shiftService = {
  async getOpen(db: Db, tenantId: string, locationId?: string): Promise<ShiftRow | null> {
    const location = locationId ?? (await inventoryService.getDefaultLocationId(db, tenantId));
    return db.posShift.findFirst({ where: { tenantId, locationId: location, status: "OPEN" } });
  },

  async current(tenantId: string) {
    const shift = await this.getOpen(prisma, tenantId);
    return shift ? toShiftView(prisma, shift) : null;
  },

  async open(tenantId: string, userId: string, openingFloat: number) {
    const locationId = await inventoryService.getDefaultLocationId(prisma, tenantId);
    try {
      const shift = await prisma.posShift.create({
        data: { tenantId, locationId, openedByUserId: userId, openingFloat: openingFloat.toFixed(2) },
      });
      return toShiftView(prisma, shift);
    } catch (err) {
      // The partial unique index allows one open shift per location, even for two requests at once.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict("A shift is already open at this register; close it before opening another");
      }
      throw err;
    }
  },

  /**
   * Counts the drawer and closes the shift. Only the person who opened it, or the owner,
   * may close it. The status flip runs first and takes the row lock, so sales that were
   * already in flight finish (they hold a share lock on the shift) and are counted, and
   * any sale that starts afterwards is refused because the shift is no longer open.
   */
  async close(tenantId: string, userId: string, isOwner: boolean, input: { countedCash: number; note?: string }) {
    const open = await this.getOpen(prisma, tenantId);
    if (!open) throw Errors.conflict("There is no open shift to close");
    if (!isOwner && open.openedByUserId !== userId) {
      throw Errors.forbidden("Only the person who opened the shift, or the store owner, can close it");
    }

    const closed = await prisma.$transaction(async (tx) => {
      const claim = await tx.posShift.updateMany({
        where: { id: open.id, tenantId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date(), closedByUserId: userId },
      });
      if (claim.count === 0) throw Errors.conflict("This shift was already closed");

      const totals = await computeShiftTotals(tx, tenantId, open.id, toCents(open.openingFloat));
      const expectedCents = Math.round(totals.expectedCash * 100);
      const countedCents = Math.round(input.countedCash * 100);
      await tx.posShift.updateMany({
        where: { id: open.id, tenantId },
        data: {
          expectedCash: (expectedCents / 100).toFixed(2),
          countedCash: (countedCents / 100).toFixed(2),
          variance: ((countedCents - expectedCents) / 100).toFixed(2),
          note: input.note,
        },
      });
      const row = await tx.posShift.findFirst({ where: { id: open.id, tenantId } });
      return row!;
    });
    return toShiftView(prisma, closed);
  },

  /** Takes a share lock on the shift so it cannot close underneath a sale being written. */
  async lockOpenForSale(tx: PrismaTx, tenantId: string, shiftId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PosShift" WHERE "id" = ${shiftId} AND "tenantId" = ${tenantId} AND "status" = 'OPEN' FOR SHARE`;
    if (rows.length === 0) throw Errors.conflict("The shift was closed; open a new shift to keep selling");
  },
};
