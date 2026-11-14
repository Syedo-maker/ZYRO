import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { Errors } from "../errors/AppError";
import { directAnswerParams, type ModelTier } from "./aiModels";
import { AiProviderError, isPermanentAiError } from "./aiErrors";
import { openAiProvider } from "./aiOpenAi";
import { logger } from "./logger";
import { createBreaker, type Breaker } from "./circuitBreaker";

export interface AiGenerateParams {
  /** Which model to use, chosen by the orchestrator from the prompt type (lib/aiModels.ts). */
  model: string;
  /**
   * The model tier the prompt type asked for, so a fallback provider can pick its own model of the same
   * class (`model` names the primary provider's model). Absent in jobs queued before this field existed.
   */
  tier?: ModelTier;
  /** Frozen instructions for this promptType; never shopper/merchant-supplied text. */
  system: string;
  /** The one piece of caller-supplied context (product fields, review text, ...). */
  prompt: string;
  maxTokens: number;
  /**
   * An image for the model to look at, sent alongside `prompt` (Part E's payment screenshots).
   * `data` is base64 with no data-URI prefix. Only the models in lib/aiModels.ts that can see
   * images may be asked for this; the orchestrator refuses it for the others.
   */
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };
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
 * of vendor (OpenAI/Anthropic) to sit behind this interface rather than be hardcoded: the real
 * provider is a chain of the configured vendors (Anthropic, then OpenAI as a fallback), tried in
 * AI_PROVIDER_ORDER until one answers.
 */
export interface AiProvider {
  generate(params: AiGenerateParams): Promise<AiGenerateResult>;
}

export interface NamedProvider extends AiProvider {
  name: string;
}

function anthropicProvider(apiKey: string): NamedProvider {
  // One client instance per process, like the Stripe client in lib/stripe.ts.
  // The SDK waits up to 10 minutes by default. The API stops waiting for a generation after
  // AI_JOB_TIMEOUT_MS (60 s); without a limit here the worker would keep that slot busy long after
  // anyone was waiting for the answer. 25 s and one retry finish inside the 60 s.
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });

  return {
    name: "anthropic",
    async generate({ model, system, prompt, maxTokens, image }) {
      const content: Anthropic.ContentBlockParam[] = image
        ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } }, { type: "text", text: prompt }]
        : [{ type: "text", text: prompt }];
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content }],
          // These are short answers: no reasoning tokens (they count against max_tokens and cost output price).
          ...directAnswerParams(model),
        });
      } catch (err) {
        if (err instanceof Anthropic.APIError) throw new AiProviderError("anthropic", err.status, err.message);
        throw new AiProviderError("anthropic", undefined, (err as Error).message);
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!text) {
        // stop_reason "refusal" or a model that only emitted non-text blocks: nothing to
        // save as a draft, and nothing worth charging the tenant's quota for.
        throw new AiProviderError("anthropic", undefined, `returned no text (stop_reason: ${response.stop_reason})`);
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

/** The configured providers, in AI_PROVIDER_ORDER; only those with a key take part. */
export function configuredProviders(): NamedProvider[] {
  const { anthropicApiKey, openAiApiKey, openAiModels, providerOrder } = env.ai;
  const available: Record<string, () => NamedProvider | null> = {
    anthropic: () => (anthropicApiKey?.trim() ? anthropicProvider(anthropicApiKey.trim()) : null),
    openai: () => (openAiApiKey?.trim() ? openAiProvider(openAiApiKey.trim(), openAiModels) : null),
  };
  return providerOrder.map((name) => available[name]?.() ?? null).filter((p): p is NamedProvider => p !== null);
}

/**
 * Tries each provider in turn and returns the first answer. When every one fails, the error thrown is
 * the last provider's, and it counts as permanent only if every failure was (so the queue does not
 * retry a request no provider can ever answer, such as with every key rejected).
 */
export function chainProviders(providers: NamedProvider[], breakerOptions: { threshold?: number; openMs?: number } = {}): AiProvider {
  // A provider that keeps failing (an outage, a rejected key) is skipped for a while
  // (lib/circuitBreaker.ts), so the next one is tried at once instead of after a 25 s timeout.
  const breakers = new Map<string, Breaker>(
    providers.map((p) => [p.name, createBreaker(`ai:${p.name}`, { ...breakerOptions, openError: (name) => new AiProviderError(p.name, undefined, `${name} circuit open`) })])
  );
  return {
    async generate(params) {
      const failures: unknown[] = [];
      for (const provider of providers) {
        try {
          return await breakers.get(provider.name)!.run(() => provider.generate(params));
        } catch (err) {
          failures.push(err);
          const rest = providers.length - failures.length;
          logger.warn({ provider: provider.name, err: (err as Error).message }, rest > 0 ? "AI provider failed, trying the next one" : "AI provider failed");
        }
      }
      const last = failures[failures.length - 1];
      if (failures.every(isPermanentAiError)) throw last;
      // At least one failure was temporary: report a temporary one, so the queue may retry.
      throw failures.find((f) => !isPermanentAiError(f)) ?? last;
    },
  };
}

function createRealProvider(): AiProvider {
  const providers = configuredProviders();
  if (providers.length === 0) {
    throw Errors.serviceUnavailable("AI features are not configured (set ANTHROPIC_API_KEY, or OPENAI_API_KEY as a fallback)");
  }
  return chainProviders(providers);
}

let override: AiProvider | undefined;
let real: AiProvider | undefined;

/** Tests and scripts inject a fake here; pass undefined to restore the real provider. */
export function setAiProvider(provider: AiProvider | undefined) {
  override = provider;
}

/** Whether any AI provider can be asked at all: a key is set, or a test or script installed a fake. */
export function aiConfigured(): boolean {
  return override !== undefined || configuredProviders().length > 0;
}

export function getAiProvider(): AiProvider {
  if (override) return override;
  real ??= createRealProvider();
  return real;
}
