import { RequestHandler } from "express";
import { tenantContext } from "../lib/tenantContext";
import { Errors } from "../errors/AppError";

/**
 * Reads :storeId from the route params and runs the rest of the request inside
 * tenantContext.run(), so the Prisma tenant-scoping middleware (lib/prisma.ts) can see
 * it. Mount this on every router nested under /stores/:storeId before any handler that
 * touches a tenant-scoped Prisma model.
 */
export const withTenantContext: RequestHandler = (req, _res, next) => {
  const storeId = req.params.storeId;
  if (!storeId) {
    return next(Errors.validation("Route is missing a storeId parameter"));
  }
  tenantContext.run(storeId, next);
};
