import { Queue, Worker } from "bullmq";
import { getBullRedis } from "./redis";
import { prismaUnscoped } from "./prisma";
import { scoutService } from "../modules/scout/scout.service";
import { logger } from "./logger";

/**
 * Product Scout's daily run (2026-10-22): 04:30 UTC (09:30 in Pakistan), before owners open the
 * dashboard. The same shape as the other queues: idempotent schedule, one worker, overridable name for
 * tests. When the worker starts and no snapshot exists yet (a new database), it runs once straight
 * away rather than leaving the panel empty until the next morning.
 */
export const PRODUCT_SCOUT_QUEUE_NAME = process.env.PRODUCT_SCOUT_QUEUE_NAME ?? "product-scout";
const SCHEDULER_ID = "product-scout-daily";

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getProductScoutQueue(): Queue {
  queue ??= new Queue(PRODUCT_SCOUT_QUEUE_NAME, { connection: getBullRedis() });
  return queue;
}

export async function scheduleProductScout(): Promise<void> {
  await getProductScoutQueue().upsertJobScheduler(SCHEDULER_ID, { pattern: "30 4 * * *", tz: "UTC" }, { name: "daily" });
  if ((await prismaUnscoped.productScoutSnapshot.count()) === 0) {
    await getProductScoutQueue().add("first-run", {}, { jobId: "product-scout-first-run", removeOnComplete: true, removeOnFail: { count: 5 } });
  }
}

export function startProductScoutWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    PRODUCT_SCOUT_QUEUE_NAME,
    async () => {
      const o = await scoutService.refresh();
      logger.info(`[scout] up to ${o.windowEnd}: ${o.snapshots.length} snapshot(s) ${o.snapshots.join(", ")}`);
      return o;
    },
    { connection: getBullRedis(), concurrency: 1 }
  );
  worker.on("error", (err) => logger.error({ err: err.message }, "product scout worker error"));
  worker.on("failed", (_job, err) => logger.error({ err: err.message }, "product scout run failed"));
  return worker;
}

export async function closeProductScoutQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}
