/**
 * The AI provider chain, the OpenAI fallback adapter and the key health check (A1, 2026-11), all with
 * fake providers and a fake fetch: no real AI call and no real key is used.
 */
import { chainProviders, type NamedProvider } from "../../src/lib/aiProvider";
import { AiProviderError, FRIENDLY_AI_UNAVAILABLE, isPermanentAiError } from "../../src/lib/aiErrors";
import { openAiProvider } from "../../src/lib/aiOpenAi";
import { checkAiProviders, describeAiHealth } from "../../src/lib/aiHealth";
import { env } from "../../src/config/env";
import type { AiGenerateParams } from "../../src/lib/aiProvider";

const params: AiGenerateParams = { model: "claude-haiku-4-5", tier: "fast", system: "Be brief.", prompt: "Hello", maxTokens: 50 };
const answer = (text: string) => ({ text, model: "m", inputTokens: 1, outputTokens: 1 });

function provider(name: string, behaviour: () => Promise<ReturnType<typeof answer>>): NamedProvider & { calls: number } {
  const p = {
    name,
    calls: 0,
    async generate() {
      p.calls += 1;
      return behaviour();
    },
  };
  return p;
}

describe("the provider chain", () => {
  it("answers from the first provider when it works, and never asks the fallback", async () => {
    const first = provider("anthropic", async () => answer("from anthropic"));
    const second = provider("openai", async () => answer("from openai"));
    await expect(chainProviders([first, second]).generate(params)).resolves.toMatchObject({ text: "from anthropic" });
    expect(second.calls).toBe(0);
  });

  it("falls back to the next provider when the first key is rejected", async () => {
    const first = provider("anthropic", async () => Promise.reject(new AiProviderError("anthropic", 401, "invalid x-api-key")));
    const second = provider("openai", async () => answer("from openai"));
    await expect(chainProviders([first, second]).generate(params)).resolves.toMatchObject({ text: "from openai" });
    expect(first.calls).toBe(1);
  });

  it("falls back when the first provider is down or rate limited", async () => {
    for (const status of [500, 529, 429, undefined]) {
      const first = provider("anthropic", async () => Promise.reject(new AiProviderError("anthropic", status, "busy")));
      const second = provider("openai", async () => answer("ok"));
      await expect(chainProviders([first, second]).generate(params)).resolves.toMatchObject({ text: "ok" });
    }
  });

  it("when every key is rejected, fails with a permanent error (the queue does not retry it)", async () => {
    const a = provider("anthropic", async () => Promise.reject(new AiProviderError("anthropic", 401, "invalid")));
    const b = provider("openai", async () => Promise.reject(new AiProviderError("openai", 401, "invalid")));
    const err = await chainProviders([a, b]).generate(params).catch((e) => e);
    expect(isPermanentAiError(err)).toBe(true);
  });

  it("when one failure was only temporary, the error stays retryable", async () => {
    const a = provider("anthropic", async () => Promise.reject(new AiProviderError("anthropic", 401, "invalid")));
    const b = provider("openai", async () => Promise.reject(new AiProviderError("openai", 503, "down")));
    const err = await chainProviders([a, b]).generate(params).catch((e) => e);
    expect(isPermanentAiError(err)).toBe(false);
  });
});

describe("which failures are permanent", () => {
  it.each([
    [400, true],
    [401, true],
    [403, true],
    [404, true],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
    [undefined, false],
  ])("HTTP %s -> permanent %s", (status, permanent) => {
    expect(isPermanentAiError(new AiProviderError("anthropic", status as number | undefined, "x"))).toBe(permanent);
  });

  it("users are told the friendly sentence, never a provider's error", () => {
    expect(FRIENDLY_AI_UNAVAILABLE).toMatch(/^The AI assistant is temporarily unavailable\./);
    expect(FRIENDLY_AI_UNAVAILABLE).toMatch(/Nothing was used from your AI allowance/);
  });
});

describe("the OpenAI fallback adapter", () => {
  const models = { fast: "gpt-fast", standard: "gpt-standard" };

  it("sends the system and user text to the tier's model and returns the reply and token counts", async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization };
      return new Response(JSON.stringify({ model: "gpt-fast-2026", choices: [{ message: { content: " Hi there " } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await openAiProvider("sk-test-dummy", models, fakeFetch).generate(params);
    expect(result).toEqual({ text: "Hi there", model: "gpt-fast-2026", inputTokens: 12, outputTokens: 3 });
    expect(sent?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent?.body).toMatchObject({ model: "gpt-fast", max_completion_tokens: 50, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }] });
    expect(sent?.auth).toBe("Bearer sk-test-dummy");
  });

  it("uses the standard model when the tier is standard or unknown", async () => {
    let model = "";
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      model = JSON.parse(String(init.body)).model;
      return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await openAiProvider("k", models, fakeFetch).generate({ ...params, tier: undefined });
    expect(model).toBe("gpt-standard");
  });

  it("turns an HTTP error into an AiProviderError with the status", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 })) as unknown as typeof fetch;
    const err = await openAiProvider("bad", models, fakeFetch).generate(params).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.status).toBe(401);
    expect(err.isAuth).toBe(true);
  });

  it("an empty reply is a failure, not an empty answer charged to the store", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(openAiProvider("k", models, fakeFetch).generate(params)).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("the AI key health check", () => {
  const saved = { a: env.ai.anthropicApiKey, o: env.ai.openAiApiKey };
  afterEach(() => {
    env.ai.anthropicApiKey = saved.a;
    env.ai.openAiApiKey = saved.o;
  });

  it("reports a rejected key and a missing one by variable name, without the key itself", async () => {
    env.ai.anthropicApiKey = "sk-ant-dummy-rejected";
    env.ai.openAiApiKey = undefined;
    const fakeFetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const health = await checkAiProviders(fakeFetch);
    expect(health).toEqual([
      { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", status: "invalid", detail: "HTTP 401" },
      { provider: "openai", envVar: "OPENAI_API_KEY", status: "missing" },
    ]);
    const lines = health.map(describeAiHealth).join("\n");
    expect(lines).toMatch(/ANTHROPIC_API_KEY: rejected by Anthropic/);
    expect(lines).not.toMatch(/sk-ant-dummy/);
  });

  it("reports a working key as ok, and a network failure as unreachable rather than invalid", async () => {
    env.ai.anthropicApiKey = "a";
    env.ai.openAiApiKey = "o";
    const fakeFetch = (async (url: string) => {
      if (url.includes("anthropic")) return new Response("{}", { status: 200 });
      throw Object.assign(new Error("offline"), { name: "TypeError" });
    }) as unknown as typeof fetch;
    const health = await checkAiProviders(fakeFetch);
    expect(health.map((h) => h.status)).toEqual(["ok", "unreachable"]);
  });
});
