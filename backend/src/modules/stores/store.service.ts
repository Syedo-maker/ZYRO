import { prisma, prismaUnscoped } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { planService } from "../billing/plan.service";
import type { UpdateBrandingInput, UpdateCurrencyInput, UpdateDomainInput } from "./store.validation";

const toPublicProfile = (t: { id: string; name: string; slug: string; logoUrl: string | null; themeColor: string | null; currency: string }) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  logoUrl: t.logoUrl,
  themeColor: t.themeColor,
  currency: t.currency,
});

export const storeService = {
  async getPublicProfile(storeId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
    if (!tenant) throw Errors.notFound("Store");
    return toPublicProfile(tenant);
  },

  async updateBranding(storeId: string, input: UpdateBrandingInput) {
    const tenant = await prisma.tenant.update({ where: { id: storeId }, data: input });
    return toPublicProfile(tenant);
  },

  /**
   * Whether the store's currency can still be changed, and why not. It is locked once the store has
   * sold anything (online or at the register) or a shopper is part-way through paying: orders,
   * refunds and reports are recorded in the currency they were taken in, and prices are stored as
   * plain numbers, so switching later would turn a $12 product into Rs 12 without anyone noticing.
   */
  async currencyLock(storeId: string): Promise<{ locked: boolean; reason: string | null }> {
    const [order, pending] = await Promise.all([
      prismaUnscoped.order.findFirst({ where: { tenantId: storeId }, select: { id: true } }),
      prismaUnscoped.checkoutSession.findFirst({ where: { tenantId: storeId, status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true } }),
    ]);
    if (order) return { locked: true, reason: "The currency cannot be changed after the store's first sale, because past orders and reports are in the current currency." };
    if (pending) return { locked: true, reason: "A shopper is paying for an order right now; try again in half an hour." };
    return { locked: false, reason: null };
  },

  async updateCurrency(storeId: string, input: UpdateCurrencyInput) {
    const current = await prisma.tenant.findUnique({ where: { id: storeId }, select: { currency: true } });
    if (!current) throw Errors.notFound("Store");
    if (current.currency !== input.currency) {
      const lock = await this.currencyLock(storeId);
      if (lock.locked) throw Errors.conflict(lock.reason!);
    }
    const tenant = await prisma.tenant.update({ where: { id: storeId }, data: { currency: input.currency } });
    return { ...toPublicProfile(tenant), currencyLocked: (await this.currencyLock(storeId)).locked };
  },

  /**
   * Sets or clears the store's custom domain. Setting one needs a plan that includes it (Business);
   * clearing one is always allowed, so a store that lapses to Free can still remove its domain.
   * Only the name is stored: serving the storefront on that domain is not built yet.
   */
  async updateDomain(storeId: string, input: UpdateDomainInput) {
    if (input.customDomain !== null) await planService.assertCustomDomainAllowed(storeId);
    try {
      const tenant = await prisma.tenant.update({ where: { id: storeId }, data: { customDomain: input.customDomain } });
      return { customDomain: tenant.customDomain };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw Errors.conflict("That domain is already used by another store");
      throw err;
    }
  },
};
