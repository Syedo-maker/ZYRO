import { StaffPermission } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Whether a user may act on a store with the given permission: the owner always may;
 * staff only if their StaffMember row lists it. Same rule as the requirePermission
 * middleware, for services that must decide inside a request (for example, an order is
 * visible to its buyer but managed only by the merchant side).
 * Must run inside a tenant context.
 */
export async function hasStorePermission(
  userId: string,
  tenantId: string,
  permission: StaffPermission
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerId: true } });
  if (!tenant) return false;
  if (tenant.ownerId === userId) return true;
  const staff = await prisma.staffMember.findFirst({ where: { tenantId, userId } });
  return !!staff?.permissions.includes(permission);
}
