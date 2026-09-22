import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { Errors } from "../errors/AppError";

export interface AiGenerateParams {
  /** Frozen instructions for this promptType; never shopper/merchant-supplied text. */
  system: string;
  /** The one piece of caller-supplied context (product fields, review text, ...). */
  prompt: string;
  maxTokens: number;
}

export interface AiGenerateResult {
  text: string;
  /** Which model actually produced this, for AiGeneratedContent.model (Implementation_Plan.md Phase 4). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * What the rest of the app needs from an LLM provider. Kept to one method, same as
 * StripeGateway (lib/stripe.ts), so tests and the verify script can substitute a fake instead
 * of spending real API calls. The plan (Implementation_Plan.md Phase 4) calls for the choice
 * of vendor (OpenAI/Anthropic) to sit behind this interface rather than be hardcoded; only an
 * Anthropic adapter is implemented so far, so this is the seam a second adapter would fill.
 */
export interface AiProvider {
  generate(params: AiGenerateParams): Promise<AiGenerateResult>;
}

function createRealProvider(): AiProvider {
  const { anthropicApiKey, model } = env.ai;
  if (!anthropicApiKey) {
    throw Errors.serviceUnavailable("AI features are not configured (set ANTHROPIC_API_KEY)");
  }
  // One client instance per process, like the Stripe client in lib/stripe.ts.
  const client = new Anthropic({ apiKey: anthropicApiKey });

  return {
    async generate({ system, prompt, maxTokens }) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!text) {
        // stop_reason "refusal" or a model that only emitted non-text blocks: nothing to
        // save as a draft, and nothing worth charging the tenant's quota for.
        throw new Error(`AI provider returned no text (stop_reason: ${response.stop_reason})`);
      }

      return {
        text,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

let override: AiProvider | undefined;
let real: AiProvider | undefined;

/** Tests and scripts inject a fake here; pass undefined to restore the real provider. */
export function setAiProvider(provider: AiProvider | undefined) {
  override = provider;
}

export function getAiProvider(): AiProvider {
  if (override) return override;
  real ??= createRealProvider();
  return real;
}
