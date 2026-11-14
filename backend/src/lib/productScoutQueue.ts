import { Queue, Worker } from "bullmq";
import { getBullRedis } from "./redis";
import { prismaUnscoped } from "./prisma";
import { scoutService } from "../modules/scout/scout.service";
import { logger } from "./logger";

/**
 * Product Scout's daily run (2026-10-22): 04:30 UTC (09:30 in Pakistan), before owners open the
 * dashboard. The same shape as the other queues: idempotent schedule, one worker, overridable name for
 * tests. When the worker starts and no snapshot exists yet (a new database), or the newest one is
 * from before today (the server was off at 04:30), it runs once straight away rather than leaving the
 * panel empty or out of date until the next morning.
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
  const newest = await prismaUnscoped.productScoutSnapshot.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } });
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!newest || newest.computedAt < todayStart) {
    // One catch-up run per day at most: the job id carries the date, so restarts the same day reuse it.
    const day = todayStart.toISOString().slice(0, 10);
    await getProductScoutQueue().add("catch-up", {}, { jobId: `product-scout-catch-up-${day}`, removeOnComplete: { age: 2 * 24 * 3600 }, removeOnFail: { count: 5 } });
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
