/**
 * Part G voice notes end to end on real Postgres, MongoDB and Redis: **a voice note only ever makes
 * a draft the merchant must confirm.** (Part G's bargaining was removed by the supervisor's
 * product-listing change, and its tests with it.)
 *
 * The fake AI here is deliberately hostile: it is told to claim a change was applied. That must have
 * no effect.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-partg-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let setRecommendationClient: typeof import("../../src/lib/recommendationClient").setRecommendationClient;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const aiPrompts: { system: string; prompt: string }[] = [];
/** What the fake assistant replies. Set per test to whatever a broken or attacked model might say. */
let aiReply = "";
let aiDown = false;
/** What the fake transcriber heard. */
let heard: { text: string; language: string | null; confidence: number; durationSeconds: number } | null = { text: "chai cup ka price 450 kar do", language: "ur", confidence: 0.9, durationSeconds: 3 };
let transcribeError: Error | null = null;

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string) {
  const email = `verify-partg-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify G ${tag}`, storeSlug: `verify-partg-${tag}-${suffix}`, currency: "PKR" } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
}

const addProduct = async (o: { token: string; storeId: string }, body: Record<string, unknown>) =>
  (await api("POST", `/stores/${o.storeId}/products`, { token: o.token, body: { actualPrice: 1000, stock: 10, category: "kitchen", ...body } })).json;

let A: Awaited<ReturnType<typeof merchant>>;
let cup: { id: string };
/** A 1x1 PNG is not audio, but the fake transcriber never looks at the bytes. */
const audio = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const sendVoice = async (storeId: string, token: string) =>
  (request(app) as any)
    .post(`/api/v1/stores/${storeId}/voice-notes`)
    .set("Authorization", `Bearer ${token}`)
    .attach("file", audio, { filename: "note.webm", contentType: "audio/webm" })
    .then((r: { status: number; body: unknown }) => ({ status: r.status, json: r.body as any }));

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ setRecommendationClient } = await import("../../src/lib/recommendationClient"));
  await (await import("../../src/lib/mongo")).connectMongo();

  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      aiPrompts.push({ system: p.system, prompt: p.prompt });
      if (aiDown) throw new Error("provider down");
      return { text: aiReply, model: "fake-model-g", inputTokens: 50, outputTokens: 20 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  setRecommendationClient({
    async recommend() {
      return null;
    },
    async search() {
      return [];
    },
    async embedProduct() {},
    async transcribe() {
      if (transcribeError) throw transcribeError;
      if (!heard) throw new Error("nothing set");
      return heard;
    },
  });

  A = await merchant("a");
  cup = await addProduct(A, { title: "Clay Chai Cup" });
}, 240_000);

afterAll(async () => {
  setRecommendationClient(undefined);
  // The recordings this suite stored (local driver).
  const { env } = await import("../../src/config/env");
  for (const t of created.tenantIds) (await import("node:fs")).rmSync((await import("node:path")).resolve(env.storage.privateDir, "voice", t), { recursive: true, force: true });
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

// ---------------------------------------------------------------------------------------------

describe("a voice note only ever makes a draft", () => {
  beforeEach(() => {
    aiDown = false;
    transcribeError = null;
  });

  it("a spoken price change becomes a draft, and the product is untouched", async () => {
    heard = { text: "chai cup ka price 450 kar do", language: "ur", confidence: 0.9, durationSeconds: 3 };
    aiReply = JSON.stringify({ kind: "set_price", product: "chai cup", price: 450, stock: null, title: null, category: null, note: null });
    const res = await sendVoice(A.storeId, A.token);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ status: "pending", transcript: "chai cup ka price 450 kar do", language: "ur" });
    expect(res.json.draft).toMatchObject({ kind: "set_price", productName: "Clay Chai Cup", price: 450 });
    expect(res.json.summary).toMatch(/Change the price of "Clay Chai Cup" to PKR 450\.00/);

    const product = await Product.findOne({ _id: cup.id, storeId: A.storeId });
    expect(Number(product!.actualPrice!.toString())).toBe(1000);
  });

  it("confirming it is what applies the change", async () => {
    const pending = (await api("GET", `/stores/${A.storeId}/voice-notes?status=pending`, { token: A.token })).json[0];
    const res = await api("POST", `/stores/${A.storeId}/voice-notes/${pending.id}/apply`, { token: A.token });
    expect(res.status).toBe(200);
    const product = await Product.findOne({ _id: cup.id, storeId: A.storeId });
    expect(Number(product!.actualPrice!.toString())).toBe(450);
    expect(Number(product!.salePrice!.toString())).toBe(450);
    expect((await prismaUnscoped.voiceNote.findUnique({ where: { id: pending.id } }))!.status).toBe("applied");
  });

  it("the same note cannot be applied twice", async () => {
    const applied = (await api("GET", `/stores/${A.storeId}/voice-notes?status=applied`, { token: A.token })).json[0];
    expect((await api("POST", `/stores/${A.storeId}/voice-notes/${applied.id}/apply`, { token: A.token })).status).toBe(409);
  });

  it("an AI reply claiming it already made the change still only produces a draft", async () => {
    heard = { text: "cup ka stock 50 kar do", language: "ur", confidence: 0.9, durationSeconds: 3 };
    aiReply = JSON.stringify({ kind: "set_stock", product: "chai cup", price: null, stock: 50, title: null, category: null, note: null, applied: true, status: "done" });
    const res = await sendVoice(A.storeId, A.token);
    expect(res.json.status).toBe("pending");
    expect(res.json.draft).not.toHaveProperty("applied");
    await api("POST", `/stores/${A.storeId}/voice-notes/${res.json.id}/discard`, { token: A.token });
  });

  it("a note about a product the shop does not have is refused with a reason, not guessed at", async () => {
    heard = { text: "telescope ka price 5000 kar do", language: "en", confidence: 0.9, durationSeconds: 3 };
    aiReply = JSON.stringify({ kind: "set_price", product: "telescope", price: 5000, stock: null, title: null, category: null, note: null });
    const res = await sendVoice(A.storeId, A.token);
    expect(res.json.draft).toBeNull();
    expect(res.json.problem).toMatch(/No product in your shop matched "telescope"/);
  });

  it("an unclear recording is saved with the words, so the merchant can see what was heard", async () => {
    heard = { text: "kuch bhi", language: "ur", confidence: 0.3, durationSeconds: 2 };
    aiReply = JSON.stringify({ kind: "unclear", product: null, price: null, stock: null, title: null, category: null, note: "They did not ask for a change." });
    const res = await sendVoice(A.storeId, A.token);
    expect(res.json).toMatchObject({ transcript: "kuch bhi", draft: null, status: "pending" });
    expect(res.json.problem).toMatch(/did not ask for a change/);
  });

  it("with the AI down the words are still kept, so nothing the merchant said is lost", async () => {
    heard = { text: "cup ka price 600 kar do", language: "ur", confidence: 0.9, durationSeconds: 3 };
    aiDown = true;
    const res = await sendVoice(A.storeId, A.token);
    expect(res.status).toBe(201);
    expect(res.json.transcript).toBe("cup ka price 600 kar do");
    expect(res.json.draft).toBeNull();
    aiDown = false;
  });

  it("with speech to text switched off the merchant is told plainly, not shown an error", async () => {
    const { RecommendationUnavailableError } = await import("../../src/lib/recommendationClient");
    transcribeError = new RecommendationUnavailableError("not installed");
    const res = await sendVoice(A.storeId, A.token);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.json)).toMatch(/not switched on/);
    transcribeError = null;
  });

  it("the AI is given only the words, never the catalogue or any id", () => {
    const votes = aiPrompts.filter((p) => /spoken instruction/.test(p.system));
    expect(votes.length).toBeGreaterThan(0);
    for (const p of votes) {
      expect(p.prompt).not.toContain(cup.id);
      expect(p.prompt).not.toMatch(/productId|storeId|_id/);
    }
  });

  it("only someone who may edit products may record or apply a note", async () => {
    const email = `verify-partg-cashier-${suffix}@example.com`;
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email, password: "password123", permissions: ["pos_sell"] } });
    const cashier = await api("POST", "/auth/login", { body: { email, password: "password123" } });
    created.userIds.push(cashier.json.user.id);
    expect((await sendVoice(A.storeId, cashier.json.accessToken)).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/voice-notes`, { token: cashier.json.accessToken })).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/voice-notes`)).status).toBe(401);
  });

  it("a recording is private: the merchant gets a signed link, and nothing else reaches it", async () => {
    const recorded = await sendVoice(A.storeId, A.token);
    expect(recorded.status).toBe(201);
    const listed = (await api("GET", `/stores/${A.storeId}/voice-notes`, { token: A.token })).json as { id: string; audioUrl: string }[];
    const link = new URL(listed.find((n) => n.id === recorded.json.id)!.audioUrl);
    expect(link.searchParams.get("signature")).toBeTruthy();
    const played = await request(app).get(link.pathname + link.search);
    expect(played.status).toBe(200);
    expect(played.headers["content-type"]).toMatch(/^audio\/webm/);
    const key = link.pathname.replace("/api/v1/files/", "");
    expect(key).toMatch(new RegExp(`^voice/${A.storeId}/`));
    expect((await request(app).get(link.pathname)).status).toBe(404);
    expect((await request(app).get(`/uploads/${key}`)).status).toBe(404);
  });

  it("a file that is not a recording is refused", async () => {
    const res = await (request(app) as any)
      .post(`/api/v1/stores/${A.storeId}/voice-notes`)
      .set("Authorization", `Bearer ${A.token}`)
      .attach("file", Buffer.from("not audio"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });
});
