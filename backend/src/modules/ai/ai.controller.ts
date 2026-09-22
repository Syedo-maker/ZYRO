import { RequestHandler } from "express";
import { getOrCreateQuota } from "./ai.quota.service";

// Matches the AiUsageQuota schema in backend/openapi.yaml.
function present(quota: Awaited<ReturnType<typeof getOrCreateQuota>>) {
  return {
    month: quota.month,
    generationsUsed: quota.generationsUsed,
    generationsLimit: quota.generationsLimit,
    chatMessagesUsed: quota.chatMessagesUsed,
    chatMessagesLimit: quota.chatMessagesLimit,
  };
}

export const aiController = {
  getUsage: (async (req, res, next) => {
    try {
      res.status(200).json(present(await getOrCreateQuota(req.params.storeId)));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
