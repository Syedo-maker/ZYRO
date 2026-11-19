import { Queue, Worker } from "bullmq";
import { getBullRedis } from "./redis";
import { logger } from "./logger";
import { runPlanPaymentSweep } from "../modules/planPayments/planPayments.jobs";

/**
 * Plan payments' time-driven work (Pro plan payments, 2026-11): approver reminders, provisional plans
 * that ran out, plan-ending notices and downgrades to Free. Every 15 minutes, the same shape as the
 * other queues: an idempotent schedule, one worker, and a name tests can override.
 */
export const PLAN_PAYMENTS_QUEUE_NAME = process.env.PLAN_PAYMENTS_QUEUE_NAME ?? "plan-payments";
const SCHEDULER_ID = "plan-payments-sweep";

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getPlanPaymentsQueue(): Queue {
  queue ??= new Queue(PLAN_PAYMENTS_QUEUE_NAME, { connection: getBullRedis() });
  return queue;
}

export async function schedulePlanPayments(): Promise<void> {
  await getPlanPaymentsQueue().upsertJobScheduler(SCHEDULER_ID, { every: 15 * 60 * 1000 }, { name: "sweep" });
}

export function startPlanPaymentsWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    PLAN_PAYMENTS_QUEUE_NAME,
    async () => {
      const counts = await runPlanPaymentSweep();
      if (Object.values(counts).some((n) => n > 0)) logger.info(counts, "[plan payments] sweep");
      return counts;
    },
    { connection: getBullRedis(), concurrency: 1 },
  );
  worker.on("error", (err) => logger.error({ err: err.message }, "plan payments worker error"));
  worker.on("failed", (_job, err) => logger.error({ err: err.message }, "plan payments sweep failed"));
  return worker;
}

export async function closePlanPaymentsQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}
