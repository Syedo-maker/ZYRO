import { env } from "../config/env";

/**
 * Which AI provider keys work, without spending anything: each configured provider is asked for its
 * list of models, which costs no tokens and needs a valid key. Used by `npm run ai:check` and logged
 * once when the API starts, so a rejected key shows up in the log by name instead of as every AI
 * feature quietly failing. The result names the environment variable, never its value.
 */

export type AiKeyStatus = "ok" | "missing" | "invalid" | "unreachable";

export interface AiProviderHealth {
  provider: "anthropic" | "openai";
  envVar: string;
  status: AiKeyStatus;
  /** For "unreachable": what happened (an HTTP status or a network error). Never contains the key. */
  detail?: string;
}

const CHECKS = {
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    key: () => env.ai.anthropicApiKey,
    request: (key: string): [string, RequestInit] => ["https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }],
  },
  openai: {
    envVar: "OPENAI_API_KEY",
    key: () => env.ai.openAiApiKey,
    request: (key: string): [string, RequestInit] => ["https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } }],
  },
} as const;

export async function checkAiProviders(fetchImpl: typeof fetch = fetch): Promise<AiProviderHealth[]> {
  return Promise.all(
    (Object.keys(CHECKS) as (keyof typeof CHECKS)[]).map(async (provider) => {
      const check = CHECKS[provider];
      const key = check.key()?.trim();
      if (!key) return { provider, envVar: check.envVar, status: "missing" as const };
      try {
        const [url, init] = check.request(key);
        const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
        if (res.ok) return { provider, envVar: check.envVar, status: "ok" as const };
        if (res.status === 401 || res.status === 403) return { provider, envVar: check.envVar, status: "invalid" as const, detail: `HTTP ${res.status}` };
        return { provider, envVar: check.envVar, status: "unreachable" as const, detail: `HTTP ${res.status}` };
      } catch (err) {
        return { provider, envVar: check.envVar, status: "unreachable" as const, detail: (err as Error).name };
      }
    })
  );
}

/** One line per provider for the log or a terminal, e.g. "ANTHROPIC_API_KEY: rejected by Anthropic (HTTP 401)". */
export function describeAiHealth(h: AiProviderHealth): string {
  const name = h.provider === "anthropic" ? "Anthropic" : "OpenAI";
  switch (h.status) {
    case "ok":
      return `${h.envVar}: works (${name})`;
    case "missing":
      return `${h.envVar}: not set`;
    case "invalid":
      return `${h.envVar}: rejected by ${name} (${h.detail}); replace it with a valid key`;
    default:
      return `${h.envVar}: could not reach ${name} (${h.detail}); the key was not checked`;
  }
}
