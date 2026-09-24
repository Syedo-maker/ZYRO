import { getRedis } from "../../lib/redis";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { productService } from "../products/product.service";
import { ChatTranscript, type ChatRole } from "../../models/ChatTranscript.model";
import type { CartOwner } from "../cart/cart.service";

/**
 * Module 3: AI Shopping Assistant (Implementation_Plan.md Phase 5). Built entirely on
 * infrastructure from earlier phases: the AI Orchestrator (Phase 4) for the actual LLM call and
 * quota accounting, and the Mongo text-index search from Phase 3, Module 1 for "relevant
 * product data" - the plan's own words for why this is keyword matching, not a vector-embedding
 * pipeline: "keeps scope realistic while still supporting AI-suggested related products". A
 * real similarity search is Phase 6's job (a separate Python service), noted there as the
 * planned upgrade path for this exact keyword search.
 */

const MAX_CONTEXT_TURNS = 6;
const CONTEXT_TTL_SECONDS = 60 * 60; // an hour of silence resets the assistant's short memory
const MAX_TRANSCRIPT_MESSAGES = 200; // 100 exchanges; see ChatTranscript.model.ts
const TRANSCRIPT_TTL_DAYS = 90; // a debugging aid, not a permanent record; see expiresAt there

interface ContextTurn {
  role: ChatRole;
  content: string;
}

function contextKey(storeId: string, conversationId: string): string {
  return `chat:ctx:${storeId}:${conversationId}`;
}

async function getRecentContext(storeId: string, conversationId: string): Promise<ContextTurn[]> {
  const raw = await getRedis().get(contextKey(storeId, conversationId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ContextTurn[];
  } catch {
    return [];
  }
}

async function appendToContext(storeId: string, conversationId: string, turns: ContextTurn[]): Promise<void> {
  const history = await getRecentContext(storeId, conversationId);
  const next = [...history, ...turns].slice(-MAX_CONTEXT_TURNS);
  await getRedis().set(contextKey(storeId, conversationId), JSON.stringify(next), "EX", CONTEXT_TTL_SECONDS);
}

/** Flattens the short history plus the new message into the single prompt string the
 *  orchestrator's generate() takes (it is a thin single-turn wrapper, not a full chat API). */
function buildPrompt(history: ContextTurn[], message: string): string {
  const turns = history.map((t) => `${t.role === "user" ? "Shopper" : "Assistant"}: ${t.content}`);
  turns.push(`Shopper: ${message}`);
  return turns.join("\n");
}

async function appendToTranscript(storeId: string, conversationId: string, owner: CartOwner, turns: ContextTurn[]): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRANSCRIPT_TTL_DAYS * 24 * 60 * 60 * 1000);
  await ChatTranscript.updateOne(
    { storeId, conversationId },
    {
      $setOnInsert: { storeId, conversationId, ...(owner.kind === "user" ? { customerId: owner.id } : { guestSessionId: owner.id }) },
      // Refreshed on every message, not just at creation, so an active conversation is never
      // evicted mid-use; only a conversation nobody has touched in 90 days eventually expires.
      $set: { expiresAt },
      $push: { messages: { $each: turns.map((t) => ({ role: t.role, content: t.content, createdAt: now })), $slice: -MAX_TRANSCRIPT_MESSAGES } },
    },
    { upsert: true }
  );
}

export const assistantService = {
  /**
   * `conversationId` is minted and held by the caller (backend/openapi.yaml, drafted in Phase
   * 0), the same trust-by-possession model already used for the guest cart's
   * X-Guest-Session-Id: an unguessable id, generated with a CSPRNG on the frontend, is treated
   * as proof enough that two requests are the same conversation. It is not bound to `owner`.
   */
  async chat(storeId: string, owner: CartOwner, conversationId: string, message: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId }, select: { name: true } });
    if (!tenant) throw Errors.notFound("Store");

    const [history, matches] = await Promise.all([
      getRecentContext(storeId, conversationId),
      productService.list(storeId, { q: message, limit: 5, offset: 0, inStock: false }),
    ]);

    const productLines = matches.data.map((p) => `- ${p.title} ($${p.price.toFixed(2)}, ${p.category}${p.stock > 0 ? "" : ", currently out of stock"})`);
    const system =
      `You are a friendly, concise shopping assistant for the online store "${tenant.name}". Answer the shopper's ` +
      "question in 2 to 4 short sentences, plain prose, no markdown. Base your answer only on the product list " +
      "below; never invent a product, price or stock level that is not listed. If nothing in the list actually " +
      "answers the question, say so honestly and suggest they browse the catalog instead of guessing.\n\n" +
      (productLines.length > 0 ? `Products that matched their message:\n${productLines.join("\n")}` : "No products matched their message.");

    const result = await aiGenerate({
      tenantId: storeId,
      promptType: "chat",
      kind: "chat",
      system,
      prompt: buildPrompt(history, message),
      maxTokens: 300,
    });

    const turns: ContextTurn[] = [
      { role: "user", content: message },
      { role: "assistant", content: result.text },
    ];
    await Promise.all([
      appendToContext(storeId, conversationId, turns),
      appendToTranscript(storeId, conversationId, owner, turns),
    ]);

    return {
      conversationId,
      reply: result.text,
      // The same Product shape the catalog itself returns (backend/openapi.yaml), so the
      // storefront can render these exactly like any other product card, no special-casing.
      suggestedProducts: matches.data,
    };
  },
};
