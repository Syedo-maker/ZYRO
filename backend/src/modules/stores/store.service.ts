import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { planService } from "../billing/plan.service";
import type { UpdateBrandingInput, UpdateDomainInput } from "./store.validation";

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
