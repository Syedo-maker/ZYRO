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

/** Throws 402 if this tenant has used up its quota for the current month; does not consume it. */
export async function assertQuotaAvailable(tenantId: string, kind: AiUsageKind): Promise<void> {
  const quota = await getOrCreateQuota(tenantId);
  const [used, limit] = kind === "chat" ? [quota.chatMessagesUsed, quota.chatMessagesLimit] : [quota.generationsUsed, quota.generationsLimit];
  if (used >= limit) {
    throw Errors.quotaExhausted(
      kind === "chat"
        ? `This store has used all ${limit} AI chat messages included this month.`
        : `This store has used all ${limit} AI generations included this month.`
    );
  }
}

/**
 * Called only after a generation succeeds (Implementation_Plan.md Phase 4: "a failed
 * generation shouldn't cost the merchant their quota"). `updateMany`, not `update`, per the
 * tenant-scoping rule in lib/prisma.ts (AiUsageQuota is tenant-scoped and has no natural key
 * findUnique/update could target safely without it).
 */
export async function incrementUsage(tenantId: string, kind: AiUsageKind, month = currentMonth()): Promise<void> {
  await getOrCreateQuota(tenantId, month); // ensures the row exists before incrementing it
  await prisma.aiUsageQuota.updateMany({
    where: { tenantId, month },
    data: kind === "chat" ? { chatMessagesUsed: { increment: 1 } } : { generationsUsed: { increment: 1 } },
  });
}
