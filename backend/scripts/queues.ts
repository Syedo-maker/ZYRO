/**
 * The background job queues, for an operator (production readiness, 2026-11).
 *
 *   npm run queues                         counts per queue: waiting, active, delayed, failed, completed
 *   npm run queues -- failed <queue> [n]   the newest failed jobs: id, name, store, attempts, reason
 *   npm run queues -- retry <queue> <id|all>   puts failed jobs back in the queue
 *   npm run queues -- clean <queue> <hours>    deletes failed jobs older than that
 *
 * Queues: ai, advisor, cart-recovery, trends, product-scout. Failed jobs are kept (the AI queue keeps
 * its last 200), which is the dead-letter list: nothing is lost silently.
 *
 * What it prints is safe to share: job ids, names, store ids, counts and the first line of the
 * failure reason. Never job payloads, which can hold prompts and customer text.
 *
 * The AI queue cannot be retried here: each AI job answered a request that has already been told it
 * failed (and given its allowance back), so a retry would spend money on an answer nobody receives.
 */
import type { Queue } from "bullmq";
import { getAiQueue } from "../src/lib/aiQueue";
import { getAdvisorQueue } from "../src/lib/advisorQueue";
import { getCartRecoveryQueue } from "../src/lib/cartRecoveryQueue";
import { getTrendsQueue } from "../src/lib/trendsQueue";
import { getProductScoutQueue } from "../src/lib/productScoutQueue";
import { closeRedis } from "../src/lib/redis";

const QUEUES: Record<string, () => Queue> = {
  ai: getAiQueue as () => Queue,
  advisor: getAdvisorQueue,
  "cart-recovery": getCartRecoveryQueue,
  trends: getTrendsQueue,
  "product-scout": getProductScoutQueue,
};

const queueByName = (name: string | undefined) => {
  const get = name ? QUEUES[name] : undefined;
  if (!get) throw new Error(`Name a queue: ${Object.keys(QUEUES).join(", ")}`);
  return get();
};

async function main() {
  const [command = "list", name, arg] = process.argv.slice(2);
  const opened: Queue[] = [];
  try {
    if (command === "list") {
      const rows = [];
      for (const [label, get] of Object.entries(QUEUES)) {
        const q = get();
        opened.push(q);
        const c = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
        rows.push({ queue: label, ...c });
      }
      console.table(rows);
    } else if (command === "failed") {
      const q = queueByName(name);
      opened.push(q);
      const jobs = await q.getFailed(0, Math.max(1, Number(arg ?? 20)) - 1);
      console.table(
        jobs.map((j) => ({
          id: j.id,
          name: j.name,
          store: (j.data as { tenantId?: string })?.tenantId ?? "",
          attempts: j.attemptsMade,
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : "",
          reason: String(j.failedReason ?? "").split("\n")[0].slice(0, 120),
        }))
      );
    } else if (command === "retry") {
      if (name === "ai") throw new Error("AI jobs are not retried: their requests have already been answered (see the note at the top of this script).");
      const q = queueByName(name);
      opened.push(q);
      const jobs = arg === "all" ? await q.getFailed() : [await q.getJob(String(arg))].filter((j) => j !== undefined);
      if (jobs.length === 0) throw new Error("No such failed job.");
      for (const j of jobs) await j!.retry();
      console.log(`Retried ${jobs.length} job(s) in ${name}.`);
    } else if (command === "clean") {
      const q = queueByName(name);
      opened.push(q);
      const hours = Number(arg);
      if (!(hours >= 0)) throw new Error("Give an age in hours, for example 168 for a week.");
      const removed = await q.clean(hours * 60 * 60 * 1000, 10_000, "failed");
      console.log(`Removed ${removed.length} failed job(s) older than ${hours} hours from ${name}.`);
    } else {
      throw new Error(`Unknown command "${command}". Use list, failed, retry or clean.`);
    }
  } finally {
    await Promise.all(opened.map((q) => q.close()));
    await closeRedis();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
