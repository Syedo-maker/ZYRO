/**
 * Calls the real Anthropic API through the real provider adapter, once per model tier, to prove the
 * request shape (model per task, thinking switched off or low effort) works against the live API.
 * It costs real money (a few cents at most), so it never runs with `npm test`; run it on purpose:
 *   npm run test:real -- anthropic
 * Needs ANTHROPIC_API_KEY in backend/.env. Without it the suite fails and says so, instead of
 * quietly passing: an unset key is exactly the gap this suite exists to close.
 */
import "dotenv/config";

const hasKey = !!process.env.ANTHROPIC_API_KEY;

describe("the real Anthropic API", () => {
  if (!hasKey) {
    it("needs ANTHROPIC_API_KEY in backend/.env", () => {
      throw new Error("ANTHROPIC_API_KEY is not set, so the real API was not called. Add it to backend/.env and run again.");
    });
    return;
  }

  let provider: import("../../src/lib/aiProvider").AiProvider;
  let modelFor: (promptType: string) => string;

  beforeAll(async () => {
    provider = (await import("../../src/lib/aiProvider")).getAiProvider();
    modelFor = (await import("../../src/lib/aiModels")).modelFor;
  });

  it.each([
    ["the fast model (auto-tag, SEO, chat)", "auto_tag"],
    ["the standard model (descriptions, summaries, marketing)", "product_description"],
  ])("%s answers with text, names its model and reports token use", async (_label, promptType) => {
    const model = modelFor(promptType);
    const result = await provider.generate({
      model,
      system: "You write one short, plain sentence and nothing else.",
      prompt: "Describe a ceramic coffee mug for an online store listing.",
      // As small as the smallest real task (auto-tag uses 100): with thinking on, the reply would not fit.
      maxTokens: 100,
    });
    expect(result.text.length).toBeGreaterThan(10);
    expect(result.model).toContain(model.replace(/-\d{8}$/, ""));
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeLessThanOrEqual(100);
  });

  it("a request in the strict two-line format used by auto-tag is followed", async () => {
    const result = await provider.generate({
      model: modelFor("auto_tag"),
      system:
        "Suggest a single short category and 3 to 6 short tags for this product, based only on the title and " +
        "description given. Reply with EXACTLY two lines and nothing else, in this exact format:\n" +
        "Category: <category>\nTags: <tag1>, <tag2>, <tag3>",
      prompt: "Title: Ceramic coffee mug\nDescription: Stoneware mug that keeps coffee warm\nCurrent category: kitchen",
      maxTokens: 100,
    });
    expect(result.text).toMatch(/Category:\s*\S/i);
    expect(result.text).toMatch(/Tags:\s*\S/i);
  });
});
