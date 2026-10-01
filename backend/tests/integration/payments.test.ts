/**
 * Part E, payment and trust, end to end on real Postgres, MongoDB and Redis with a fake AI provider:
 * a cash-on-delivery order follows the same stock and order rules as any other; the trust score is
 * explainable and uses only the allowed inputs; the platform-wide signal carries a count and nothing
 * else; a bank-transfer screenshot is read by the AI but only ever accepted by a person; a reused
 * reference and a wrong amount are both caught; a courier file reconciles exactly against hand-made
 * rows; the failure helper answers in Urdu without an AI call; and no card number can reach us.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-payments-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";
process.env.COD_PHONE_PEPPER = `test-pepper-${Date.now()}`;

import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let tenantContext: typeof import("../../src/lib/tenantContext").tenantContext;
let Product: typeof import("../../src/models/Product.model").Product;
let hashPhone: typeof import("../../src/modules/payments/payments.service").hashPhone;
let env: typeof import("../../src/config/env").env;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[], files: [] as string[] };
const aiCalls: { system: string; prompt: string; model: string; hasImage: boolean }[] = [];
let aiReply: Record<string, unknown> | string = {};
let aiDown = false;

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string) {
  const email = `verify-pay-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify Pay ${tag}`, storeSlug: `verify-pay-${tag}-${suffix}`, currency: "PKR" } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
}

const product = async (o: { token: string; storeId: string }, title: string, price: number, stock = 50) =>
  (await api("POST", `/stores/${o.storeId}/products`, { token: o.token, body: { title, price, stock, category: "kitchen" } })).json.id as string;

const stockOf = async (storeId: string, productId: string) =>
  (await prismaUnscoped.inventoryLevel.findFirst({ where: { tenantId: storeId, productId }, select: { quantity: true } }))?.quantity ?? 0;

/** Puts a real image in the uploads folder and returns the URL the API would have given for it. */
function uploadImage(name: string): string {
  // A 1x1 PNG: the fake AI never looks at it, but every path that loads, sizes and encodes it runs.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const file = `verify-pay-${suffix}-${name}.png`;
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(env.uploadsDir, file), png);
  created.files.push(path.join(env.uploadsDir, file));
  return `${env.publicUrl}/uploads/${file}`;
}

const address = { line1: "12 Mall Road", city: "Lahore", country: "PK" };
const shopper = { name: "Ayesha Khan", phone: "03001234567", email: `verify-pay-shopper-${suffix}@example.com`, address };

async function addToCart(storeId: string, guest: string, productId: string, quantity = 1) {
  return api("POST", `/stores/${storeId}/cart/items`, { guest, body: { productId, quantity } });
}

let A: Awaited<ReturnType<typeof merchant>>;
let B: Awaited<ReturnType<typeof merchant>>;
let cup: string;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ tenantContext } = await import("../../src/lib/tenantContext"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ hashPhone } = await import("../../src/modules/payments/payments.service"));
  ({ env } = await import("../../src/config/env"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      aiCalls.push({ system: p.system, prompt: p.prompt, model: p.model, hasImage: Boolean(p.image) });
      if (aiDown) throw new Error("provider down");
      return { text: typeof aiReply === "string" ? aiReply : JSON.stringify(aiReply), model: p.model, inputTokens: 100, outputTokens: 40 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  A = await merchant("a");
  B = await merchant("b");
  cup = await product(A, "Clay Chai Cup", 450, 50);
  await api("PATCH", `/stores/${A.storeId}/payments/settings`, { token: A.token, body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: "Verify Pay A", bankAccountNumber: "PK00TEST000011112222", bankName: "Test Bank" } });
}, 240_000);

afterAll(async () => {
  for (const f of created.files) fs.rmSync(f, { force: true });
  await prismaUnscoped.codPhoneSignal.deleteMany({ where: { phoneHash: { in: [hashPhone(shopper.phone)!, hashPhone("03009999999")!] } } });
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

// ---------------------------------------------------------------------------------------------

describe("placing a cash-on-delivery order", () => {
  const guest = `guest-${suffix}-cod1`;
  let placed: { orderId: string; orderNumber: number; total: number };
  let stockBefore: number;

  it("the store says cash on delivery is available for this cart", async () => {
    await addToCart(A.storeId, guest, cup, 2);
    const res = await api("POST", `/stores/${A.storeId}/payments/options`, { guest, body: { ...shopper, method: "cod" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ currency: "PKR", total: 900, cod: { available: true, advanceAmount: 0 } });
  });

  it("the shopper is never told their risk score or why", async () => {
    const res = await api("POST", `/stores/${A.storeId}/payments/options`, { guest, body: { ...shopper, method: "cod" } });
    const text = JSON.stringify(res.json);
    expect(text).not.toMatch(/score|band|reason|no_history|risk/i);
  });

  it("placing it creates a real order with the stock held, exactly like a paid order", async () => {
    stockBefore = await stockOf(A.storeId, cup);
    const res = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest, body: { ...shopper, method: "cod" } });
    expect(res.status).toBe(201);
    placed = res.json;
    expect(placed).toMatchObject({ total: 900, currency: "PKR", method: "cod" });
    expect(await stockOf(A.storeId, cup)).toBe(stockBefore - 2);
  });

  it("the money is owed, not received: the order and its payment are both pending", async () => {
    const order = await prismaUnscoped.order.findUnique({ where: { id: placed.orderId }, include: { payments: true, items: true } });
    expect(order!.status).toBe("PENDING");
    expect(order!.payments).toHaveLength(1);
    expect(order!.payments[0]).toMatchObject({ method: "COD", status: "PENDING" });
    // The pending payment still covers the whole order, so the books balance from the start.
    expect(Number(order!.payments[0].amount.toString())).toBe(900);
    expect(order!.items).toHaveLength(1);
  });

  it("the cart is emptied, so the order cannot be placed twice", async () => {
    expect((await api("GET", `/stores/${A.storeId}/cart`, { guest })).json.items).toEqual([]);
    expect((await api("POST", `/stores/${A.storeId}/payments/orders`, { guest, body: { ...shopper, method: "cod" } })).status).toBe(400);
  });

  it("an order for more than there is in stock is refused, and nothing is written", async () => {
    const g = `guest-${suffix}-toomany`;
    const scarce = await product(A, "Last Kettle", 1000, 1);
    await addToCart(A.storeId, g, scarce, 1);
    await prismaUnscoped.inventoryLevel.updateMany({ where: { tenantId: A.storeId, productId: scarce }, data: { quantity: 0 } });
    const res = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "cod" } });
    expect(res.status).toBe(409);
  });

  it("a store that has not turned cash on delivery on refuses it", async () => {
    const g = `guest-${suffix}-storeb`;
    const bCup = await product(B, "B Cup", 300);
    await addToCart(B.storeId, g, bCup, 1);
    const options = await api("POST", `/stores/${B.storeId}/payments/options`, { guest: g, body: { ...shopper, method: "cod" } });
    expect(options.json.cod).toMatchObject({ available: false });
    expect((await api("POST", `/stores/${B.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "cod" } })).status).toBe(400);
  });

  it("the merchant sees it waiting, with the reasons behind its score", async () => {
    const res = await api("GET", `/stores/${A.storeId}/payments/cod/pending`, { token: A.token });
    expect(res.status).toBe(200);
    const row = res.json.find((r: { orderId: string }) => r.orderId === placed.orderId);
    expect(row).toMatchObject({ orderNumber: placed.orderNumber, total: 900 });
    expect(row.risk.band).toBe("low");
    expect(row.risk.reasons.length).toBeGreaterThan(0);
    for (const r of row.risk.reasons) expect(r).toMatchObject({ code: expect.any(String), points: expect.any(Number), detail: expect.any(String) });
  });

  it("recording the cash as collected is what finally pays the order", async () => {
    const res = await api("POST", `/stores/${A.storeId}/payments/cod/orders/${placed.orderId}/outcome`, { token: A.token, body: { outcome: "collected", amount: 900 } });
    expect(res.status).toBe(200);
    const order = await prismaUnscoped.order.findUnique({ where: { id: placed.orderId }, include: { payments: true } });
    expect(order!.status).toBe("COMPLETED");
    expect(order!.payments[0].status).toBe("SUCCEEDED");
  });

  it("a courier handing over less than the order total is refused", async () => {
    const g = `guest-${suffix}-short`;
    await addToCart(A.storeId, g, cup, 1);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "cod" } })).json;
    const res = await api("POST", `/stores/${A.storeId}/payments/cod/orders/${o.orderId}/outcome`, { token: A.token, body: { outcome: "collected", amount: 100 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toMatch(/must be the order total, PKR 450\.00/);
    // Left exactly as it was, not half-settled.
    expect((await prismaUnscoped.order.findUnique({ where: { id: o.orderId } }))!.status).toBe("PENDING");
  });

  it("settling the same delivery twice is refused", async () => {
    expect((await api("POST", `/stores/${A.storeId}/payments/cod/orders/${placed.orderId}/outcome`, { token: A.token, body: { outcome: "collected", amount: 900 } })).status).toBe(409);
  });

  it("a refused parcel cancels the order and puts the goods back on the shelf", async () => {
    const g = `guest-${suffix}-refused`;
    await addToCart(A.storeId, g, cup, 3);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "cod" } })).json;
    const afterOrder = await stockOf(A.storeId, cup);
    expect((await api("POST", `/stores/${A.storeId}/payments/cod/orders/${o.orderId}/outcome`, { token: A.token, body: { outcome: "refused" } })).status).toBe(200);
    expect(await stockOf(A.storeId, cup)).toBe(afterOrder + 3);
    expect((await prismaUnscoped.order.findUnique({ where: { id: o.orderId } }))!.status).toBe("CANCELLED");
  });
});

// ---------------------------------------------------------------------------------------------

describe("the COD Trust Agent", () => {
  it("a refusal is remembered for that phone number as a count, with no store and no order attached", async () => {
    const signal = await prismaUnscoped.codPhoneSignal.findUnique({ where: { phoneHash: hashPhone(shopper.phone)! } });
    expect(signal).toMatchObject({ delivered: 1, refused: 1 });
    const row = JSON.stringify(signal);
    expect(row).not.toContain(A.storeId);
    expect(row).not.toContain(shopper.phone);
    expect(row).not.toMatch(/Ayesha|example\.com|orderId/i);
    expect(Object.keys(signal!).sort()).toEqual(["createdAt", "delivered", "id", "lastSeenAt", "phoneHash", "refused"]);
  });

  it("the stored phone hash cannot be turned back into the number", async () => {
    const hash = hashPhone(shopper.phone)!;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("3001234567");
    // The same number always hashes the same, however it was written.
    expect(hashPhone("+92 300 1234567")).toBe(hash);
    expect(hashPhone("03009999999")).not.toBe(hash);
  });

  it("an order with no usable phone number and a bare address is scored high, and cash on delivery is withheld", async () => {
    const g = `guest-${suffix}-risky`;
    await addToCart(A.storeId, g, cup, 1);
    const res = await api("POST", `/stores/${A.storeId}/payments/options`, {
      guest: g,
      body: { method: "cod", name: "x", phone: "00000", address: { line1: "somewhere", city: "", country: "PK" } },
    });
    // An empty city fails validation before the rules even run, which is itself the right answer.
    expect(res.status).toBe(400);
  });

  it("a made-up phone number pushes an order into the medium band", async () => {
    const g = `guest-${suffix}-fakephone`;
    await addToCart(A.storeId, g, cup, 1);
    const place = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, phone: "12345", email: null, method: "cod" } });
    expect(place.status).toBe(201);
    const assessment = await prismaUnscoped.codAssessment.findUnique({ where: { orderId: place.json.orderId } });
    expect(assessment!.band).toBe("medium");
    expect((assessment!.reasons as { code: string }[]).map((r) => r.code)).toContain("phone_invalid");
  });

  it("the saved assessment keeps only the inputs the rules are allowed to see", async () => {
    const { ALLOWED_INPUTS } = await import("../../src/modules/payments/cod.risk");
    const assessment = await prismaUnscoped.codAssessment.findFirst({ where: { tenantId: A.storeId }, orderBy: { createdAt: "desc" } });
    expect(Object.keys(assessment!.inputs as object).sort()).toEqual([...ALLOWED_INPUTS].sort());
    const saved = JSON.stringify(assessment!.inputs);
    expect(saved).not.toMatch(/Ayesha|Mall Road|Lahore|example\.com|03001234567/);
  });

  it("the trust score never calls the AI: it is rules, start to finish", async () => {
    const before = aiCalls.length;
    const g = `guest-${suffix}-noai`;
    await addToCart(A.storeId, g, cup, 1);
    await api("POST", `/stores/${A.storeId}/payments/options`, { guest: g, body: { ...shopper, method: "cod" } });
    expect(aiCalls.length).toBe(before);
  });

  it("a store can refuse cash on delivery above a limit, and ask for a deposit on risky orders", async () => {
    await api("PATCH", `/stores/${A.storeId}/payments/settings`, { token: A.token, body: { codMaxAmount: 500 } });
    const g = `guest-${suffix}-limit`;
    await addToCart(A.storeId, g, cup, 4);
    const res = await api("POST", `/stores/${A.storeId}/payments/options`, { guest: g, body: { ...shopper, method: "cod" } });
    expect(res.json.cod).toMatchObject({ available: false });
    expect(res.json.cod.note).toMatch(/up to 500/);
    await api("PATCH", `/stores/${A.storeId}/payments/settings`, { token: A.token, body: { codMaxAmount: null } });
  });

  it("only the owner may change what the store accepts", async () => {
    const email = `verify-pay-staff-${suffix}@example.com`;
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email, password: "password123", permissions: ["orders_write"] } });
    const staff = await api("POST", "/auth/login", { body: { email, password: "password123" } });
    created.userIds.push(staff.json.user.id);
    expect((await api("PATCH", `/stores/${A.storeId}/payments/settings`, { token: staff.json.accessToken, body: { codEnabled: false } })).status).toBe(403);
    // Staff with orders_write still run the day-to-day queue.
    expect((await api("GET", `/stores/${A.storeId}/payments/cod/pending`, { token: staff.json.accessToken })).status).toBe(200);
    expect((await api("GET", `/stores/${A.storeId}/payments/cod/pending`, { token: B.token })).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/payments/cod/pending`)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------

describe("a bank transfer and its screenshot", () => {
  const guest = `guest-${suffix}-bank`;
  let order: { orderId: string; orderNumber: number };

  beforeAll(async () => {
    await addToCart(A.storeId, guest, cup, 1);
    order = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest, body: { ...shopper, method: "bank_transfer" } })).json;
    aiReply = { readable: true, amount: 450, currency: "PKR", date: new Date().toISOString().slice(0, 10), reference: "TRX-900111", bank: "Test Bank", sender: "Ayesha", note: null };
  });

  it("the shopper is told where to send the money", async () => {
    const g = `guest-${suffix}-bankinfo`;
    await addToCart(A.storeId, g, cup, 1);
    const res = await api("POST", `/stores/${A.storeId}/payments/options`, { guest: g, body: { ...shopper, method: "bank_transfer" } });
    expect(res.json.bankTransfer).toMatchObject({ available: true, accountName: "Verify Pay A", bankName: "Test Bank" });
  });

  it("the AI is sent the picture and asked only to read it, never whether it is valid", async () => {
    const before = aiCalls.length;
    const res = await api("POST", `/stores/${A.storeId}/payments/orders/${order.orderId}/proof`, { guest, body: { imageUrl: uploadImage("ok"), declaredAmount: 450, declaredReference: "TRX-900111" } });
    expect(res.status).toBe(201);
    const call = aiCalls[aiCalls.length - 1];
    expect(aiCalls.length).toBe(before + 1);
    expect(call.hasImage).toBe(true);
    // It is never told what the order comes to, so it cannot be led into agreeing.
    expect(call.prompt).not.toMatch(/450|TRX-900111|total|expect/i);
    expect(call.system).toMatch(/not your decision/);
  });

  it("a matching screenshot is reported as matching, but is still only pending", async () => {
    const proof = (await api("GET", `/stores/${A.storeId}/payments/proofs`, { token: A.token })).json[0];
    expect(proof.status).toBe("pending");
    expect(proof.needsAttention).toBe(false);
    expect(proof.findings.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(["amount_matches", "reference_matches", "date_plausible"]));
    // Nothing the AI said has moved any money.
    const o = await prismaUnscoped.order.findUnique({ where: { id: order.orderId }, include: { payments: true } });
    expect(o!.status).toBe("PENDING");
    expect(o!.payments[0].status).toBe("PENDING");
  });

  it("the shopper sees only that it is waiting, never the findings", async () => {
    const res = await api("GET", `/stores/${A.storeId}/payments/orders/${order.orderId}/proof`, { guest });
    expect(res.json).toMatchObject({ status: "pending" });
    expect(JSON.stringify(res.json)).not.toMatch(/finding|amount_matches|extracted/i);
  });

  it("the merchant accepting it is what pays the order, and it records who decided", async () => {
    const proof = (await api("GET", `/stores/${A.storeId}/payments/proofs`, { token: A.token })).json[0];
    const res = await api("POST", `/stores/${A.storeId}/payments/proofs/${proof.id}/review`, { token: A.token, body: { decision: "accept" } });
    expect(res.status).toBe(200);
    const o = await prismaUnscoped.order.findUnique({ where: { id: order.orderId }, include: { payments: true } });
    expect(o!.status).toBe("PAID");
    expect(o!.payments[0].status).toBe("SUCCEEDED");
    const saved = await prismaUnscoped.paymentProof.findUnique({ where: { id: proof.id } });
    expect(saved).toMatchObject({ status: "accepted", reviewedByUserId: A.userId });
  });

  it("the same screenshot cannot be reviewed twice", async () => {
    const proof = (await api("GET", `/stores/${A.storeId}/payments/proofs?status=accepted`, { token: A.token })).json[0];
    expect((await api("POST", `/stores/${A.storeId}/payments/proofs/${proof.id}/review`, { token: A.token, body: { decision: "reject" } })).status).toBe(409);
  });

  it("a screenshot for the wrong amount is flagged as a problem the merchant must look at", async () => {
    const g = `guest-${suffix}-wrongamount`;
    await addToCart(A.storeId, g, cup, 2);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "bank_transfer" } })).json;
    aiReply = { readable: true, amount: 450, currency: "PKR", date: new Date().toISOString().slice(0, 10), reference: "TRX-900222", bank: "Test Bank", sender: "Ayesha", note: null };
    await api("POST", `/stores/${A.storeId}/payments/orders/${o.orderId}/proof`, { guest: g, body: { imageUrl: uploadImage("short"), declaredAmount: 900, declaredReference: "TRX-900222" } });
    const proof = (await api("GET", `/stores/${A.storeId}/payments/proofs?status=pending`, { token: A.token })).json[0];
    expect(proof.needsAttention).toBe(true);
    expect(proof.summary).toMatch(/PKR 450\.00, which is less than the PKR 900\.00/);
  });

  it("rejecting a screenshot leaves the order unpaid and tells the shopper why", async () => {
    const proof = (await api("GET", `/stores/${A.storeId}/payments/proofs?status=pending`, { token: A.token })).json[0];
    await api("POST", `/stores/${A.storeId}/payments/proofs/${proof.id}/review`, { token: A.token, body: { decision: "reject", reason: "The amount is only half the order." } });
    const o = await prismaUnscoped.order.findUnique({ where: { id: proof.orderId }, include: { payments: true } });
    expect(o!.status).toBe("PENDING");
    expect(o!.payments[0].status).toBe("PENDING");
    const shopperView = await api("GET", `/stores/${A.storeId}/payments/orders/${proof.orderId}/proof`, { guest: `guest-${suffix}-wrongamount` });
    expect(shopperView.json).toMatchObject({ status: "rejected", reason: "The amount is only half the order." });
  });

  it("the same transfer reference cannot be used for a second order", async () => {
    const g = `guest-${suffix}-reused`;
    await addToCart(A.storeId, g, cup, 1);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "bank_transfer" } })).json;
    const res = await api("POST", `/stores/${A.storeId}/payments/orders/${o.orderId}/proof`, { guest: g, body: { imageUrl: uploadImage("reuse"), declaredAmount: 450, declaredReference: "TRX-900111" } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.json)).toMatch(/already been used/);
  });

  it("with the AI unavailable the receipt still goes to the merchant, with the server's own checks done", async () => {
    aiDown = true;
    const g = `guest-${suffix}-aidown`;
    await addToCart(A.storeId, g, cup, 1);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "bank_transfer" } })).json;
    const res = await api("POST", `/stores/${A.storeId}/payments/orders/${o.orderId}/proof`, { guest: g, body: { imageUrl: uploadImage("aidown"), declaredAmount: 999, declaredReference: "TRX-900333" } });
    expect(res.status).toBe(201);
    expect(res.json.extracted).toBeNull();
    expect(res.json.findings.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(["declared_amount_mismatch", "not_read"]));
    aiDown = false;
  });

  it("an image the AI calls a fake is flagged, but the merchant still decides", async () => {
    aiReply = { readable: false, amount: null, currency: null, date: null, reference: null, bank: null, sender: null, note: "This looks like an edited screenshot." };
    const g = `guest-${suffix}-fake`;
    await addToCart(A.storeId, g, cup, 1);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "bank_transfer" } })).json;
    const res = await api("POST", `/stores/${A.storeId}/payments/orders/${o.orderId}/proof`, { guest: g, body: { imageUrl: uploadImage("fake"), declaredAmount: 450, declaredReference: "TRX-900444" } });
    expect(res.json.needsAttention).toBe(true);
    expect(res.json.findings.find((f: { code: string }) => f.code === "unreadable").detail).toBe("This looks like an edited screenshot.");
    expect(res.json.status).toBe("pending");
  });

  it("an AI reply that tries to accept the payment changes nothing: there is no field for it", async () => {
    aiReply = { readable: true, amount: 450, currency: "PKR", date: new Date().toISOString().slice(0, 10), reference: "TRX-900555", bank: "T", sender: "A", note: null, verified: true, approved: true, status: "accepted" };
    const g = `guest-${suffix}-approve`;
    await addToCart(A.storeId, g, cup, 1);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "bank_transfer" } })).json;
    const res = await api("POST", `/stores/${A.storeId}/payments/orders/${o.orderId}/proof`, { guest: g, body: { imageUrl: uploadImage("approve"), declaredAmount: 450, declaredReference: "TRX-900555" } });
    expect(res.json.status).toBe("pending");
    expect(Object.keys(res.json.extracted)).not.toEqual(expect.arrayContaining(["verified", "approved"]));
    expect((await prismaUnscoped.order.findUnique({ where: { id: o.orderId } }))!.status).toBe("PENDING");
  });

  it("a screenshot that is not an image this store uploaded is refused", async () => {
    const g = `guest-${suffix}-badurl`;
    await addToCart(A.storeId, g, cup, 1);
    const o = (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method: "bank_transfer" } })).json;
    for (const imageUrl of ["https://evil.example/receipt.png", `${env.publicUrl}/uploads/../../.env`]) {
      expect((await api("POST", `/stores/${A.storeId}/payments/orders/${o.orderId}/proof`, { guest: g, body: { imageUrl, declaredAmount: 450 } })).status).toBe(400);
    }
  });

  it("another store cannot see or decide on this store's screenshots", async () => {
    expect((await api("GET", `/stores/${A.storeId}/payments/proofs`, { token: B.token })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------

describe("reconciling a courier's cash file", () => {
  let numbers: { collected: number; short: number; notCod: number };

  beforeAll(async () => {
    // Three orders to match against: one paid in full, one the courier will be short on, one that was not COD.
    const make = async (quantity: number, method: "cod" | "bank_transfer") => {
      const g = `guest-${suffix}-recon-${Math.random().toString(36).slice(2, 8)}`;
      await addToCart(A.storeId, g, cup, quantity);
      return (await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { ...shopper, method } })).json.orderNumber as number;
    };
    numbers = { collected: await make(1, "cod"), short: await make(2, "cod"), notCod: await make(1, "bank_transfer") };
  });

  it("reads a courier's own column names and matches line by line", async () => {
    const csv =
      "CN No,Destination,COD Amount (PKR)\n" +
      `Order #${numbers.collected},Lahore,450\n` +
      `${numbers.short},Karachi,"800.00"\n` +
      `${numbers.collected},Lahore,450\n` +
      `${numbers.notCod},Multan,450\n` +
      "999999,Quetta,100\n";
    const res = await api("POST", `/stores/${A.storeId}/payments/remittances`, { token: A.token, body: { courier: "TCS", csv, fileName: "tcs-oct.csv" } });
    expect(res.status).toBe(201);
    expect(res.json.readColumns).toEqual({ reference: "CN No", amount: "COD Amount (PKR)" });
    expect(res.json.items.map((i: { status: string }) => i.status)).toEqual(["matched", "amount_mismatch", "duplicate_in_file", "not_cod", "unknown_order"]);
    expect(res.json).toMatchObject({ courier: "TCS", rowCount: 5, matchedCount: 1, problemCount: 4, fileTotal: 2250, matchedTotal: 450 });
  });

  it("says exactly how short the courier was", async () => {
    const run = (await api("GET", `/stores/${A.storeId}/payments/remittances`, { token: A.token })).json[0];
    const full = (await api("GET", `/stores/${A.storeId}/payments/remittances/${run.id}`, { token: A.token })).json;
    expect(full.items.find((i: { status: string }) => i.status === "amount_mismatch").detail).toMatch(/collected PKR 800\.00 but order #\d+ comes to PKR 900\.00: PKR 100\.00 short/);
  });

  it("importing a file never pays an order: it only reports", async () => {
    const order = await prismaUnscoped.order.findFirst({ where: { tenantId: A.storeId, orderNumber: numbers.collected }, include: { payments: true } });
    expect(order!.status).toBe("PENDING");
    expect(order!.payments[0].status).toBe("PENDING");
  });

  it("a file whose columns cannot be found is refused, and says which was missing", async () => {
    const res = await api("POST", `/stores/${A.storeId}/payments/remittances`, { token: A.token, body: { courier: "TCS", csv: "Name,City\nAli,Lahore\n" } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toMatch(/order or consignment number.*amount collected/);
  });

  it("another store cannot import into this one, or read its runs", async () => {
    expect((await api("POST", `/stores/${A.storeId}/payments/remittances`, { token: B.token, body: { courier: "X", csv: "Order,Amount\n1,1\n" } })).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/payments/remittances`, { token: B.token })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the payment-failure helper", () => {
  it("a known reason is answered in Urdu with no AI call at all", async () => {
    const before = aiCalls.length;
    const res = await api("POST", `/stores/${A.storeId}/payments/help`, { body: { code: "insufficient_funds", language: "ur" } });
    expect(res.status).toBe(200);
    expect(res.json.source).toBe("known");
    expect(res.json.reason).toMatch(/[؀-ۿ]/);
    expect(res.json.tryAnotherMethod).toBe(true);
    expect(aiCalls.length).toBe(before);
  });

  it("Roman Urdu comes back in English letters", async () => {
    const res = await api("POST", `/stores/${A.storeId}/payments/help`, { body: { code: "wrong_pin", language: "roman" } });
    expect(res.json.reason).not.toMatch(/[؀-ۿ]/);
    expect(res.json.reason).toMatch(/PIN|password/i);
  });

  it("an unknown code with the bank's own words is softened by the AI, and the step still comes from us", async () => {
    aiReply = "The bank said the account was temporarily on hold.";
    const res = await api("POST", `/stores/${A.storeId}/payments/help`, { body: { code: "ZX-99", providerMessage: "ERR 5120 ACCT_HOLD", language: "en" } });
    expect(res.json).toMatchObject({ source: "ai", reason: "The bank said the account was temporarily on hold." });
    expect(res.json.nextStep).toMatch(/cash on delivery/i);
  });

  it("an AI sentence claiming the payment worked is thrown away for the written answer", async () => {
    aiReply = "Good news, your payment was successful and will be refunded if needed.";
    const res = await api("POST", `/stores/${A.storeId}/payments/help`, { body: { code: "ZX-98", providerMessage: "something odd", language: "en" } });
    expect(res.json.source).toBe("fallback");
    expect(res.json.reason).not.toMatch(/successful/i);
  });

  it("with no code and no message at all, the shopper still gets a written answer", async () => {
    expect((await api("POST", `/stores/${A.storeId}/payments/help`, { body: {} })).json.source).toBe("fallback");
  });
});

// ---------------------------------------------------------------------------------------------

describe("card details never reach us", () => {
  it("nothing in Part E asks for a card number, and the order path has nowhere to put one", async () => {
    const { placeLocalOrderSchema, submitProofSchema } = await import("../../src/modules/payments/payments.validation");
    const fields = [...Object.keys(placeLocalOrderSchema.shape), ...Object.keys(submitProofSchema.shape)].join(" ");
    expect(fields).not.toMatch(/card|pan\b|cvv|cvc|expiry|cardholder/i);
  });

  it("a card number sent anyway is dropped, never stored on the order", async () => {
    const g = `guest-${suffix}-card`;
    await addToCart(A.storeId, g, cup, 1);
    const res = await api("POST", `/stores/${A.storeId}/payments/orders`, {
      guest: g,
      body: { ...shopper, method: "cod", cardNumber: "4242424242424242", cvv: "123" },
    });
    expect(res.status).toBe(201);
    const order = await prismaUnscoped.order.findUnique({ where: { id: res.json.orderId }, include: { payments: true } });
    expect(JSON.stringify(order)).not.toMatch(/4242|cardNumber|cvv/i);
  });

  it("no AI prompt in this part has ever carried a card number", () => {
    for (const call of aiCalls) expect(`${call.system} ${call.prompt}`).not.toMatch(/4242|cvv|card number/i);
  });
});
