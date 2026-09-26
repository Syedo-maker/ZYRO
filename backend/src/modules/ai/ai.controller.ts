import { RequestHandler } from "express";
import { getOrCreateQuota, getTopUpBalance } from "./ai.quota.service";
import { getTenantPlan } from "../billing/plan.service";

// Matches the AiUsageQuota schema in backend/openapi.yaml.
function present(
  quota: Awaited<ReturnType<typeof getOrCreateQuota>>,
  topUp: { generations: number; chatMessages: number },
  planName: string
) {
  return {
    month: quota.month,
    generationsUsed: quota.generationsUsed,
    generationsLimit: quota.generationsLimit,
    chatMessagesUsed: quota.chatMessagesUsed,
    chatMessagesLimit: quota.chatMessagesLimit,
    /** Credits from bought top-up packs, spent only after the plan's monthly allowance runs out. */
    topUpGenerations: topUp.generations,
    topUpChatMessages: topUp.chatMessages,
    plan: planName,
  };
}

export const aiController = {
  getUsage: (async (req, res, next) => {
    try {
      const storeId = req.params.storeId;
      const [quota, topUp, plan] = await Promise.all([getOrCreateQuota(storeId), getTopUpBalance(storeId), getTenantPlan(storeId)]);
      res.status(200).json(present(quota, topUp, plan.definition.name));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
