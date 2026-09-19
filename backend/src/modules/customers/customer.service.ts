import { PrismaTx } from "../../lib/prisma";

/**
 * Customers are per business (tenant-scoped), so each store sees only its own. A shopper
 * with a ZYRO account is linked through userId; a guest or POS walk-in is matched by email.
 */
export const customerService = {
  async findOrCreate(
    tx: PrismaTx,
    args: { tenantId: string; userId?: string; email?: string; name?: string }
  ): Promise<string | undefined> {
    const { tenantId, userId, name } = args;
    const email = args.email?.trim().toLowerCase() || undefined;
    if (!userId && !email) return undefined;

    if (userId) {
      const byUser = await tx.customer.findFirst({ where: { tenantId, userId } });
      if (byUser) return byUser.id;
    }

    if (email) {
      const byEmail = await tx.customer.findFirst({ where: { tenantId, email } });
      if (byEmail) {
        // A guest who later signs up: attach the account to the existing customer.
        if (userId && !byEmail.userId) {
          await tx.customer.updateMany({ where: { id: byEmail.id, tenantId }, data: { userId } });
        }
        return byEmail.id;
      }
    }

    const created = await tx.customer.create({ data: { tenantId, userId, email, name } });
    return created.id;
  },
};
