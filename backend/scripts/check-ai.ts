/**
 * Which AI provider keys work: npm run ai:check
 *
 * Asks each configured provider (Anthropic, and OpenAI if OPENAI_API_KEY is set) for its list of
 * models. That costs nothing and needs a valid key, so no AI allowance or credit is spent. Prints one
 * line per provider, naming the environment variable to fix; never prints a key.
 *
 * Exits 0 when at least one provider works (the AI features will answer), 1 otherwise.
 */
import { checkAiProviders, describeAiHealth } from "../src/lib/aiHealth";

async function main() {
  const health = await checkAiProviders();
  for (const h of health) console.log(`${h.status === "ok" ? "OK  " : h.status === "missing" ? "--  " : "FAIL"}  ${describeAiHealth(h)}`);
  const working = health.filter((h) => h.status === "ok");
  console.log(
    working.length > 0
      ? `\nThe AI features will use ${working.map((h) => h.provider).join(", then ")}.`
      : "\nNo AI provider key works: every AI feature will say it is temporarily unavailable until one is fixed."
  );
  // exitCode, not process.exit(): exiting while the fetch connections close crashes Node on Windows.
  process.exitCode = working.length > 0 ? 0 : 1;
}

void main();
