import { RequestHandler } from "express";
import { StaffPermission } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { tenantContext } from "../lib/tenantContext";
import { Errors } from "../errors/AppError";

/**
 * Allows the request through if the caller is the store's owner (implicit full access,
 * not stored as a StaffMember row) OR a staff member whose `permissions` array includes
 * the required one. Mount after requireAuth + withTenantContext.
 *
 * Not yet used by any Module 1 route (staff creation is owner-only via requireOwner),
 * but is the authorization primitive Modules 4/5/6/7 build their permission checks on
 * (products_write, orders_write, discounts_write, analytics_read); built now because
 * it's the "per-route authorization middleware" this module's own plan entry calls for.
 */
/** What each permission is called on the Team page, for a 403 a person can act on. */
const PERMISSION_NAMES: Record<StaffPermission, string> = {
  PRODUCTS_WRITE: "Products (adding and editing products, and the AI writing tools)",
  ORDERS_WRITE: "Orders",
  DISCOUNTS_WRITE: "Discounts",
  ANALYTICS_READ: "Analytics",
  POS_SELL: "Register",
  INVENTORY_WRITE: "Inventory",
  REFUNDS: "Refunds",
};

export function requirePermission(permission: StaffPermission): RequestHandler {
  return async (req, _res, next) => {
    const storeId = req.params.storeId;

    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
    if (!tenant) return next(Errors.notFound("Store"));
    if (tenant.ownerId === req.userId) return next();

    const staffMember = await prisma.staffMember.findFirst({
      where: { tenantId: tenantContext.getTenantId(), userId: req.userId },
    });

    if (!staffMember || !staffMember.permissions.includes(permission)) {
      return next(
        Errors.forbidden(
          `This needs the ${PERMISSION_NAMES[permission]} permission (${permission.toLowerCase()}), which your account does not have in this store. Ask the store owner for it.`
        )
      );
    }
    next();
  };
}
