import { prisma, prismaUnscoped } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { password as passwordLib } from "../../lib/password";
import { Errors, AppError } from "../../errors/AppError";
import { planService } from "../billing/plan.service";
import { ROLE_PERMISSIONS, roleOf } from "../../lib/staffRoles";
import type { CreateStaffInput, UpdateStaffRoleInput } from "./staff.validation";

interface StaffRow {
  id: string;
  userId: string;
  permissions: string[];
}

/** The StaffMember shape in openapi.yaml: the person's email, their role, permissions in lowercase. */
const toView = (row: StaffRow, email: string) => ({
  id: row.id,
  userId: row.userId,
  email,
  role: roleOf(row.permissions),
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
    // Emails are stored and matched exactly as typed, the same as registration and login.
    const email = input.email;
    let user = await prisma.user.findUnique({ where: { email } });
    if (user && input.password) {
      throw Errors.validation("That email already has an account; add it without a password");
    }
    if (!user && !input.password) throw Errors.notFound("User with that email");

    // The plan's staff limit comes after the input checks (a wrong request is still a 400 or 404)
    // and before anything is created: a request refused for the limit must not leave a new account behind.
    await planService.assertCanAddStaff(tenantContext.getTenantId()!);

    if (!user) {
      user = await prisma.user.create({
        data: { email, name: input.name, passwordHash: await passwordLib.hash(input.password!) }, // present: an unknown email without one was refused above
      });
    }

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

  /**
   * The owner gives a staff member another role. Only the owner reaches this (requireOwner), so a
   * staff member can change neither their own role nor anyone else's; the owner has no staff row,
   * so the owner's own access can never be changed here. Takes effect on that person's next request:
   * every route reads their permissions afresh.
   */
  async updateRole(staffId: string, input: UpdateStaffRoleInput) {
    const tenantId = tenantContext.getTenantId()!;
    // updateMany, not update: the store is part of the filter, the same discipline as the tenant guard.
    const { count } = await prisma.staffMember.updateMany({ where: { id: staffId, tenantId }, data: { permissions: ROLE_PERMISSIONS[input.role] } });
    if (count === 0) throw Errors.notFound("Staff member");
    const row = (await prisma.staffMember.findFirst({ where: { id: staffId, tenantId } }))!;
    const user = await prismaUnscoped.user.findUnique({ where: { id: row.userId }, select: { email: true } });
    return toView(row, user?.email ?? "");
  },

  async remove(staffId: string) {
    const tenantId = tenantContext.getTenantId()!;
    const { count } = await prisma.staffMember.deleteMany({ where: { id: staffId, tenantId } });
    if (count === 0) throw Errors.notFound("Staff member");
  },
};
