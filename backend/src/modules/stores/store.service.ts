import { prisma, prismaUnscoped } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { planService } from "../billing/plan.service";
import { Product } from "../../models/Product.model";
import { MIN_PRODUCTS } from "./directory.service";
import type { UpdateBrandingInput, UpdateCurrencyInput, UpdateDomainInput } from "./store.validation";

const toPublicProfile = (t: {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  themeColor: string | null;
  currency: string;
  description: string | null;
}) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  logoUrl: t.logoUrl,
  themeColor: t.themeColor,
  currency: t.currency,
  // Issue 2: the shop's own one-liner. Public because the storefront shows it; whether the shop is
  // listed in the directory is NOT here, because that is the owner's setting and no shopper's business.
  description: t.description,
});

export const storeService = {
  async getPublicProfile(storeId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
    if (!tenant) throw Errors.notFound("Store");
    return toPublicProfile(tenant);
  },

  async updateBranding(storeId: string, input: UpdateBrandingInput) {
    const tenant = await prisma.tenant.update({ where: { id: storeId }, data: input });
    // The owner is editing, so they see their directory setting back; a shopper reading
    // getPublicProfile does not.
    return { ...toPublicProfile(tenant), listedInDirectory: tenant.listedInDirectory };
  },

  /**
   * Whether this shop appears in the public directory right now, and if not, why. The owner should
   * not have to guess: a shop can be switched on and still be held back for having too few
   * products (directory.service.ts), and that is worth saying out loud rather than failing quietly.
   */
  async directoryListing(storeId: string) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: storeId },
      select: { listedInDirectory: true, description: true },
    });
    if (!tenant) throw Errors.notFound("Store");

    const products = await Product.countDocuments({ storeId });
    const listed = tenant.listedInDirectory && products >= MIN_PRODUCTS;
    let reason: string | null = null;
    if (!tenant.listedInDirectory) reason = "Your shop is not listed because you have turned the directory listing off.";
    else if (products < MIN_PRODUCTS)
      reason = `Your shop will be listed once it has ${MIN_PRODUCTS} products; it has ${products} so far.`;

    return { listedInDirectory: tenant.listedInDirectory, description: tenant.description, listed, productCount: products, minimumProducts: MIN_PRODUCTS, reason };
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
