import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import type { UpdateBrandingInput } from "./store.validation";

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
};
