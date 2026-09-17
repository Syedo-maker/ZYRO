import { prismaUnscoped } from "../../lib/prisma";

export interface MyStore {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  themeColor: string | null;
  role: "owner" | "staff";
}

export const meService = {
  async getProfile(userId: string) {
    const user = await prismaUnscoped.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name };
  },

  /**
   * Cross-tenant by nature — "which stores do I belong to" can't be scoped to a single
   * tenantId, so this deliberately uses the unscoped client (see lib/prisma.ts), always
   * filtered by the caller's own userId.
   */
  async listMyStores(userId: string): Promise<MyStore[]> {
    const [owned, staffOf] = await Promise.all([
      prismaUnscoped.tenant.findMany({ where: { ownerId: userId } }),
      prismaUnscoped.staffMember.findMany({ where: { userId }, include: { tenant: true } }),
    ]);

    const stores = new Map<string, MyStore>();
    for (const tenant of owned) {
      stores.set(tenant.id, {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        themeColor: tenant.themeColor,
        role: "owner",
      });
    }
    for (const staff of staffOf) {
      if (!stores.has(staff.tenant.id)) {
        stores.set(staff.tenant.id, {
          id: staff.tenant.id,
          name: staff.tenant.name,
          slug: staff.tenant.slug,
          logoUrl: staff.tenant.logoUrl,
          themeColor: staff.tenant.themeColor,
          role: "staff",
        });
      }
    }
    return Array.from(stores.values());
  },
};
