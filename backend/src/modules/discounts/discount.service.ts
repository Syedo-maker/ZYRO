import { Prisma } from "@prisma/client";
import { prisma, PrismaTx } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { evaluateDiscountCode, normalizeCode, statusOf, type DiscountCodeState } from "./discount.rules";
import type { CreateDiscountInput, UpdateDiscountInput } from "./discount.validation";

type Db = PrismaTx | typeof prisma;
type Row = Prisma.DiscountCodeGetPayload<object>;

const num = (d: Prisma.Decimal) => Number(d.toString());
const cents = (d: Prisma.Decimal | null) => (d === null ? null : Math.round(Number(d.toString()) * 100));

/** A code that passed every rule for a given cart, ready to be applied to its totals. */
export interface ResolvedDiscount {
  codeId: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  discountCents: number;
}

/** Checkouts in progress that will use the code. A session lapses on its own when `expiresAt` passes, so nothing can leak. */
async function reservedCount(db: Db, tenantId: string, codeId: string, now: Date, excludeCartKey?: string) {
  return db.checkoutSession.count({
    where: {
      tenantId,
      discountCodeId: codeId,
      status: "PENDING",
      expiresAt: { gt: now },
      ...(excludeCartKey ? { cartKey: { not: excludeCartKey } } : {}),
    },
  });
}

const stateOf = (row: Row, reserved: number): DiscountCodeState => ({
  type: row.type,
  value: num(row.value),
  active: row.active,
  expiresAt: row.expiresAt,
  minSubtotalCents: cents(row.minSubtotal),
  usageLimit: row.usageLimit,
  usageCount: row.usageCount,
  reserved,
});

const toView = (row: Row, now: Date) => ({
  id: row.id,
  code: row.code,
  type: row.type.toLowerCase(),
  value: num(row.value),
  minSubtotal: row.minSubtotal === null ? null : num(row.minSubtotal),
  expiresAt: row.expiresAt,
  usageLimit: row.usageLimit,
  usageCount: row.usageCount,
  active: row.active,
  status: statusOf(stateOf(row, 0), now),
  createdAt: row.createdAt,
});

export const discountService = {
  /**
   * Checks a typed code against a cart subtotal and says what it would take off. Throws a
   * 400 with a plain reason when it cannot be used. An unknown code and a wrong-store code
   * look the same (codes are per store), so nothing about other stores leaks.
   * `excludeCartKey` leaves the shopper's own earlier attempt out of the reserved count,
   * so retrying a checkout does not block them with their own abandoned page.
   */
  async resolve(
    db: Db,
    tenantId: string,
    rawCode: string,
    subtotalCents: number,
    opts: { excludeCartKey?: string; now?: Date } = {}
  ): Promise<ResolvedDiscount> {
    const now = opts.now ?? new Date();
    const row = await db.discountCode.findFirst({ where: { tenantId, code: normalizeCode(rawCode) } });
    if (!row) throw Errors.discountInvalid("That discount code is not valid.");

    const reserved = row.usageLimit === null ? 0 : await reservedCount(db, tenantId, row.id, now, opts.excludeCartKey);
    const verdict = evaluateDiscountCode(stateOf(row, reserved), subtotalCents, now);
    if (!verdict.ok) throw Errors.discountInvalid(verdict.message);
    return { codeId: row.id, code: row.code, type: row.type, value: num(row.value), discountCents: verdict.discountCents };
  },

  /**
   * Holds one use of a code for a checkout that is about to be created. Runs in the
   * transaction that creates the CheckoutSession: the code's row is locked first, so two
   * shoppers racing for the last use are handled one after the other and the loser is told
   * the code is used up, instead of both paying for a discount that no longer exists.
   *
   * Counts every currently-held reservation, including this same cart's own (unlike
   * `resolve()`'s read-only preview, this call is the one that actually creates a hold, so it
   * must never exclude anything: a security review found that excluding the caller's own cart
   * key here let one shopper hold a limited code's last use across unlimited parallel, unpaid
   * checkout sessions, since each new one only ever saw OTHER carts' holds. The cart's own
   * earlier holds are superseded before this runs (checkout.service.ts createSession), so a
   * shopper genuinely retrying an abandoned attempt is unaffected; only a second cart or a
   * second concurrent attempt this one doesn't know about is ever really "in the way".
   */
  async assertCanHold(tx: PrismaTx, tenantId: string, codeId: string, subtotalCents: number): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "id" = ${codeId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const row = await tx.discountCode.findFirst({ where: { id: codeId, tenantId } });
    if (!row) throw Errors.discountInvalid("That discount code is not valid.");
    const reserved = row.usageLimit === null ? 0 : await reservedCount(tx, tenantId, codeId, new Date());
    const verdict = evaluateDiscountCode(stateOf(row, reserved), subtotalCents, new Date());
    if (!verdict.ok) throw Errors.discountInvalid(verdict.message);
  },

  /**
   * Counts one use, inside the transaction that writes the order.
   * - `strict` (in-store sales, which are paid on the spot): the same statement that counts
   *   the use also checks the code is still active, unexpired and under its limit
   *   (counting checkouts in progress), so two tills cannot both take the last use. If it
   *   fails the whole sale rolls back.
   * - `honour` (online orders, paid before the order is written): the shopper was already
   *   charged the discounted price, so the order is always recorded and the use counted.
   *   The use was held when the checkout began, so this only exceeds the limit if the
   *   merchant lowered it or switched the code off in the meantime.
   */
  async redeem(tx: PrismaTx, args: { tenantId: string; codeId: string; mode: "strict" | "honour" }): Promise<void> {
    const { tenantId, codeId } = args;
    if (args.mode === "honour") {
      await tx.discountCode.updateMany({ where: { id: codeId, tenantId }, data: { usageCount: { increment: 1 } } });
      return;
    }
    const changed = await tx.$executeRaw`
      UPDATE "DiscountCode" d SET "usageCount" = d."usageCount" + 1
      WHERE d."id" = ${codeId} AND d."tenantId" = ${tenantId}
        AND d."active"
        AND (d."expiresAt" IS NULL OR d."expiresAt" > now())
        AND (d."usageLimit" IS NULL OR d."usageCount" + (
              SELECT count(*) FROM "CheckoutSession" c
              WHERE c."discountCodeId" = d."id" AND c."status" = 'PENDING' AND c."expiresAt" > now()
            ) < d."usageLimit")`;
    if (changed === 0) throw Errors.conflict("This discount code can no longer be used; remove it and try again");
  },

  // ---- Merchant management ----

  async list(tenantId: string) {
    const now = new Date();
    const rows = await prisma.discountCode.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((r) => toView(r, now));
  },

  async create(tenantId: string, input: CreateDiscountInput) {
    try {
      const row = await prisma.discountCode.create({
        data: {
          tenantId,
          code: input.code,
          type: input.type,
          value: input.value.toFixed(2),
          minSubtotal: input.minSubtotal === undefined ? undefined : input.minSubtotal.toFixed(2),
          expiresAt: input.expiresAt,
          usageLimit: input.usageLimit,
          active: input.active,
        },
      });
      return toView(row, new Date());
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict(`A discount code named ${input.code} already exists in this store`);
      }
      throw err;
    }
  },

  async update(tenantId: string, codeId: string, input: UpdateDiscountInput) {
    const existing = await prisma.discountCode.findFirst({ where: { id: codeId, tenantId } });
    if (!existing) throw Errors.notFound("Discount code");
    if (input.usageLimit != null && input.usageLimit < existing.usageCount) {
      throw Errors.validation(`This code has already been used ${existing.usageCount} times; the limit cannot be lower than that`);
    }
    await prisma.discountCode.updateMany({
      where: { id: codeId, tenantId },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        ...(input.minSubtotal !== undefined ? { minSubtotal: input.minSubtotal === null ? null : input.minSubtotal.toFixed(2) } : {}),
      },
    });
    const row = await prisma.discountCode.findFirst({ where: { id: codeId, tenantId } });
    return toView(row!, new Date());
  },

  /** What the storefront calls before checkout: would this code apply to a cart of this size, and for how much? */
  async validate(tenantId: string, rawCode: string, cartTotal: number, cartKey?: string) {
    const resolved = await discountService.resolve(prisma, tenantId, rawCode, Math.round(cartTotal * 100), { excludeCartKey: cartKey });
    return {
      valid: true as const,
      code: resolved.code,
      type: resolved.type.toLowerCase(),
      value: resolved.value,
      discountAmount: resolved.discountCents / 100,
    };
  },
};
