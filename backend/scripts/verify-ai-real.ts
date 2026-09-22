/**
 * A single real call to the Anthropic API, through the real provider adapter (not the fake
 * used by verify-ai.ts), to confirm the adapter's request/response shape actually works
 * against the live API. This costs real money and is never run automatically by anything in
 * this repo (not part of `npm run dev`, not in the regression list any documentation names as
 * "run everything"); run it yourself, on purpose, after setting ANTHROPIC_API_KEY.
 *
 * Usage: npx tsx scripts/verify-ai-real.ts   (Redis must be running on REDIS_URL; requires a
 * real ANTHROPIC_API_KEY in the environment or backend/.env)
 */
process.env.RATE_LIMIT_ENABLED = "false";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("SKIP: ANTHROPIC_API_KEY is not set. Set it (see backend/.env.example) and run this script again.");
    process.exit(0);
  }

  // Calls the provider adapter directly, not generate() (ai.orchestrator.ts): that would also
  // need a real Tenant row for the quota system's foreign key, and the queue/quota plumbing
  // around the adapter is already covered, against a fake provider, by verify-ai.ts. This
  // script's only job is to confirm the adapter's request/response shape against the real API.
  const { getAiProvider } = await import("../src/lib/aiProvider");

  try {
    const result = await getAiProvider().generate({
      system: "You write one short, plain sentence and nothing else.",
      prompt: "Describe a ceramic coffee mug for an online store listing.",
      maxTokens: 200,
    });
    check("real: the Anthropic API returns non-empty text", result.text.length > 0, result.text.slice(0, 80));
    check("real: the response reports which model actually answered", result.model.length > 0, result.model);
    check("real: token usage is reported (for cost/quota accounting)", result.inputTokens > 0 && result.outputTokens > 0, `in=${result.inputTokens} out=${result.outputTokens}`);
  } catch (err) {
    check("real: the call succeeded", false, err instanceof Error ? err.message : String(err));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
