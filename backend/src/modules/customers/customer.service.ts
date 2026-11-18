import { PrismaTx } from "../../lib/prisma";

/**
 * Customers are per business (tenant-scoped), so each store sees only its own. A shopper
 * with a ZYRO account is linked through userId; a guest or POS walk-in is matched by email.
 *
 * A signed-in shopper is matched only by their own account's email, never by the email they type
 * at checkout: typing someone else's address used to attach that person's customer record, and with
 * it their whole order history, to the shopper's account (audit 2026-11).
 */
export const customerService = {
  async findOrCreate(
    tx: PrismaTx,
    args: { tenantId: string; userId?: string; email?: string; name?: string; phone?: string }
  ): Promise<string | undefined> {
    const { tenantId, userId, name, phone } = args;
    let email = args.email?.trim().toLowerCase() || undefined;
    if (!userId && !email) return undefined;

    if (userId) {
      const byUser = await tx.customer.findFirst({ where: { tenantId, userId } });
      if (byUser) return byUser.id;
      const account = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      email = account?.email.trim().toLowerCase() || undefined;
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

    const created = await tx.customer.create({ data: { tenantId, userId, email, name, phone } });
    return created.id;
  },
};
