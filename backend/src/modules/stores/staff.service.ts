import { prisma, prismaUnscoped } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { Errors, AppError } from "../../errors/AppError";
import type { CreateStaffInput } from "./staff.validation";

interface StaffRow {
  id: string;
  userId: string;
  permissions: string[];
}

/** The StaffMember shape in openapi.yaml: the person's email, permissions in lowercase. */
const toView = (row: StaffRow, email: string) => ({
  id: row.id,
  userId: row.userId,
  email,
  permissions: row.permissions.map((p) => p.toLowerCase()),
});

export const staffService = {
  async list() {
    const tenantId = tenantContext.getTenantId()!;
    const rows = await prisma.staffMember.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    // User is a global table (one account can work at several stores), so it is read unscoped.
    const users = await prismaUnscoped.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, email: true },
    });
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r) => toView(r, emailById.get(r.userId) ?? ""));
  },

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

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerId: true } });
    if (tenant?.ownerId === user.id) {
      throw Errors.conflict("The store owner already has full access and does not need a staff role");
    }

    const existing = await prisma.staffMember.findFirst({ where: { tenantId, userId: user.id } });
    if (existing) {
      throw new AppError(409, "https://zyro.dev/errors/already-staff", "User is already staff at this store");
    }

    const created = await prisma.staffMember.create({
      data: { tenantId, userId: user.id, permissions: input.permissions },
    });
    return toView(created, user.email);
  },

  async remove(staffId: string) {
    const tenantId = tenantContext.getTenantId()!;
    const { count } = await prisma.staffMember.deleteMany({ where: { id: staffId, tenantId } });
    if (count === 0) throw Errors.notFound("Staff member");
  },
};
