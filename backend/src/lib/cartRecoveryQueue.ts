import { Queue, Worker } from "bullmq";
import { getBullRedis } from "./redis";
import { env } from "../config/env";
import { cartRecoveryService } from "../modules/cart-recovery/cartRecovery.service";

/**
 * The repeatable scan behind abandoned-cart recovery (Implementation_Plan.md Phase 5, Module 7
 * remainder). Overridable for the same reason AI_QUEUE_NAME is (lib/aiQueue.ts): BullMQ queues
 * are a Redis-global resource, so a verify script needs its own queue name to avoid a real
 * backend's worker racing it for the same scheduled job.
 */
export const CART_RECOVERY_QUEUE_NAME = process.env.CART_RECOVERY_QUEUE_NAME ?? "cart-recovery-scan";
const SCHEDULER_ID = "cart-recovery-scan";

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getCartRecoveryQueue(): Queue {
  queue ??= new Queue(CART_RECOVERY_QUEUE_NAME, { connection: getBullRedis() });
  return queue;
}

/** Registers (or updates) the repeatable job. Idempotent: calling this again with a different
 *  interval replaces the schedule rather than adding a second one, since it shares SCHEDULER_ID. */
export async function scheduleCartRecoveryScan(): Promise<void> {
  await getCartRecoveryQueue().upsertJobScheduler(SCHEDULER_ID, { every: env.cartRecovery.scanIntervalHours * 60 * 60 * 1000 }, { name: "scan" });
}

/** Starts the worker that actually runs the scan. Called once from src/index.ts, alongside the
 *  AI worker: this is a single-process app, so the scheduler and its worker share the process. */
export function startCartRecoveryWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(CART_RECOVERY_QUEUE_NAME, async () => cartRecoveryService.scan(), { connection: getBullRedis(), concurrency: 1 });
  worker.on("error", (err) => console.error("Cart recovery worker error:", err.message));
  return worker;
}

export async function closeCartRecoveryQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}
