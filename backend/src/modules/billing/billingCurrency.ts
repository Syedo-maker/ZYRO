import type { Prisma } from "@prisma/client";
import { prismaUnscoped } from "../../lib/prisma";
import { env } from "../../config/env";
import { billingCurrencies } from "../../config/planPayments";
import { Errors } from "../../errors/AppError";
import { recordPlanAudit, type PlanActor } from "./planActivation";

/**
 * The currency an owner pays Zyro in (Pro plan payments, 2026-11). It belongs to the owner's account,
 * not a store, so every store they own is billed the same way. Until they choose, it follows their
 * store's currency: PKR stays PKR, anything else is USD (the owners' decision of 2026-11-19). It can be
 * changed on the upgrade page until a payment is approved; then it is locked, and only a platform admin
 * can change it, with an audit entry.
 */

type Db = Prisma.TransactionClient | typeof prismaUnscoped;

/** What the account is billed in when nothing was chosen yet. Null when no currency is priced at all. */
export function defaultBillingCurrency(storeCurrency: string, priced = billingCurrencies(env.planPayments)): string | null {
  const preferred = storeCurrency.toUpperCase() === "PKR" ? "PKR" : "USD";
  return priced.includes(preferred) ? preferred : (priced[0] ?? null);
}

export interface BillingCurrencyState {
  currency: string | null;
  locked: boolean;
  /** Every currency the price table charges in, for the owner to choose from while unlocked. */
  choices: string[];
}

export async function billingCurrencyFor(ownerId: string, storeCurrency: string): Promise<BillingCurrencyState> {
  const user = await prismaUnscoped.user.findUnique({ where: { id: ownerId }, select: { billingCurrency: true, billingCurrencyLockedAt: true } });
  if (!user) throw Errors.notFound("Account");
  const choices = billingCurrencies(env.planPayments);
  const locked = !!user.billingCurrencyLockedAt;
  // A locked currency is kept even if the price table later stops listing it: the owner is told it is unavailable.
  const currency = locked ? user.billingCurrency : user.billingCurrency && choices.includes(user.billingCurrency) ? user.billingCurrency : defaultBillingCurrency(storeCurrency, choices);
  return { currency, locked, choices };
}

/** The owner picks a currency on the upgrade page. Refused once locked. */
export async function chooseBillingCurrency(ownerId: string, currency: string, tenantId: string) {
  const code = currency.toUpperCase();
  if (!billingCurrencies(env.planPayments).includes(code)) throw Errors.validation(`Plans cannot be paid in ${code}.`);
  return prismaUnscoped.$transaction(async (tx) => {
    // Only an unlocked account changes: the condition is in the update itself, so two requests cannot race past a lock.
    const changed = await tx.user.updateMany({ where: { id: ownerId, billingCurrencyLockedAt: null }, data: { billingCurrency: code } });
    if (changed.count === 0) throw Errors.conflict("Your billing currency is locked after your first payment. Contact support to change it.");
    await recordPlanAudit(tx, { tenantId, actor: { kind: "owner", userId: ownerId }, action: "billing_currency_chosen", details: { currency: code } });
    return code;
  });
}

/** After the first approved payment: the currency can no longer be changed by the owner. */
export async function lockBillingCurrency(db: Db, ownerId: string, currency: string) {
  await db.user.updateMany({ where: { id: ownerId, billingCurrencyLockedAt: null }, data: { billingCurrency: currency, billingCurrencyLockedAt: new Date() } });
}

/** A platform admin changes a locked currency, with a reason in the audit log. */
export async function adminChangeBillingCurrency(ownerId: string, currency: string, actor: PlanActor, reason: string) {
  const code = currency.toUpperCase();
  if (!billingCurrencies(env.planPayments).includes(code)) throw Errors.validation(`Plans cannot be paid in ${code}.`);
  if (!reason.trim()) throw Errors.validation("Give a reason for changing the billing currency.");
  return prismaUnscoped.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: ownerId }, select: { billingCurrency: true } });
    if (!user) throw Errors.notFound("Account");
    await tx.user.update({ where: { id: ownerId }, data: { billingCurrency: code } });
    await recordPlanAudit(tx, { actor, action: "billing_currency_changed_by_admin", details: { ownerId, from: user.billingCurrency, to: code, reason: reason.trim().slice(0, 300) } });
    return code;
  });
}
