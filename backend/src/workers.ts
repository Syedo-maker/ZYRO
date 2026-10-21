import { startAiWorker, closeAiQueue } from "./lib/aiQueue";
import { scheduleCartRecoveryScan, startCartRecoveryWorker, closeCartRecoveryQueue } from "./lib/cartRecoveryQueue";
import { scheduleAdvisor, startAdvisorWorker, closeAdvisorQueue } from "./lib/advisorQueue";
import { scheduleTrends, startTrendsWorker, closeTrendsQueue } from "./lib/trendsQueue";
import { onShutdown } from "./lib/lifecycle";
import { logger } from "./lib/logger";

/**
 * The background jobs: AI generations (every AI feature waits on these), the abandoned-cart scan,
 * and the weekly Growth Advisor and Trend Scout runs. Started by the worker process (worker.ts) in
 * production, or inside the API on a developer's machine (env.workers.inProcess).
 *
 * The schedules are idempotent: each is an upsertJobScheduler under a fixed id, so two replicas
 * registering it at once still produce one run per period, not two.
 */
export async function startWorkers() {
  startAiWorker();
  startCartRecoveryWorker();
  await scheduleCartRecoveryScan();
  startAdvisorWorker();
  await scheduleAdvisor();
  startTrendsWorker();
  await scheduleTrends();
  logger.info("background workers started");
}

/**
 * Closes every queue this process opened, and its worker if it runs one. BullMQ's close waits for
 * the job a worker is in the middle of, so an AI generation that has started is finished, not lost.
 */
export function closeQueuesOnShutdown() {
  onShutdown("queues", async () => {
    await Promise.all([closeAiQueue(), closeCartRecoveryQueue(), closeAdvisorQueue(), closeTrendsQueue()]);
  });
}
