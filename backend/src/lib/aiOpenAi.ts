import { AiProviderError } from "./aiErrors";
import type { AiGenerateParams, AiGenerateResult } from "./aiProvider";

/**
 * The fallback AI provider: OpenAI's chat completions API, called with fetch (no SDK, so no new
 * dependency). Used only when OPENAI_API_KEY is set, and only after the primary provider failed
 * (lib/aiProvider.ts). Its model for each tier is OPENAI_MODEL_FAST / OPENAI_MODEL_STANDARD.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 25_000; // the same budget as the Anthropic client: one try inside the 60 s job timeout

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export function openAiProvider(apiKey: string, models: { fast: string; standard: string }, fetchImpl: typeof fetch = fetch) {
  return {
    name: "openai",
    async generate({ tier, system, prompt, maxTokens, image }: AiGenerateParams): Promise<AiGenerateResult> {
      const model = models[tier ?? "standard"];
      const user = image
        ? [
            { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
            { type: "text", text: prompt },
          ]
        : prompt;
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            max_completion_tokens: maxTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new AiProviderError("openai", undefined, `request failed: ${(err as Error).message}`);
      }
      const body = (await res.json().catch(() => ({}))) as ChatCompletion;
      if (!res.ok) throw new AiProviderError("openai", res.status, body.error?.message ?? `HTTP ${res.status}`);
      const text = (body.choices?.[0]?.message?.content ?? "").trim();
      if (!text) throw new AiProviderError("openai", undefined, "returned no text");
      return { text, model: body.model ?? model, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
    },
  };
}
