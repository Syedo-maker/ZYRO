import { env } from "../config/env";

/**
 * Node's side of the Phase 6 recommendation microservice (recommendation-service/, Python).
 * Same shape as the other outside-world gateways (StripeGateway, AiProvider, EmailGateway): an
 * interface, a real implementation that is only built when configured, and a setter tests use to
 * swap in a fake so nothing here needs a running Python process.
 */

export interface ScoredProduct {
  productId: string;
  score: number;
}

export interface RecommendationClient {
  /** Products similar to `productId`, best first. Null when the service says the product is not in the store. */
  recommend(storeId: string, productId: string, limit: number): Promise<ScoredProduct[] | null>;
  /** Products whose meaning is close to free text (used by the shopping assistant). */
  search(storeId: string, query: string, limit: number): Promise<ScoredProduct[]>;
  /** Warm one product's vector after it was created or edited. */
  embedProduct(storeId: string, productId: string): Promise<void>;
}

/** The service is not configured, down, too slow, or answered with an error. Callers treat every
 *  one of these the same way: carry on without recommendations. */
export class RecommendationUnavailableError extends Error {}

class HttpRecommendationClient implements RecommendationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number
  ) {}

  private async request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { "X-Internal-Token": this.token, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new RecommendationUnavailableError(`Recommendation service unreachable: ${(err as Error).message}`);
    }
  }

  async recommend(storeId: string, productId: string, limit: number) {
    const qs = new URLSearchParams({ storeId, productId, limit: String(limit) });
    const res = await this.request(`/recommendations?${qs}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new RecommendationUnavailableError(`Recommendation service answered ${res.status}`);
    return ((await res.json()) as { items: ScoredProduct[] }).items;
  }

  async search(storeId: string, query: string, limit: number) {
    const res = await this.request("/search", { method: "POST", body: { storeId, query, limit } });
    if (!res.ok) throw new RecommendationUnavailableError(`Recommendation service answered ${res.status}`);
    return ((await res.json()) as { items: ScoredProduct[] }).items;
  }

  async embedProduct(storeId: string, productId: string) {
    const res = await this.request("/embed/product", { method: "POST", body: { storeId, productId } });
    if (!res.ok) throw new RecommendationUnavailableError(`Recommendation service answered ${res.status}`);
  }
}

/** What an unconfigured install uses: every call reports "unavailable", which callers already handle. */
class UnconfiguredClient implements RecommendationClient {
  private fail(): never {
    throw new RecommendationUnavailableError("Recommendation service is not configured (RECOMMENDATION_SERVICE_URL and RECOMMENDATION_SERVICE_TOKEN)");
  }
  // async, so the error is a rejected promise like every other failure, never a synchronous throw
  // out of a call site that only attaches .catch() (indexProductInBackground).
  async recommend(): Promise<ScoredProduct[] | null> {
    return this.fail();
  }
  async search(): Promise<ScoredProduct[]> {
    return this.fail();
  }
  async embedProduct(): Promise<void> {
    return this.fail();
  }
}

let client: RecommendationClient | undefined;

export function getRecommendationClient(): RecommendationClient {
  if (!client) {
    const { url, token, timeoutMs } = env.recommendation;
    client = url && token ? new HttpRecommendationClient(url.replace(/\/+$/, ""), token, timeoutMs) : new UnconfiguredClient();
  }
  return client;
}

/** For tests: install a fake (or pass undefined to go back to the environment-configured client). */
export function setRecommendationClient(next: RecommendationClient | undefined): void {
  client = next;
}

/**
 * Fire-and-forget, as Implementation_Plan.md Phase 6 asks: called after a product is created or
 * edited, never awaited by the request, never able to fail it. The service also repairs any
 * missed vector the next time it is asked for recommendations, so a lost call costs nothing but
 * a slightly slower first request.
 */
export function indexProductInBackground(storeId: string, productId: string): void {
  void getRecommendationClient()
    .embedProduct(storeId, productId)
    .catch((err: unknown) => {
      if (err instanceof RecommendationUnavailableError && /not configured/.test(err.message)) return; // expected when the feature is off
      console.warn(`[recommendations] could not index product ${productId}: ${(err as Error).message}`);
    });
}
