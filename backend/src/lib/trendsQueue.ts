import { Queue, Worker } from "bullmq";
import { getBullRedis } from "./redis";
import { trendsService } from "../modules/trends/trends.service";

/**
 * The Trend Scout's weekly run (Part D). Mondays at 05:00 UTC (10:00 in Pakistan), an hour before the
 * Growth Advisor, so the week's market reports are ready when merchants open the dashboard. The same
 * shape as the other queues: idempotent schedule, one worker, overridable name for tests.
 */
export const TRENDS_QUEUE_NAME = process.env.TRENDS_QUEUE_NAME ?? "trend-scout";
const SCHEDULER_ID = "trend-scout-weekly";

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getTrendsQueue(): Queue {
  queue ??= new Queue(TRENDS_QUEUE_NAME, { connection: getBullRedis() });
  return queue;
}

export async function scheduleTrends(): Promise<void> {
  await getTrendsQueue().upsertJobScheduler(SCHEDULER_ID, { pattern: "0 5 * * 1", tz: "UTC" }, { name: "weekly" });
}

export function startTrendsWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    TRENDS_QUEUE_NAME,
    async () => {
      const o = await trendsService.runWeek();
      console.log(`[trends] week of ${o.weekStart}: ${o.published} published, ${o.suppressed} withheld, ${o.noData} no data, ${o.existing} already done, ${o.failed} failed`);
      return o;
    },
    { connection: getBullRedis(), concurrency: 1 }
  );
  worker.on("error", (err) => console.error("Trends worker error:", err.message));
  return worker;
}

export async function closeTrendsQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}
