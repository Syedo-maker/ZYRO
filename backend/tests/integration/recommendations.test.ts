/**
 * End-to-end check of Phase 6, the AI Recommendation Service (Implementation_Plan.md): the real
 * Python/FastAPI service (spawned here, deterministic "hashing" embedder so nothing is downloaded)
 * against the real MongoDB, reached through Node's own public endpoint
 * GET /stores/:storeId/products/:productId/recommendations. Also checks the parts that must
 * degrade gracefully (service down, wrong token, not configured) and the assistant's merge of
 * keyword and semantic matches (with a fake client, since that part is Node logic).
 * Run with: npm test -- recommendations
 */
import { appFetch, APP_ORIGIN } from "../helpers/appFetch";
import { createCheckRecorder, snapshotEnv } from "../helpers/checks";

// Every environment variable this file sets is put back afterwards (see afterAll).
const restoreEnv = snapshotEnv();
const { check, run, declare } = createCheckRecorder();
function exitScenario(code: number): never {
  throw new Error(`The scenario stopped early (exit code ${code})`);
}

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const SERVICE_PORT = 8011;
const TOKEN = `verify-token-${Date.now().toString(36)}`;
process.env.RATE_LIMIT_ENABLED = "false";
process.env.RECOMMENDATION_SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`;
process.env.RECOMMENDATION_SERVICE_TOKEN = TOKEN;
process.env.RECOMMENDATION_CACHE_SECONDS = "60";
// The assistant checks below use their own BullMQ queue and fake AI provider (see verify-assistant.ts).
process.env.AI_QUEUE_NAME = `ai-generate-verify-${Date.now().toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 8000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return undefined;
}

async function main() {
  const { app } = await import("../../src/app");
  const { env } = await import("../../src/config/env");
  const { connectMongo } = await import("../../src/lib/mongo");
  const { prismaUnscoped } = await import("../../src/lib/prisma");
  const { closeRedis } = await import("../../src/lib/redis");
  const { setAiProvider } = await import("../../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../../src/lib/aiQueue");
  const { setRecommendationClient, RecommendationUnavailableError } = await import("../../src/lib/recommendationClient");
  const { recommendationService } = await import("../../src/modules/recommendations/recommendation.service");
  const { Product } = await import("../../src/models/Product.model");
  const { ChatTranscript } = await import("../../src/models/ChatTranscript.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  startAiWorker();
  const fetch = appFetch(app, [process.env.PUBLIC_URL ?? "http://localhost:5000"]);
  const base = `${APP_ORIGIN}/api/v1`;
  async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.guest) headers["X-Guest-Session-Id"] = opts.guest;
    const res = await fetch(`${base}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  // ---- Start the real Python service ----
  const serviceDir = path.resolve(__dirname, "../../../recommendation-service");
  const python = path.join(serviceDir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  let child: ChildProcess | undefined = spawn(python, ["-m", "uvicorn", "app.asgi:app", "--host", "127.0.0.1", "--port", String(SERVICE_PORT)], {
    cwd: serviceDir,
    env: { ...process.env, RECO_EMBEDDER: "hashing", RECOMMENDATION_SERVICE_TOKEN: TOKEN, MONGODB_URI: env.mongoUri },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serviceLog = "";
  child.stderr?.on("data", (d) => (serviceLog += d.toString()));
  const up = await until(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`)).ok;
    } catch {
      return false;
    }
  }, 30000);
  if (!up) {
    console.error("The Python service did not start:\n" + serviceLog);
    child.kill();
    exitScenario(1);
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function merchant(tag: string) {
    const email = `verify-reco-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-reco-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId };
  }
  const svc = (p: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${SERVICE_PORT}${p}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });

  try {
    const A = await merchant("a");
    const B = await merchant("b");
    const mk = async (owner: { token: string; storeId: string }, title: string, category: string, description: string, stock: number) => {
      const res = await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, category, description, price: 10, costPrice: 4, stock } });
      return res.json.id as string;
    };
    const shoe1 = await mk(A, "Red running shoes", "Footwear", "Lightweight running shoes for road runners", 5);
    const shoe2 = await mk(A, "Blue running shoes", "Footwear", "Cushioned running shoes for long road runs", 5);
    const shoe3 = await mk(A, "Green running shoes", "Footwear", "Running shoes in green for road runners", 0); // sold out
    const mug1 = await mk(A, "Ceramic coffee mug", "Kitchen", "Stoneware mug that keeps coffee warm", 5);
    const mug2 = await mk(A, "Espresso coffee mug", "Kitchen", "Small ceramic mug for espresso coffee", 5);
    const bShoe = await mk(B, "Red running shoes", "Footwear", "Another store selling the same thing", 5);

    // ---- Indexing on create/update is fire-and-forget, and really lands on the Mongo document ----
    const embedded = await until(async () => {
      const d = await Product.findOne({ _id: shoe1, storeId: A.storeId }).select("+embedding +embeddingHash");
      return d?.embedding && d.embedding.length > 0 ? d : undefined;
    });
    check("indexing: creating a product had the service embed it in the background (vector stored on the document)", !!embedded && embedded.embedding!.length === 256 && !!embedded.embeddingHash);
    const hashBefore = embedded?.embeddingHash;
    await api("PUT", `/stores/${A.storeId}/products/${shoe1}`, {
      token: A.token,
      body: { title: "Red trail running shoes", category: "Footwear", description: "Lightweight running shoes for muddy trails", price: 10, costPrice: 4, stock: 5 },
    });
    const changed = await until(async () => {
      const d = await Product.findOne({ _id: shoe1, storeId: A.storeId }).select("+embeddingHash");
      return d?.embeddingHash && d.embeddingHash !== hashBefore ? d.embeddingHash : undefined;
    });
    check("indexing: editing a product's text recomputes its vector", !!changed);

    // ---- The public endpoint ----
    const rec = await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations?limit=4`);
    const ids: string[] = rec.json?.data?.map((p: { id: string }) => p.id) ?? [];
    check("recommendations: public (no token) and 200", rec.status === 200 && Array.isArray(rec.json.data));
    check("recommendations: the most similar in-stock product comes first (the other running shoe)", ids[0] === shoe2, `got ${JSON.stringify(ids)}`);
    check("recommendations: never includes the product itself", !ids.includes(shoe1));
    check("recommendations: sold-out products are left out", !ids.includes(shoe3));
    check("recommendations: unrelated in-stock products still fill the row after the close matches", ids.includes(mug1) && ids.includes(mug2));
    check("recommendations: never includes another store's product", !ids.includes(bShoe));
    check("recommendations: returned as real Product objects (price, stock) with no vector and no cost price", rec.json.data[0].price === 10 && rec.json.data[0].stock === 5 && !("embedding" in rec.json.data[0]) && !("costPrice" in rec.json.data[0]));
    const one = await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations?limit=1`);
    check("recommendations: limit is honoured", one.json.data.length === 1);
    check("recommendations: an out-of-range limit is 400", (await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations?limit=0`)).status === 400 && (await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations?limit=13`)).status === 400);
    check("product API: a single product never exposes its vector", !("embedding" in (await api("GET", `/stores/${A.storeId}/products/${shoe1}`)).json) && !("embeddingHash" in (await api("GET", `/stores/${A.storeId}/products/${shoe1}`)).json));

    // ---- Unknown / foreign products ----
    check("recommendations: an unknown product id is 404", (await api("GET", `/stores/${A.storeId}/products/${"0".repeat(24)}/recommendations`)).status === 404);
    check("recommendations: a malformed product id is 404", (await api("GET", `/stores/${A.storeId}/products/not-an-id/recommendations`)).status === 404);
    check("isolation: another store's product id under this store's path is 404, not a leak", (await api("GET", `/stores/${A.storeId}/products/${bShoe}/recommendations`)).status === 404);
    check("isolation: an unknown store is 404", (await api("GET", `/stores/does-not-exist/products/${shoe1}/recommendations`)).status === 404);

    // ---- The Python service itself is closed to anyone without the token ----
    check("service: /health is open, everything else needs the internal token", (await svc("/health")).status === 200 && (await svc(`/recommendations?storeId=${A.storeId}&productId=${shoe1}`)).status === 401 && (await svc(`/recommendations?storeId=${A.storeId}&productId=${shoe1}`, { headers: { "X-Internal-Token": "wrong" } })).status === 401);
    const direct: any = await (await svc("/search", { method: "POST", headers: { "X-Internal-Token": TOKEN }, body: JSON.stringify({ storeId: A.storeId, query: "coffee mug", limit: 5 }) })).json();
    check("service: /search finds the mugs for 'coffee mug' and stays inside the store", direct.items.length >= 2 && [mug1, mug2].includes(direct.items[0].productId) && !direct.items.some((i: { productId: string }) => i.productId === bShoe));

    // ---- Graceful degradation ----
    recommendationService.clearCache();
    const realToken = env.recommendation.token;
    env.recommendation.token = "wrong-token";
    setRecommendationClient(undefined);
    const wrongToken = await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations`);
    check("degradation: a rejected token gives an empty list, not an error page", wrongToken.status === 200 && wrongToken.json.data.length === 0);
    env.recommendation.token = realToken;
    setRecommendationClient(undefined);

    recommendationService.clearCache();
    child.kill();
    child = undefined;
    await sleep(800);
    const t0 = Date.now();
    const down = await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations`);
    check("degradation: with the service down the endpoint still answers 200 with no recommendations, quickly", down.status === 200 && down.json.data.length === 0 && Date.now() - t0 < env.recommendation.timeoutMs + 1000, `${Date.now() - t0}ms`);
    check("degradation: an unknown product is still 404 with the service down (checked in Node)", (await api("GET", `/stores/${A.storeId}/products/${"0".repeat(24)}/recommendations`)).status === 404);
    const create = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Late product", category: "Misc", price: 5, stock: 1 } });
    check("degradation: creating a product does not fail when the service is down (indexing is fire-and-forget)", create.status === 201);

    // ---- The assistant merges keyword matches with semantic ones ----
    const calls: string[] = [];
    setAiProvider({
      async generate(params) {
        calls.push(params.system);
        return { text: "Here you go.", model: "fake-model-1", inputTokens: 5, outputTokens: 5 };
      },
    });
    const guest = `verify-reco-guest-${suffix}aaaaaaaa`;
    const chat = (message: string) => api("POST", `/stores/${A.storeId}/assistant/chat`, { guest, body: { conversationId: `conv-${suffix}-${message.length}`, message } });

    setRecommendationClient({
      async recommend() {
        return [];
      },
      async search() {
        return [{ productId: mug1, score: 0.9 }, { productId: bShoe, score: 0.8 }];
      },
      async embedProduct() {},
    });
    const sem = await chat("something to drink my morning brew from");
    const semTitles: string[] = sem.json.suggestedProducts.map((p: { title: string }) => p.title);
    check("assistant: a question sharing no words with any product still suggests the semantic match", semTitles.includes("Ceramic coffee mug"));
    check("assistant: a semantic hit that is not in this store is never shown (hydrated from this store only)", sem.json.suggestedProducts.every((p: { storeId: string }) => p.storeId === A.storeId));
    check("assistant: the prompt lists the semantic match, so the model can talk about it", /Ceramic coffee mug/.test(calls[calls.length - 1]));
    const kw = await chat("espresso");
    const kwTitles: string[] = kw.json.suggestedProducts.map((p: { title: string }) => p.title);
    check("assistant: keyword matches stay first, semantic ones fill in after", kwTitles[0] === "Espresso coffee mug" && kwTitles.includes("Ceramic coffee mug"));
    check("assistant: no product appears twice", new Set(kwTitles).size === kwTitles.length);

    setRecommendationClient({
      async recommend() {
        throw new RecommendationUnavailableError("down");
      },
      async search() {
        throw new RecommendationUnavailableError("down");
      },
      async embedProduct() {
        throw new RecommendationUnavailableError("down");
      },
    });
    const fallback = await chat("Do you have espresso mugs?");
    check("assistant: with semantic search failing it still answers, from keyword matches", fallback.status === 200 && fallback.json.suggestedProducts.some((p: { title: string }) => p.title === "Espresso coffee mug"));

    // ---- Not configured at all (the state of every install that never set up the service) ----
    const savedUrl = env.recommendation.url;
    env.recommendation.url = undefined;
    setRecommendationClient(undefined);
    recommendationService.clearCache();
    const made = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Unconfigured product", category: "Misc", price: 5, stock: 1 } });
    check("unconfigured: creating a product works (no synchronous error out of the indexing hook)", made.status === 201);
    const unconf = await api("GET", `/stores/${A.storeId}/products/${shoe1}/recommendations`);
    check("unconfigured: recommendations are an empty 200", unconf.status === 200 && unconf.json.data.length === 0);
    check("unconfigured: the assistant still answers from keywords", (await chat("Any espresso options?")).status === 200);
    env.recommendation.url = savedUrl;
    setRecommendationClient(undefined);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    await ChatTranscript.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    child?.kill();
  }
  await closeAiQueue();
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
}


beforeAll(() => run(main), 900_000);
afterAll(() => restoreEnv());

declare([
  "indexing: creating a product had the service embed it in the background (vector stored on the document)",
  "indexing: editing a product's text recomputes its vector",
  "recommendations: public (no token) and 200",
  "recommendations: the most similar in-stock product comes first (the other running shoe)",
  "recommendations: never includes the product itself",
  "recommendations: sold-out products are left out",
  "recommendations: unrelated in-stock products still fill the row after the close matches",
  "recommendations: never includes another store's product",
  "recommendations: returned as real Product objects (price, stock) with no vector and no cost price",
  "recommendations: limit is honoured",
  "recommendations: an out-of-range limit is 400",
  "product API: a single product never exposes its vector",
  "recommendations: an unknown product id is 404",
  "recommendations: a malformed product id is 404",
  "isolation: another store's product id under this store's path is 404, not a leak",
  "isolation: an unknown store is 404",
  "service: /health is open, everything else needs the internal token",
  "service: /search finds the mugs for 'coffee mug' and stays inside the store",
  "degradation: a rejected token gives an empty list, not an error page",
  "degradation: with the service down the endpoint still answers 200 with no recommendations, quickly",
  "degradation: an unknown product is still 404 with the service down (checked in Node)",
  "degradation: creating a product does not fail when the service is down (indexing is fire-and-forget)",
  "assistant: a question sharing no words with any product still suggests the semantic match",
  "assistant: a semantic hit that is not in this store is never shown (hydrated from this store only)",
  "assistant: the prompt lists the semantic match, so the model can talk about it",
  "assistant: keyword matches stay first, semantic ones fill in after",
  "assistant: no product appears twice",
  "assistant: with semantic search failing it still answers, from keyword matches",
  "unconfigured: creating a product works (no synchronous error out of the indexing hook)",
  "unconfigured: recommendations are an empty 200",
  "unconfigured: the assistant still answers from keywords",
]);
