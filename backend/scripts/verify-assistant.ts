/**
 * End-to-end check of Module 3, the AI Shopping Assistant (Implementation_Plan.md Phase 5):
 * conversation context (short Redis-cached history, carried across messages in the same
 * conversation, absent in a different one), keyword-matched product suggestions, chat-quota
 * accounting (the chatMessagesUsed counter, separate from generationsUsed), guest and signed-in
 * shoppers, transcripts persisted to MongoDB, and tenant isolation. A fake AI provider stands in
 * for the network call to Anthropic (the same pattern verify-ai-content.ts uses).
 * Usage: npx tsx scripts/verify-assistant.ts   (Redis must be running on REDIS_URL)
 */
process.env.RATE_LIMIT_ENABLED = "false";
// Store A's own functional test makes several organic chat calls; store B gets its own quota
// row (Implementation_Plan.md Phase 4: quota is per [tenantId, month]) and is used, untouched
// by A, to actually run one out (same pattern verify-ai-content.ts uses for generations).
process.env.AI_MONTHLY_CHAT_MESSAGES_LIMIT = "10";
// An isolated BullMQ queue, so this script's own fake AiProvider is what actually answers its
// jobs even if a real backend or e2e-server.ts happens to be running against the same Redis
// (see the comment on AI_QUEUE_NAME in lib/aiQueue.ts).
process.env.AI_QUEUE_NAME = `ai-generate-verify-${Date.now().toString(36)}`;

import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { closeRedis } = await import("../src/lib/redis");
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { ChatTranscript } = await import("../src/models/ChatTranscript.model");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  startAiWorker();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.guest) headers["X-Guest-Session-Id"] = opts.guest;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function merchant(tag: string) {
    const email = `verify-asst-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-asst-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }
  const guestId = (tag: string) => `verify-asst-guest-${tag}-${suffix}aaaaaaaa`;

  let nextReply = "Sure, here is what I found.";
  const calls: { system: string; prompt: string }[] = [];
  setAiProvider({
    async generate(params) {
      calls.push({ system: params.system, prompt: params.prompt });
      return { text: nextReply, model: "fake-model-1", inputTokens: 10, outputTokens: 5 };
    },
  });

  try {
    const A = await merchant("a");
    const B = await merchant("b");
    const mk = async (owner: { token: string; storeId: string }, title: string, price: number, category: string, stock: number) =>
      (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price, stock, category } })).json.id as string;
    const mug = await mk(A, "Ceramic Mug", 12.5, "kitchen", 10);
    await mk(A, "Travel Mug", 18, "kitchen", 0);
    await mk(A, "Desk Lamp", 30, "lighting", 5);

    // ---- A guest asks about mugs: gets a reply, matching products, and a transcript ----
    const g1 = guestId("1");
    const conv1 = `conv-${suffix}-1`;
    const chat1 = await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: g1, body: { conversationId: conv1, message: "Do you have any mugs?" } });
    check("chat: a guest gets a reply from the fake provider", chat1.status === 200 && chat1.json.reply === nextReply && chat1.json.conversationId === conv1);
    check("chat: keyword-matched products are returned as real Product objects (mug titles, not the lamp)", chat1.json.suggestedProducts.some((p: { title: string }) => p.title === "Ceramic Mug") && chat1.json.suggestedProducts.every((p: { title: string }) => p.title !== "Desk Lamp"));
    check("chat: an out-of-stock match is still suggested, but shows 0 stock (never hidden or invented)", chat1.json.suggestedProducts.find((p: { title: string }) => p.title === "Travel Mug")?.stock === 0);
    check("chat: the prompt given to the model lists the matched products with real prices, not invented ones", /Ceramic Mug.*12\.50/.test(calls[0].system));
    check("chat: this is a chat generation, so it spends chatMessagesUsed, not generationsUsed", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.chatMessagesUsed === 1 && (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 0);

    const transcript1 = await ChatTranscript.findOne({ storeId: A.storeId, conversationId: conv1 });
    check("transcript: both the shopper's message and the assistant's reply are logged to Mongo", transcript1?.messages.length === 2 && transcript1?.messages[0].content === "Do you have any mugs?" && transcript1?.messages[1].content === nextReply);
    check("transcript: a guest's conversation has no customerId, but does record the guest session id", transcript1?.customerId === undefined && transcript1?.guestSessionId === g1);
    check("transcript: expiresAt is set roughly 90 days out (a debugging aid, not a permanent record)", !!transcript1?.expiresAt && transcript1.expiresAt.getTime() - Date.now() > 89 * 24 * 60 * 60 * 1000);

    // ---- The same conversation remembers what was said; a different one does not ----
    nextReply = "As I mentioned, the Ceramic Mug is a great pick.";
    await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: g1, body: { conversationId: conv1, message: "Which one do you recommend?" } });
    check("chat: the same conversation's prompt carries the earlier exchange as context", /Do you have any mugs\?/.test(calls[1].prompt) && /Sure, here is what I found\./.test(calls[1].prompt) && /Which one do you recommend\?/.test(calls[1].prompt));

    const conv2 = `conv-${suffix}-2`;
    nextReply = "Fresh conversation reply.";
    await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: g1, body: { conversationId: conv2, message: "Which one do you recommend?" } });
    check("chat: a different conversationId starts with no prior context, even for the same guest", !/Ceramic Mug is a great pick/.test(calls[2].prompt) && calls[2].prompt === "Shopper: Which one do you recommend?");

    // ---- A signed-in shopper's conversation records who they are ----
    const cust = await api("POST", "/auth/register-customer", { body: { email: `verify-asst-cust-${suffix}@example.com`, password: "password123" } });
    created.userIds.push(cust.json.user.id);
    const conv3 = `conv-${suffix}-3`;
    nextReply = "Signed-in reply.";
    await api("POST", `/stores/${A.storeId}/assistant/chat`, { token: cust.json.accessToken, body: { conversationId: conv3, message: "Any lamps?" } });
    const transcript3 = await ChatTranscript.findOne({ storeId: A.storeId, conversationId: conv3 });
    check("transcript: a signed-in shopper's conversation records their customer id, and no guest session id", transcript3?.customerId === cust.json.user.id && transcript3?.guestSessionId === undefined);

    // ---- Validation and identity ----
    check("chat: no token and no guest id is 400 (resolveCartOwner has nothing to identify the shopper with)", (await api("POST", `/stores/${A.storeId}/assistant/chat`, { body: { conversationId: "x", message: "hi" } })).status === 400);
    check("chat: a missing conversationId or an empty message is 400", (await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: g1, body: { message: "hi" } })).status === 400 && (await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: g1, body: { conversationId: "x", message: "" } })).status === 400);
    check("chat: an unknown store is 404", (await api("POST", "/stores/does-not-exist/assistant/chat", { guest: g1, body: { conversationId: "x", message: "hi" } })).status === 404);

    // ---- Tenant isolation: store B has its own quota, untouched by everything done to A ----
    check("isolation: store B has no products, so a matching question gets no suggestions, and B's quota is untouched by A's usage", (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.chatMessagesUsed === 0);
    nextReply = "B's own reply.";
    const bChat = await api("POST", `/stores/${B.storeId}/assistant/chat`, { guest: g1, body: { conversationId: conv1, message: "Do you have any mugs?" } });
    check("isolation: store B can chat on its own quota, and sees none of A's products", bChat.status === 200 && bChat.json.suggestedProducts.length === 0);
    check("isolation: the same conversationId in a different store is a different conversation (no cross-store context leak)", calls[calls.length - 1].prompt === "Shopper: Do you have any mugs?");

    // ---- Quota: chat has its own limit, separate from generations, run out on store B ----
    const usageB = (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json;
    for (let i = usageB.chatMessagesUsed; i < usageB.chatMessagesLimit; i++) {
      await api("POST", `/stores/${B.storeId}/assistant/chat`, { guest: g1, body: { conversationId: `conv-${suffix}-drain-${i}`, message: "one more" } });
    }
    check("quota: the limit was actually reached", (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.chatMessagesUsed === usageB.chatMessagesLimit);
    const exhausted = await api("POST", `/stores/${B.storeId}/assistant/chat`, { guest: g1, body: { conversationId: `conv-${suffix}-over`, message: "over the limit" } });
    check("quota: a chat message past the monthly limit is refused with 402", exhausted.status === 402);
    check("quota: generations for the same store are untouched by chat exhaustion (separate counters)", (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.generationsUsed === 0);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    await ChatTranscript.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeAiQueue();
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
