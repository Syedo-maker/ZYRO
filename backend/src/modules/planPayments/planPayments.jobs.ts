import { env } from "../../config/env";
import { prismaUnscoped } from "../../lib/prisma";
import { effectiveTier } from "../../lib/plans";
import { aiDisabled } from "../../lib/aiLimits";
import { errorMessage, logger } from "../../lib/logger";
import { activatePlan, endPlan, recordPlanAudit } from "../billing/planActivation";
import { emailApprovers, emailOwnerNotice } from "./planPayments.notify";

/**
 * The time-driven side of plan payments (Pro plan payments, 2026-11), run every 15 minutes by the
 * plan-payments queue and safe to run twice at once: every step claims its work with a conditional
 * update (or checks the audit log) before sending anything.
 *
 *   - approvers are reminded about a request still pending after 24 and again after 48 hours
 *   - a provisional plan that reached its end without a decision goes back to Free
 *   - an owner is told 7 days and 1 day before a paid plan ends
 *   - a paid plan past its end (and grace) is put back on Free, and the owner told
 *
 * Only plans managed here are touched: a store with a Stripe subscription is left to Stripe. Nothing in
 * a store is ever deleted.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export async function runPlanPaymentSweep(now = new Date()) {
  const counts = { reminders: 0, provisionalEnded: 0, expiryNotices: 0, downgraded: 0 };

  // 1. Approver reminders after 24 and 48 hours.
  for (const [after, from, label] of [[24, 0, "24 hours"], [48, 1, "48 hours"]] as const) {
    const due = await prismaUnscoped.planPaymentRequest.findMany({
      where: { status: "pending", remindersSent: from, submittedAt: { lt: new Date(now.getTime() - after * HOUR) } },
      include: { tenant: { select: { name: true } } },
      take: 50,
    });
    for (const r of due) {
      const claimed = await prismaUnscoped.planPaymentRequest.updateMany({ where: { id: r.id, status: "pending", remindersSent: from }, data: { remindersSent: from + 1 } });
      if (claimed.count === 0) continue;
      await emailApprovers({ ...r, storeName: r.tenant.name }, label);
      counts.reminders += 1;
    }
  }

  // 2. Provisional plans whose time ran out before anyone decided: back to Free, request still pending.
  const lapsed = await prismaUnscoped.planPaymentRequest.findMany({
    where: { status: "pending", provisionalUntil: { lte: now } },
    include: { owner: { select: { email: true } } },
    take: 50,
  });
  for (const r of lapsed) {
    const ended = await prismaUnscoped.$transaction(async (tx) => {
      const claimed = await tx.planPaymentRequest.updateMany({ where: { id: r.id, provisionalUntil: { lte: now } }, data: { provisionalUntil: null } });
      if (claimed.count === 0) return false;
      const store = await tx.tenant.findUnique({ where: { id: r.tenantId }, select: { planProvisional: true } });
      if (store?.planProvisional) await endPlan(tx, { tenantId: r.tenantId, requestId: r.id, actor: { kind: "system" }, action: "provisional_expired" });
      return true;
    });
    if (!ended) continue;
    counts.provisionalEnded += 1;
    await emailOwnerNotice(
      r.owner.email,
      `Zyro: your provisional Pro has ended (${r.referenceCode})`,
      ["Your provisional Pro time has ended, so your store is back on the Free plan. Nothing in your store was deleted.", "", "Your payment is still being reviewed by a person. When it is approved, Pro starts again for the full period."],
      r.id,
    );
  }

  // 3 and 4. Paid plans managed here: notices before the end, and Free after it.
  const paid = await prismaUnscoped.tenant.findMany({
    where: { plan: { not: "FREE" }, stripeSubscriptionId: null, planExpiresAt: { not: null, lte: new Date(now.getTime() + 7 * DAY) } },
    select: { id: true, name: true, plan: true, planExpiresAt: true, planProvisional: true, owner: { select: { email: true } } },
    take: 200,
  });
  for (const t of paid) {
    const until = t.planExpiresAt!;
    if (effectiveTier(t, now) === "FREE") {
      const done = await prismaUnscoped.$transaction(async (tx) => {
        const fresh = await tx.tenant.findUnique({ where: { id: t.id }, select: { plan: true, planExpiresAt: true, planProvisional: true } });
        if (!fresh || fresh.plan === "FREE" || effectiveTier(fresh, now) !== "FREE") return false;
        await endPlan(tx, { tenantId: t.id, actor: { kind: "system" }, action: t.planProvisional ? "provisional_expired" : "plan_expired", details: { until: until.toISOString() } });
        return true;
      });
      if (!done) continue;
      counts.downgraded += 1;
      await emailOwnerNotice(
        t.owner.email,
        "Zyro: your Pro plan has ended",
        ["Your Pro plan has ended, so your store is back on the Free plan. Nothing in your store was deleted.", "", "You can renew any time from Upgrade to Pro in your dashboard."],
        t.id,
      );
      continue;
    }
    if (t.planProvisional || until <= now) continue;
    const left = until.getTime() - now.getTime();
    const notice = left <= DAY ? "1d" : left <= 7 * DAY ? "7d" : null;
    if (!notice) continue;
    const action = `plan_expiry_notice_${notice}`;
    // One notice of each kind per paid period: the audit log is the record that it was sent.
    const already = await prismaUnscoped.planAuditEvent.count({ where: { tenantId: t.id, action, details: { path: ["until"], equals: until.toISOString() } } });
    if (already) continue;
    await recordPlanAudit(prismaUnscoped, { tenantId: t.id, actor: { kind: "system" }, action, details: { until: until.toISOString() } });
    counts.expiryNotices += 1;
    await emailOwnerNotice(
      t.owner.email,
      `Zyro: your Pro plan ends ${notice === "1d" ? "tomorrow" : "in 7 days"}`,
      [`Your Pro plan for ${t.name.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 80)} ends on ${until.toISOString().slice(0, 10)}.`, "", "Renew from Upgrade to Pro in your dashboard: the days you have left are kept. If you do not renew, your store moves to the Free plan and nothing is deleted."],
      t.id,
    );
  }
  return counts;
}

/**
 * Provisional Pro (off unless PLAN_PROVISIONAL_ENABLED=true): a payment whose every automatic check
 * passed with high confidence gets Pro for a short time, before a person confirms it. Once per owner
 * account, never while the AI is unavailable or switched off, at most PLAN_PROVISIONAL_DAILY_CAP a day
 * across the platform, with lower AI limits, and never for a store already on a paid plan.
 * Returns the end of the provisional plan, or null when none was granted.
 */
export async function maybeGrantProvisional(request: { id: string; tenantId: string; ownerId: string; plan: string; aiStatus: string | null }, confidence: number | null, now = new Date()): Promise<Date | null> {
  const p = env.planPayments.provisional;
  if (!p.enabled || aiDisabled() || request.aiStatus !== "passed" || confidence === null || confidence < p.minConfidence) return null;
  try {
    return await prismaUnscoped.$transaction(async (tx) => {
      const store = await tx.tenant.findUniqueOrThrow({ where: { id: request.tenantId }, select: { plan: true, planExpiresAt: true, planProvisional: true, stripeSubscriptionId: true } });
      if (effectiveTier(store, now) !== "FREE" || store.stripeSubscriptionId) return null;
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const today = await tx.planAuditEvent.count({ where: { action: "provisional_granted", createdAt: { gte: dayStart } } });
      if (today >= p.dailyCap) return null;
      // Once per owner account: the condition is in the update, so two stores cannot both claim it.
      const claimed = await tx.user.updateMany({ where: { id: request.ownerId, provisionalProUsedAt: null }, data: { provisionalProUsedAt: now } });
      if (claimed.count === 0) return null;
      const until = new Date(now.getTime() + p.hours * HOUR);
      await activatePlan(tx, {
        tenantId: request.tenantId,
        requestId: request.id,
        tier: request.plan as "PRO" | "BUSINESS",
        until,
        provisional: true,
        actor: { kind: "system" },
        action: "provisional_granted",
        details: { hours: p.hours, confidence },
      });
      await tx.planPaymentRequest.update({ where: { id: request.id }, data: { provisionalUntil: until } });
      return until;
    });
  } catch (err) {
    logger.warn({ requestId: request.id, err: errorMessage(err) }, "provisional plan not granted");
    return null;
  }
}
