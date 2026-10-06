import { prismaUnscoped } from "../../lib/prisma";

/**
 * Which experience this user saw last, remembered so a returning visitor is not asked "shop or
 * sell?" every time (Issue 2). It is a routing hint and nothing more: it decides which screen the
 * browser opens on, never what the user is allowed to do. Permission is still worked out per
 * request and per shop from Tenant.ownerId and StaffMember (see middleware/requireOwner and
 * requirePermission), because the same person can own one shop and shop at another.
 */
export const EXPERIENCES = ["shopper", "owner"] as const;
export type Experience = (typeof EXPERIENCES)[number];

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
    // platformAdmin only decides whether the UI shows the platform view; the /platform routes check the role themselves.
    // preferredExperience likewise only decides where the browser lands; see EXPERIENCES above.
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformAdmin: user.platformRole === "SUPER_ADMIN",
      preferredExperience: (user.preferredExperience as Experience | null) ?? null,
    };
  },

  /** Remembers the choice made on the landing screen. Grants nothing. */
  async setPreferredExperience(userId: string, experience: Experience) {
    const user = await prismaUnscoped.user.update({ where: { id: userId }, data: { preferredExperience: experience } });
    return { preferredExperience: user.preferredExperience as Experience };
  },

  /**
   * Cross-tenant by nature: "which stores do I belong to" can't be scoped to a single
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
