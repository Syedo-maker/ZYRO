import { onScrape } from "./metrics";

let registered = false;

/**
 * zyro_queue_jobs{queue, state}: how many jobs each background queue holds, read from Redis when
 * the metrics are scraped. A growing "waiting" count is a backlog (the worker is down or too slow);
 * a growing "failed" count is jobs that need a look (npm run queues).
 */
export function registerQueueMetrics() {
  if (registered) return;
  registered = true;
  onScrape("zyro_queue_jobs", "Background jobs per queue and state.", ["queue", "state"], async (set) => {
    const queues = await Promise.all([
      import("./aiQueue").then((m) => ["ai", m.getAiQueue()] as const),
      import("./cartRecoveryQueue").then((m) => ["cart-recovery", m.getCartRecoveryQueue()] as const),
      import("./advisorQueue").then((m) => ["advisor", m.getAdvisorQueue()] as const),
      import("./trendsQueue").then((m) => ["trends", m.getTrendsQueue()] as const),
      import("./productScoutQueue").then((m) => ["product-scout", m.getProductScoutQueue()] as const),
    ]);
    for (const [name, queue] of queues) {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
      for (const [state, value] of Object.entries(counts)) set({ queue: name, state }, value);
    }
  });
}
