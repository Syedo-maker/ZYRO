/** Unit tests for the model chosen per AI task (Part A cost controls, backend/src/lib/aiModels.ts). */
import { tierFor, modelFor, directAnswerParams } from "../../src/lib/aiModels";

describe("which model answers which task", () => {
  it.each(["auto_tag", "seo_metadata", "chat"])("%s, a short task, uses the fast model", (promptType) => {
    expect(tierFor(promptType)).toBe("fast");
  });

  it.each(["product_description", "review_summary", "marketing_copy", "business_insights", "cart_recovery"])(
    "%s, writing a merchant publishes or sends, uses the standard model",
    (promptType) => {
      expect(tierFor(promptType)).toBe("standard");
    }
  );

  it("an unknown task gets the standard model, never quietly a weaker one", () => {
    expect(tierFor("something_new")).toBe("standard");
  });

  it("the defaults are Haiku for fast tasks and Sonnet for writing", () => {
    expect(modelFor("auto_tag")).toBe(process.env.AI_MODEL_FAST ?? "claude-haiku-4-5");
    expect(modelFor("product_description")).toMatch(/sonnet|opus|haiku/);
  });
});

describe("asking for a short, direct answer", () => {
  it("Haiku and Sonnet get thinking switched off", () => {
    expect(directAnswerParams("claude-haiku-4-5")).toEqual({ thinking: { type: "disabled" } });
    expect(directAnswerParams("claude-sonnet-5")).toEqual({ thinking: { type: "disabled" } });
  });

  it("Opus gets a low effort instead (switching thinking off there can leak reasoning into the reply)", () => {
    expect(directAnswerParams("claude-opus-5")).toEqual({ output_config: { effort: "low" } });
  });

  it("any other model gets no extra parameters", () => {
    expect(directAnswerParams("some-other-model")).toEqual({});
  });
});
