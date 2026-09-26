import type { AiUsageQuota } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { PLANS, PLAN_ORDER } from "../../lib/plans";
import { getTenantPlan } from "../billing/plan.service";

export type AiUsageKind = "generation" | "chat";

/** Where a reserved unit came from, so giving it back returns it to the same place. */
export type QuotaSource = "plan" | "topup";

/** "YYYY-MM" in UTC, so quota resets on the same instant everywhere regardless of server timezone. */
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * The tenant's quota row for the current month. Its limits are the store's current plan's AI
 * allowance (lib/plans.ts): a new row is created with them, and an existing row is brought in
 * line if the plan has changed since (an upgrade takes effect at once, and a lapsed subscription
 * lowers the limit again, without waiting for next month). Usage already counted is never reset.
 * A tenant's first request in a new month gets a fresh row rather than the previous month's
 * counters carrying over (Implementation_Plan.md Phase 4: `AiUsageQuota` is keyed by
 * `[tenantId, month]`).
 */
export async function getOrCreateQuota(tenantId: string, month = currentMonth()): Promise<AiUsageQuota> {
  const { definition } = await getTenantPlan(tenantId);
  const limits = { generationsLimit: definition.aiGenerationsPerMonth, chatMessagesLimit: definition.aiChatMessagesPerMonth };

  const existing = await prisma.aiUsageQuota.findFirst({ where: { tenantId, month } });
  if (existing) {
    if (existing.generationsLimit === limits.generationsLimit && existing.chatMessagesLimit === limits.chatMessagesLimit) return existing;
    await prisma.aiUsageQuota.updateMany({ where: { tenantId, month }, data: limits });
    return { ...existing, ...limits };
  }

  try {
    return await prisma.aiUsageQuota.create({ data: { tenantId, month, ...limits } });
  } catch {
    // Two requests raced to create this tenant's first-of-the-month row; the loser just
    // reads what the winner created (the [tenantId, month] unique index is what makes this safe).
    const row = await prisma.aiUsageQuota.findFirst({ where: { tenantId, month } });
    if (!row) throw new Error(`Failed to create or read AiUsageQuota for ${tenantId}/${month}`);
    return row;
  }
}

/** Credits left from bought top-up packs. */
export async function getTopUpBalance(tenantId: string): Promise<{ generations: number; chatMessages: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiTopUpGenerations: true, aiTopUpChatMessages: true } });
  return { generations: tenant?.aiTopUpGenerations ?? 0, chatMessages: tenant?.aiTopUpChatMessages ?? 0 };
}

/**
 * Atomically reserves one unit and says where it came from, or null if there is none left.
 * The plan's monthly allowance is spent first; only when it is used up does a bought top-up
 * credit get spent, so credits are never burned while free allowance remains.
 *
 * `check remaining, then increment` as two separate steps would let concurrent calls all pass
 * the check before any of them writes, letting a tenant exceed a hard limit (a genuine
 * TOCTOU race, flagged in this module's security review even though nothing calls generate()
 * yet); a single conditional `UPDATE ... WHERE used < limit` closes that, since Postgres holds
 * the row lock for the whole statement, so only one of two racing callers can ever see it
 * succeed. The top-up balance uses the same shape (`WHERE balance > 0`). Raw SQL, not
 * `updateMany`, because Prisma's filter API cannot compare one column to another
 * (`generationsUsed < generationsLimit`) - the same reason discount.service.ts's
 * `redeem("strict", ...)` reaches for `$executeRaw` instead of `updateMany`. Manually includes
 * `tenantId` in the WHERE clause because raw queries bypass the tenant-scoping extension in
 * lib/prisma.ts (it only intercepts named model operations, not `$executeRaw`).
 */
export async function reserveQuota(tenantId: string, kind: AiUsageKind, month = currentMonth()): Promise<QuotaSource | null> {
  await getOrCreateQuota(tenantId, month); // ensures the row exists (and matches the plan) before the conditional update targets it
  const changed =
    kind === "chat"
      ? await prisma.$executeRaw`UPDATE "AiUsageQuota" SET "chatMessagesUsed" = "chatMessagesUsed" + 1 WHERE "tenantId" = ${tenantId} AND "month" = ${month} AND "chatMessagesUsed" < "chatMessagesLimit"`
      : await prisma.$executeRaw`UPDATE "AiUsageQuota" SET "generationsUsed" = "generationsUsed" + 1 WHERE "tenantId" = ${tenantId} AND "month" = ${month} AND "generationsUsed" < "generationsLimit"`;
  if (changed > 0) return "plan";

  const fromTopUp =
    kind === "chat"
      ? await prisma.$executeRaw`UPDATE "Tenant" SET "aiTopUpChatMessages" = "aiTopUpChatMessages" - 1 WHERE "id" = ${tenantId} AND "aiTopUpChatMessages" > 0`
      : await prisma.$executeRaw`UPDATE "Tenant" SET "aiTopUpGenerations" = "aiTopUpGenerations" - 1 WHERE "id" = ${tenantId} AND "aiTopUpGenerations" > 0`;
  return fromTopUp > 0 ? "topup" : null;
}

/** Builds the 402 for a reservation that failed: the message, plus what would help (a top-up, or a plan with more). */
export async function quotaExhaustedError(tenantId: string, kind: AiUsageKind) {
  const [quota, plan] = await Promise.all([getOrCreateQuota(tenantId), getTenantPlan(tenantId)]);
  const limit = kind === "chat" ? quota.chatMessagesLimit : quota.generationsLimit;
  const detail =
    kind === "chat"
      ? `This store has used all ${limit} AI chat messages included this month.`
      : `This store has used all ${limit} AI generations included this month.`;
  const more = (p: (typeof PLANS)[keyof typeof PLANS]) => (kind === "chat" ? p.aiChatMessagesPerMonth : p.aiGenerationsPerMonth);
  const next = PLAN_ORDER.map((t) => PLANS[t]).find((p) => PLAN_ORDER.indexOf(p.tier) > PLAN_ORDER.indexOf(plan.tier) && more(p) > limit);
  return Errors.quotaExhausted(detail, {
    upgrade: {
      feature: kind === "chat" ? "ai_chat_messages" : "ai_generations",
      currentPlan: plan.definition.name,
      requiredPlan: next?.name ?? null,
      limit,
    },
    topUpAvailable: true,
  });
}

/**
 * Gives back a reservation from `reserveQuota` when the generation it was held for ultimately
 * failed (Implementation_Plan.md Phase 4: "a failed generation shouldn't cost the merchant
 * their quota"), to wherever it was taken from. `updateMany`, not `update`, per the
 * tenant-scoping rule in lib/prisma.ts.
 */
export async function releaseQuota(tenantId: string, kind: AiUsageKind, source: QuotaSource = "plan", month = currentMonth()): Promise<void> {
  if (source === "topup") {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: kind === "chat" ? { aiTopUpChatMessages: { increment: 1 } } : { aiTopUpGenerations: { increment: 1 } },
    });
    return;
  }
  await prisma.aiUsageQuota.updateMany({
    where: { tenantId, month },
    data: kind === "chat" ? { chatMessagesUsed: { decrement: 1 } } : { generationsUsed: { decrement: 1 } },
  });
}
