import { Queue, Worker } from "bullmq";
import { getBullRedis } from "./redis";
import { advisorService } from "../modules/advisor/advisor.service";
import { logger } from "./logger";

/**
 * The Growth Advisor's weekly run (Part C). Mondays at 06:00 UTC, which is 11:00 in Pakistan, so a
 * merchant opening the dashboard that day sees the new tip. Overridable queue name for the same
 * reason as the other queues (lib/aiQueue.ts): a test needs its own.
 */
export const ADVISOR_QUEUE_NAME = process.env.ADVISOR_QUEUE_NAME ?? "growth-advisor";
const SCHEDULER_ID = "growth-advisor-weekly";

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getAdvisorQueue(): Queue {
  queue ??= new Queue(ADVISOR_QUEUE_NAME, { connection: getBullRedis() });
  return queue;
}

/** Registers (or updates) the weekly schedule. Idempotent, like the cart-recovery scan. */
export async function scheduleAdvisor(): Promise<void> {
  await getAdvisorQueue().upsertJobScheduler(SCHEDULER_ID, { pattern: "0 6 * * 1", tz: "UTC" }, { name: "weekly" });
}

export function startAdvisorWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    ADVISOR_QUEUE_NAME,
    async () => {
      const outcome = await advisorService.runAll();
      logger.info({ job: "advisor", ...outcome }, "weekly Growth Advisor run finished");
      return outcome;
    },
    { connection: getBullRedis(), concurrency: 1 }
  );
  worker.on("error", (err) => logger.error({ err: err.message }, "advisor worker error"));
  return worker;
}

export async function closeAdvisorQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}
