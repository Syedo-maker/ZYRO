import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import type { UpdateBrandingInput } from "./store.validation";

export const storeService = {
  async getPublicProfile(storeId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
    if (!tenant) throw Errors.notFound("Store");
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, logoUrl: tenant.logoUrl, themeColor: tenant.themeColor };
  },

  async updateBranding(storeId: string, input: UpdateBrandingInput) {
    const tenant = await prisma.tenant.update({ where: { id: storeId }, data: input });
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, logoUrl: tenant.logoUrl, themeColor: tenant.themeColor };
  },
};
