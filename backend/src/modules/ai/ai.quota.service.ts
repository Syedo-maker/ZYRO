import type { AiUsageQuota } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";

export type AiUsageKind = "generation" | "chat";

/** "YYYY-MM" in UTC, so quota resets on the same instant everywhere regardless of server timezone. */
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * The tenant's quota row for the current month, created with the configured defaults on first
 * use. A tenant's first request in a new month gets a fresh row rather than the previous
 * month's counters carrying over (Implementation_Plan.md Phase 4: `AiUsageQuota` is keyed by
 * `[tenantId, month]`).
 */
export async function getOrCreateQuota(tenantId: string, month = currentMonth()): Promise<AiUsageQuota> {
  const existing = await prisma.aiUsageQuota.findFirst({ where: { tenantId, month } });
  if (existing) return existing;

  try {
    return await prisma.aiUsageQuota.create({
      data: {
        tenantId,
        month,
        generationsLimit: env.ai.monthlyGenerationsLimit,
        chatMessagesLimit: env.ai.monthlyChatMessagesLimit,
      },
    });
  } catch {
    // Two requests raced to create this tenant's first-of-the-month row; the loser just
    // reads what the winner created (the [tenantId, month] unique index is what makes this safe).
    const row = await prisma.aiUsageQuota.findFirst({ where: { tenantId, month } });
    if (!row) throw new Error(`Failed to create or read AiUsageQuota for ${tenantId}/${month}`);
    return row;
  }
}

/**
 * Atomically reserves one unit of this month's quota and reports whether that succeeded.
 * `check remaining, then increment` as two separate steps would let concurrent calls all pass
 * the check before any of them writes, letting a tenant exceed a hard limit (a genuine
 * TOCTOU race, flagged in this module's security review even though nothing calls generate()
 * yet); a single conditional `UPDATE ... WHERE used < limit` closes that, since Postgres holds
 * the row lock for the whole statement, so only one of two racing callers can ever see it
 * succeed. Raw SQL, not `updateMany`, because Prisma's filter API cannot compare one column to
 * another (`generationsUsed < generationsLimit`) - the same reason discount.service.ts's
 * `redeem("strict", ...)` reaches for `$executeRaw` instead of `updateMany`. Manually includes
 * `tenantId` in the WHERE clause because raw queries bypass the tenant-scoping extension in
 * lib/prisma.ts (it only intercepts named model operations, not `$executeRaw`).
 */
export async function reserveQuota(tenantId: string, kind: AiUsageKind, month = currentMonth()): Promise<boolean> {
  await getOrCreateQuota(tenantId, month); // ensures the row exists before the conditional update targets it
  const changed =
    kind === "chat"
      ? await prisma.$executeRaw`UPDATE "AiUsageQuota" SET "chatMessagesUsed" = "chatMessagesUsed" + 1 WHERE "tenantId" = ${tenantId} AND "month" = ${month} AND "chatMessagesUsed" < "chatMessagesLimit"`
      : await prisma.$executeRaw`UPDATE "AiUsageQuota" SET "generationsUsed" = "generationsUsed" + 1 WHERE "tenantId" = ${tenantId} AND "month" = ${month} AND "generationsUsed" < "generationsLimit"`;
  return changed > 0;
}

/** Builds the 402 message for a reservation that failed, from the row's own limit. */
export async function quotaExhaustedMessage(tenantId: string, kind: AiUsageKind): Promise<string> {
  const quota = await getOrCreateQuota(tenantId);
  return kind === "chat"
    ? `This store has used all ${quota.chatMessagesLimit} AI chat messages included this month.`
    : `This store has used all ${quota.generationsLimit} AI generations included this month.`;
}

/**
 * Gives back a reservation from `reserveQuota` when the generation it was held for ultimately
 * failed (Implementation_Plan.md Phase 4: "a failed generation shouldn't cost the merchant
 * their quota"). `updateMany`, not `update`, per the tenant-scoping rule in lib/prisma.ts.
 */
export async function releaseQuota(tenantId: string, kind: AiUsageKind, month = currentMonth()): Promise<void> {
  await prisma.aiUsageQuota.updateMany({
    where: { tenantId, month },
    data: kind === "chat" ? { chatMessagesUsed: { decrement: 1 } } : { generationsUsed: { decrement: 1 } },
  });
}
