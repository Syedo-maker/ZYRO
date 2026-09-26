import { RequestHandler } from "express";
import { prismaUnscoped } from "../lib/prisma";
import { Errors } from "../errors/AppError";

/**
 * Restricts a route to the platform's own operators (User.platformRole = SUPER_ADMIN). The role is
 * read from the database on every request, never from the token, so taking the role away takes
 * effect at once. Nobody can grant it through the API: it is set only by
 * `npx tsx scripts/make-super-admin.ts <email>`, run by whoever operates the database.
 * A store owner is not a super admin, and a super admin gets no access to a store's own routes.
 */
export const requireSuperAdmin: RequestHandler = async (req, _res, next) => {
  try {
    const user = await prismaUnscoped.user.findUnique({ where: { id: req.userId }, select: { platformRole: true } });
    if (user?.platformRole !== "SUPER_ADMIN") return next(Errors.forbidden("Platform administrators only"));
    next();
  } catch (err) {
    next(err);
  }
};
