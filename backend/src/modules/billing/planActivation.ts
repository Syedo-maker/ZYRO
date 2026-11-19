import type { PlanTier, Prisma } from "@prisma/client";
import { prismaUnscoped } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { Errors } from "../../errors/AppError";
import { effectiveTier } from "../../lib/plans";

/**
 * The one place a store's plan is switched on or off by anything other than Stripe (Pro plan payments,
 * 2026-11). An approved payment, a provisional grant, its expiry, a revoke, the set-plan script, and a
 * verified gateway webhook in future all come through here, and every change writes a PlanAuditEvent in
 * the same transaction: who or what did it, which request, and the amounts. Nothing here trusts the
 * client or the AI: callers decide, this only applies the decision and records it.
 *
 * Lowering a plan never deletes anything: a store over its new limits keeps what it has.
 */

export type ActorKind = "approver" | "owner" | "system" | "script" | "gateway";
export interface PlanActor {
  kind: ActorKind;
  userId?: string | null;
}

type Db = Prisma.TransactionClient | typeof prismaUnscoped;

export interface AuditInput {
  tenantId?: string | null;
  requestId?: string | null;
  actor: PlanActor;
  action: string;
  details?: Record<string, unknown>;
}

/** Writes one audit entry. Ids, amounts and reasons only: never a proof image or personal details. */
export async function recordPlanAudit(db: Db, input: AuditInput) {
  await db.planAuditEvent.create({
    data: {
      tenantId: input.tenantId ?? null,
      requestId: input.requestId ?? null,
      actorUserId: input.actor.userId ?? null,
      actorKind: input.actor.kind,
      action: input.action,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
    },
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a newly paid period ends. A store renewing the same plan before its paid period runs out keeps
 * the days it has left (the owners' decision of 2026-11-19); anything else (a first upgrade, a lapsed
 * plan, a provisional plan becoming real) counts from `from`, the approval time.
 */
export function nextPeriodEnd(
  current: { plan: PlanTier; planExpiresAt: Date | null; planProvisional: boolean },
  tier: PlanTier,
  days: number,
  from = new Date(),
): Date {
  const renewing = !current.planProvisional && current.plan === tier && effectiveTier(current, from) === tier && current.planExpiresAt && current.planExpiresAt > from;
  const start = renewing ? current.planExpiresAt! : from;
  return new Date(start.getTime() + days * DAY_MS);
}

export interface ActivateInput extends AuditInput {
  tier: Exclude<PlanTier, "FREE">;
  until: Date;
  provisional?: boolean;
}

/** Switches a paid plan on until `until`, and records it. */
export async function activatePlan(db: Db, input: ActivateInput) {
  const store = await db.tenant.findUnique({ where: { id: input.tenantId! }, select: { id: true, plan: true, planExpiresAt: true, planProvisional: true, stripeSubscriptionId: true } });
  if (!store) throw Errors.notFound("Store");
  // Stripe's next webhook would silently overwrite a change made here.
  if (store.stripeSubscriptionId && input.actor.kind !== "gateway") {
    throw Errors.conflict("This store has a Stripe subscription, which would overwrite a plan change made here. Cancel it first.");
  }
  if (!(input.until.getTime() > Date.now())) throw Errors.validation("A paid plan must end in the future.");
  const updated = await db.tenant.update({
    where: { id: store.id },
    data: { plan: input.tier, planExpiresAt: input.until, planProvisional: input.provisional === true },
    select: { plan: true, planExpiresAt: true, planProvisional: true },
  });
  await recordPlanAudit(db, {
    ...input,
    details: {
      ...input.details,
      from: { plan: store.plan, until: store.planExpiresAt?.toISOString() ?? null, provisional: store.planProvisional },
      to: { plan: updated.plan, until: updated.planExpiresAt?.toISOString() ?? null, provisional: updated.planProvisional },
    },
  });
  logger.info({ storeId: store.id, action: input.action, to: updated.plan, provisional: updated.planProvisional }, "store plan changed");
  return updated;
}

/** Puts a store back on Free now, and records it. Nothing in the store is deleted. */
export async function endPlan(db: Db, input: AuditInput) {
  const store = await db.tenant.findUnique({ where: { id: input.tenantId! }, select: { id: true, plan: true, planExpiresAt: true, planProvisional: true, stripeSubscriptionId: true } });
  if (!store) throw Errors.notFound("Store");
  if (store.stripeSubscriptionId && input.actor.kind !== "gateway") {
    throw Errors.conflict("This store has a Stripe subscription, which would overwrite a plan change made here. Cancel it first.");
  }
  const updated = await db.tenant.update({
    where: { id: store.id },
    data: { plan: "FREE", planExpiresAt: null, planProvisional: false },
    select: { plan: true, planExpiresAt: true, planProvisional: true },
  });
  await recordPlanAudit(db, {
    ...input,
    details: { ...input.details, from: { plan: store.plan, until: store.planExpiresAt?.toISOString() ?? null, provisional: store.planProvisional }, to: { plan: "FREE" } },
  });
  logger.info({ storeId: store.id, action: input.action, to: "FREE" }, "store plan changed");
  return updated;
}
