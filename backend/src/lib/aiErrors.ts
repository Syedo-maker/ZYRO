import Anthropic from "@anthropic-ai/sdk";

/**
 * A failure reported by an AI provider, in one shape whichever provider it came from, so the
 * fallback chain and the queue can decide what to do without knowing each SDK's error classes.
 * The message is for the server log only; users always get FRIENDLY_AI_UNAVAILABLE.
 */
export class AiProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | undefined,
    message: string
  ) {
    super(`${provider}: ${message}`);
    this.name = "AiProviderError";
  }

  /** The key is missing, wrong or revoked: no retry will help until someone changes it. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** What every AI feature tells a merchant or shopper when no provider could answer. */
export const FRIENDLY_AI_UNAVAILABLE =
  "The AI assistant is temporarily unavailable. Nothing was used from your AI allowance; please try again later.";

/**
 * Whether retrying the same request can ever succeed. A bad request, a rejected key or a model the
 * account may not use fails the same way every time; a timeout, a rate limit or a provider outage
 * may not.
 */
export function isPermanentAiError(err: unknown): boolean {
  const status = err instanceof AiProviderError ? err.status : err instanceof Anthropic.APIError ? err.status : undefined;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
