/**
 * Load test of the AI path with a stand-in provider (production readiness, 2026-11): many requests
 * at once through the real orchestrator, queue and worker, with a fake model that takes a fixed time
 * to answer, so the numbers show Zyro's own overhead and the queue's concurrency, not a vendor's.
 *
 *   npx tsx scripts/load-ai.ts [requests] [parallel] [modelMs]
 *   default: 200 requests, 40 at a time, 300 ms per answer
 *
 * Runs on its own queue name and bills the platform (billedTo: "platform"), so no store's allowance
 * or real AI is touched. Needs Redis, PostgreSQL and MongoDB as the API does.
 */
process.env.AI_QUEUE_NAME = `ai-load-${Date.now().toString(36)}`;

async function main() {
  const total = Number(process.argv[2] ?? 200);
  const parallel = Number(process.argv[3] ?? 40);
  const modelMs = Number(process.argv[4] ?? 300);
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { generate } = await import("../src/modules/ai/ai.orchestrator");
  const { closeRedis } = await import("../src/lib/redis");
  const { prismaUnscoped } = await import("../src/lib/prisma");

  setAiProvider({
    async generate() {
      await new Promise((r) => setTimeout(r, modelMs));
      return { text: "ok", model: "fake-load", inputTokens: 10, outputTokens: 10 };
    },
  });
  startAiWorker();

  const latencies: number[] = [];
  let failed = 0;
  let next = 0;
  const started = Date.now();
  const lane = async () => {
    while (next < total) {
      next++;
      const t = Date.now();
      try {
        await generate({ tenantId: "load-test", promptType: "auto_tag", system: "Tag this.", prompt: `item ${next}`, billedTo: "platform" });
        latencies.push(Date.now() - t);
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, lane));
  const seconds = (Date.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
  console.table([
    {
      requests: total,
      parallel,
      "model ms": modelMs,
      "answers/s": Math.round((latencies.length / seconds) * 10) / 10,
      "p50 ms": p(0.5),
      "p95 ms": p(0.95),
      "p99 ms": p(0.99),
      failed,
    },
  ]);
  await closeAiQueue();
  await closeRedis();
  await prismaUnscoped.$disconnect();
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
