/**
 * Fills the landing page demo's cache, once, ahead of time.
 *
 * The demo offers a handful of prepared product phrases as clickable chips. This generates the
 * suggestions for each of them and stores them in Redis, so a visitor who clicks one costs nothing:
 * no AI call, no store's allowance, no waiting. Run it after a deployment, or any time Redis has
 * been cleared.
 *
 *   npx tsx scripts/seed-demo-ideas.ts
 *   npx tsx scripts/seed-demo-ideas.ts --force     regenerate even what is already cached
 *
 * It costs one AI call per example that is missing, paid for by the platform, which at six examples
 * is a few cents. Nothing is written to any database.
 */
import "dotenv/config";
import { normaliseCategory } from "../src/modules/trends/trends.aggregate";
import { DEMO_EXAMPLES, normaliseDemoPhrase } from "../src/modules/demo/demo.examples";
import { demoInternals } from "../src/modules/demo/demo.service";

async function main() {
  const force = process.argv.includes("--force");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { closeRedis } = await import("../src/lib/redis");

  // Generation goes through the normal queue, so this script runs the worker itself rather than
  // needing the server up.
  startAiWorker();

  let generated = 0;
  let kept = 0;
  let failed = 0;

  for (const example of DEMO_EXAMPLES) {
    const phrase = normaliseDemoPhrase(example.phrase);
    const category = normaliseCategory(example.category);

    if (!force) {
      const existing = await demoInternals.readCache(phrase, category);
      if (existing) {
        console.log(`kept      ${phrase} (${existing.suggestions.length} suggestions already cached)`);
        kept += 1;
        continue;
      }
    }

    const result = await demoInternals.generateLive(phrase, category);
    if (!result) {
      console.log(`FAILED    ${phrase} (the AI did not return anything usable)`);
      failed += 1;
      continue;
    }

    await demoInternals.writeCache(phrase, category, result);
    const keywords = result.keywords.length > 0 ? result.keywords.slice(0, 5).join(", ") : "no trend data for this category";
    console.log(`generated ${phrase}: ${result.suggestions.length} suggestions, keywords: ${keywords}`);
    generated += 1;
  }

  console.log(`\nDone. ${generated} generated, ${kept} already cached, ${failed} failed.`);
  if (failed > 0) console.log("A failed example still works at request time: the demo generates it once and caches it then.");

  await closeAiQueue();
  await closeRedis();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
