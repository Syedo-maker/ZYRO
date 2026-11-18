/**
 * The circuit breaker (lib/circuitBreaker.ts) and its use in front of the AI providers: a failing
 * service is skipped at once for a while instead of being waited on, one trial call checks whether it
 * is back, and a caller's own mistakes do not count against the service.
 */
import { createBreaker, guard, CircuitOpenError } from "../../src/lib/circuitBreaker";
import { chainProviders, type NamedProvider } from "../../src/lib/aiProvider";
import { AiProviderError } from "../../src/lib/aiErrors";

const fail = () => Promise.reject(new Error("down"));
const ok = () => Promise.resolve("fine");

describe("the circuit breaker", () => {
  it("opens after the threshold of consecutive failures and then fails at once without calling", async () => {
    let t = 0;
    const b = createBreaker("test-open", { threshold: 3, openMs: 1000, now: () => t });
    for (let i = 0; i < 3; i++) await expect(b.run(fail)).rejects.toThrow("down");
    expect(b.state()).toBe("open");
    const call = jest.fn(ok);
    await expect(b.run(call)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(call).not.toHaveBeenCalled();
  });

  it("a success resets the count", async () => {
    const b = createBreaker("test-reset", { threshold: 3 });
    await expect(b.run(fail)).rejects.toThrow();
    await expect(b.run(fail)).rejects.toThrow();
    await b.run(ok);
    await expect(b.run(fail)).rejects.toThrow();
    expect(b.state()).toBe("closed");
  });

  it("after the open period one trial goes through: success closes it, failure opens it again", async () => {
    let t = 0;
    const b = createBreaker("test-trial", { threshold: 1, openMs: 1000, now: () => t });
    await expect(b.run(fail)).rejects.toThrow();
    t = 1000;
    expect(b.state()).toBe("half-open");
    await expect(b.run(fail)).rejects.toThrow("down");
    expect(b.state()).toBe("open");
    t = 2000;
    expect(await b.run(ok)).toBe("fine");
    expect(b.state()).toBe("closed");
  });

  it("errors that are the caller's own do not count", async () => {
    const b = createBreaker("test-count", { threshold: 1, countsAsFailure: (e) => (e as Error).message !== "bad request" });
    await expect(b.run(() => Promise.reject(new Error("bad request")))).rejects.toThrow();
    expect(b.state()).toBe("closed");
  });

  it("throws the caller's own kind of error while open", async () => {
    class Unavailable extends Error {}
    const b = createBreaker("test-error", { threshold: 1, openError: () => new Unavailable("service unavailable") });
    await expect(b.run(fail)).rejects.toThrow("down");
    await expect(b.run(ok)).rejects.toBeInstanceOf(Unavailable);
  });

  it("guard wraps a client's methods, and leaves the skipped ones synchronous and outside", async () => {
    const b = createBreaker("test-guard", { threshold: 1 });
    const client = { remote: jest.fn(fail), local: (x: number) => x * 2 };
    const guarded = guard(b, client, { skip: ["local"] });
    await expect(guarded.remote()).rejects.toThrow("down");
    await expect(guarded.remote()).rejects.toBeInstanceOf(CircuitOpenError);
    expect(client.remote).toHaveBeenCalledTimes(1);
    expect(guarded.local(21)).toBe(42); // still synchronous, still works while open
  });
});

describe("the AI provider chain with breakers", () => {
  const params = { model: "m", system: "s", prompt: "p", maxTokens: 10 };
  const answer = (name: string) => ({ text: `from ${name}`, model: name, inputTokens: 1, outputTokens: 1 });

  it("a provider that keeps failing is skipped at once, and the next one answers", async () => {
    const primary: NamedProvider = { name: "primary", generate: jest.fn(() => Promise.reject(new AiProviderError("primary", 503, "overloaded"))) };
    const fallback: NamedProvider = { name: "fallback", generate: jest.fn(async () => answer("fallback")) };
    const chain = chainProviders([primary, fallback], { threshold: 2, openMs: 60_000 });
    for (let i = 0; i < 4; i++) expect((await chain.generate(params)).text).toBe("from fallback");
    expect(primary.generate).toHaveBeenCalledTimes(2); // then skipped while open
    expect(fallback.generate).toHaveBeenCalledTimes(4);
  });

  it("with every provider open, the error is temporary (so the friendly 'unavailable' path is taken)", async () => {
    const only: NamedProvider = { name: "only", generate: jest.fn(() => Promise.reject(new AiProviderError("only", 503, "down"))) };
    const chain = chainProviders([only], { threshold: 1, openMs: 60_000 });
    await expect(chain.generate(params)).rejects.toThrow();
    const err = await chain.generate(params).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).status).toBeUndefined();
    expect(only.generate).toHaveBeenCalledTimes(1);
  });
});
