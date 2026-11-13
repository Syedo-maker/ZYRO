import { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { Errors } from "../errors/AppError";

/**
 * Restricts a route to the store's owner. `Tenant` itself isn't in the tenant-scoped
 * model set (it IS the tenant record), so a plain findUnique here is fine; it isn't
 * subject to the tenant-scoping middleware's findUnique restriction.
 */
export const requireOwner: RequestHandler = async (req, _res, next) => {
  // A failed lookup (the database unreachable) goes to the error handler as a 500 at once, instead
  // of an unhandled rejection that leaves the request hanging until the request timeout.
  try {
    const storeId = req.params.storeId;
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });

    if (!tenant) return next(Errors.notFound("Store"));
    if (tenant.ownerId !== req.userId) {
      return next(Errors.forbidden("Only the store owner can do this"));
    }
    next();
  } catch (err) {
    next(err);
  }
};
