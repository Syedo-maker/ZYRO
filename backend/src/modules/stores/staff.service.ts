import { prisma } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { Errors, AppError } from "../../errors/AppError";
import type { CreateStaffInput } from "./staff.validation";

export const staffService = {
  /**
   * Adds an existing User as staff on a store. There is no invitation-email flow in this
   * module's scope: the person must already have a ZYRO account (as a customer or
   * merchant elsewhere) before they can be added as staff.
   */
  async create(input: CreateStaffInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw Errors.notFound("User with that email");

    // The tenant-scoping middleware (lib/prisma.ts) also merges tenantId into every
    // where/data object at runtime, but Prisma's generated types can't see that, so
    // tenantId is passed explicitly here too. The middleware then becomes a harmless,
    // defense-in-depth backstop rather than the only thing enforcing it.
    const tenantId = tenantContext.getTenantId()!;

    const existing = await prisma.staffMember.findFirst({ where: { userId: user.id } });
    if (existing) {
      throw new AppError(409, "https://zyro.dev/errors/already-staff", "User is already staff at this store");
    }

    return prisma.staffMember.create({
      data: { tenantId, userId: user.id, permissions: input.permissions },
    });
  },
};
