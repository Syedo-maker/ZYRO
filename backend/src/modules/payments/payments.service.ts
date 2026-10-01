import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, prismaUnscoped, type PrismaTx } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { assessCodRisk, bandFor, looksLikePhone, outcomeFor, type CodRiskInputs, type CodRiskResult } from "./cod.risk";

/**
 * The store's payment settings and the COD Trust Agent (Part E). The scoring rules live in
 * cod.risk.ts; this gathers the few facts they are allowed to see and records what was decided.
 */

/** Orders counted when working out what this store's orders usually come to. */
const AVERAGE_WINDOW = 50;
/** A store with fewer paid orders than this has no meaningful average to compare against. */
const MIN_ORDERS_FOR_AVERAGE = 5;

/**
 * A phone number as a one-way hash, so the platform-wide COD signal can count refusals for a number
 * without ever storing one. The pepper is a server secret: without it the hash of a 11-digit
 * Pakistani mobile could be found by trying every number, which would make the table reversible.
 */
export function hashPhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  // The last 10 digits, so 03001234567, +923001234567 and 00923001234567 are one number.
  const national = digits.slice(-10);
  const pepper = process.env.COD_PHONE_PEPPER ?? "zyro-cod-phone-pepper-dev";
  return createHash("sha256").update(`${pepper}:${national}`).digest("hex");
}

export interface CodRiskSubject {
  /** What the order will come to. */
  orderTotal: number;
  itemCount: number;
  phone: string | null;
  shippingName: string | null;
  addressLine1: string | null;
  addressCity: string | null;
  /** Used to find this shopper's earlier orders in this store. */
  customerId: string | null;
  guestEmail: string | null;
}

export const paymentsService = {
  /** The store's payment settings, created with safe defaults the first time they are asked for. */
  async getSettings(tenantId: string) {
    const existing = await prisma.paymentSettings.findFirst({ where: { tenantId } });
    if (existing) return existing;
    try {
      return await prisma.paymentSettings.create({ data: { tenantId } });
    } catch (err) {
      // Two requests created it at once; the unique key keeps one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return (await prisma.paymentSettings.findFirst({ where: { tenantId } }))!;
      }
      throw err;
    }
  },

  async updateSettings(tenantId: string, data: Prisma.PaymentSettingsUpdateManyMutationInput) {
    await paymentsService.getSettings(tenantId);
    await prisma.paymentSettings.updateMany({ where: { tenantId }, data });
    return (await prisma.paymentSettings.findFirst({ where: { tenantId } }))!;
  },

  /**
   * Gathers the facts the COD rules may see, and scores the order. Everything here is either the
   * order's own shape or a count of past deliveries; nothing about who the shopper is.
   */
  async assessCod(tenantId: string, subject: CodRiskSubject): Promise<CodRiskResult & { inputs: CodRiskInputs }> {
    const phoneHash = subject.phone ? hashPhone(subject.phone) : null;

    const [recent, storeHistory, signal] = await Promise.all([
      // What this store's orders usually come to.
      prisma.order.findMany({
        where: { tenantId, status: { notIn: ["CANCELLED"] } },
        select: { total: true },
        orderBy: { createdAt: "desc" },
        take: AVERAGE_WINDOW,
      }),
      codHistoryFor(tenantId, subject),
      phoneHash ? prismaUnscoped.codPhoneSignal.findUnique({ where: { phoneHash } }) : Promise.resolve(null),
    ]);

    const storeAverageOrder =
      recent.length >= MIN_ORDERS_FOR_AVERAGE ? recent.reduce((s, o) => s + Number(o.total.toString()), 0) / recent.length : null;

    const inputs: CodRiskInputs = {
      orderTotal: subject.orderTotal,
      storeAverageOrder,
      itemCount: subject.itemCount,
      hasPhone: Boolean(subject.phone),
      phoneLooksValid: looksLikePhone(subject.phone),
      addressComplete: Boolean(subject.addressLine1 && subject.addressCity && subject.shippingName),
      storeHistory,
      platformHistory: { delivered: signal?.delivered ?? 0, refused: signal?.refused ?? 0 },
    };

    return { ...assessCodRisk(inputs), inputs };
  },

  /** Saves what was decided, so a merchant can always see why. */
  async recordAssessment(tenantId: string, assessment: CodRiskResult & { inputs: CodRiskInputs }, outcome: string, orderId?: string) {
    return prisma.codAssessment.create({
      data: {
        tenantId,
        orderId,
        score: assessment.score,
        band: assessment.band,
        reasons: assessment.reasons as unknown as Prisma.InputJsonValue,
        inputs: assessment.inputs as unknown as Prisma.InputJsonValue,
        outcome,
      },
    });
  },

  /** Decides what checkout should offer for a COD order of this shape. */
  async codOffer(tenantId: string, subject: CodRiskSubject) {
    const settings = await paymentsService.getSettings(tenantId);
    if (!settings.codEnabled) return { available: false as const, reason: "This store does not offer cash on delivery." };

    const min = settings.codMinAmount === null ? null : Number(settings.codMinAmount.toString());
    const max = settings.codMaxAmount === null ? null : Number(settings.codMaxAmount.toString());
    if (min !== null && subject.orderTotal < min) {
      return { available: false as const, reason: `Cash on delivery is for orders of ${min.toFixed(2)} and above.` };
    }
    if (max !== null && subject.orderTotal > max) {
      return { available: false as const, reason: `Cash on delivery is for orders up to ${max.toFixed(2)}.` };
    }

    const assessment = await paymentsService.assessCod(tenantId, subject);
    const outcome = outcomeFor(assessment.band, { codBlockBand: settings.codBlockBand, codAdvancePercent: settings.codAdvancePercent });

    if (outcome === "blocked") {
      // The shopper is never told their score or why: that would teach anyone how to get around it.
      return { available: false as const, reason: "Cash on delivery is not available for this order. Please choose another way to pay.", assessment, outcome };
    }
    if (outcome === "advance_required") {
      const advance = Math.round(((subject.orderTotal * settings.codAdvancePercent) / 100) * 100) / 100;
      return { available: true as const, advanceAmount: advance, reason: `This order needs ${settings.codAdvancePercent}% paid in advance; the rest is paid to the courier.`, assessment, outcome };
    }
    return { available: true as const, advanceAmount: 0, assessment, outcome };
  },

  /**
   * Records how a COD order ended, for the store's own history and for the platform-wide count.
   * Called when a merchant marks the cash collected, or marks the parcel refused.
   */
  async recordCodOutcome(tx: PrismaTx, tenantId: string, orderId: string, outcome: "delivered" | "refused") {
    const order = await tx.order.findFirst({ where: { id: orderId, tenantId }, include: { customer: true } });
    if (!order) throw Errors.notFound("Order");
    const phone = order.customer?.phone ?? (order.shippingAddress as { phone?: string } | null)?.phone ?? null;
    const phoneHash = phone ? hashPhone(phone) : null;
    if (!phoneHash) return;

    // Counts only, and never inside the store's own transaction scoping: this row belongs to no store.
    await prismaUnscoped.codPhoneSignal.upsert({
      where: { phoneHash },
      create: { phoneHash, delivered: outcome === "delivered" ? 1 : 0, refused: outcome === "refused" ? 1 : 0 },
      update: {
        delivered: outcome === "delivered" ? { increment: 1 } : undefined,
        refused: outcome === "refused" ? { increment: 1 } : undefined,
        lastSeenAt: new Date(),
      },
    });
  },
};

/** How this store's own earlier COD orders to this shopper went. */
async function codHistoryFor(tenantId: string, subject: CodRiskSubject): Promise<{ deliveredOrders: number; refusedOrders: number }> {
  const who: Prisma.OrderWhereInput[] = [];
  if (subject.customerId) who.push({ customerId: subject.customerId });
  if (subject.guestEmail) who.push({ guestEmail: subject.guestEmail });
  if (who.length === 0) return { deliveredOrders: 0, refusedOrders: 0 };

  const orders = await prisma.order.findMany({
    where: { tenantId, OR: who, payments: { some: { method: "COD" } } },
    select: { status: true, payments: { where: { method: "COD" }, select: { status: true } } },
    take: 100,
  });

  let deliveredOrders = 0;
  let refusedOrders = 0;
  for (const o of orders) {
    const paid = o.payments.some((p) => p.status === "SUCCEEDED");
    if (paid) deliveredOrders++;
    else if (o.status === "CANCELLED") refusedOrders++;
  }
  return { deliveredOrders, refusedOrders };
}
