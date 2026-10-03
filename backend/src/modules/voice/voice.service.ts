import { Prisma } from "@prisma/client";
import { Types } from "mongoose";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { Product } from "../../models/Product.model";
import { getRecommendationClient, RecommendationUnavailableError, TranscriptionRefusedError } from "../../lib/recommendationClient";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { productService } from "../products/product.service";
import { runLadder } from "../search/search.service";
import { buildDraft, describeDraft, parseRawDraft, SYSTEM_PROMPT, type CandidateProduct, type VoiceDraft } from "./voice.draft";

/**
 * The voice-note store manager (Part G). A shopkeeper with their hands full says "chai cup ka stock
 * pachas kar do" and the shop writes it down as a change for them to approve.
 *
 * Two deliberate properties:
 *
 * 1. **Nothing is ever applied by speaking.** A note becomes a draft; the merchant reads it and
 *    confirms. The gate asks for this, and it is right: speech across Urdu, Roman Urdu and English
 *    is misheard often, and prices and stock are not things to change on a maybe.
 * 2. **The AI never touches the catalogue.** It reads words and reports what it heard; the product
 *    is matched by the ordinary search, and the change is applied by the ordinary product service,
 *    with all its existing validation and plan limits.
 */

export const voiceService = {
  /**
   * Transcribes a recording and drafts what it asks for. Returns the note either way: a note that
   * could not be understood is still saved, with the words and the reason, so the merchant can see
   * what was heard rather than wondering why nothing happened.
   */
  async record(storeId: string, userId: string, audio: Buffer, filename: string, mimeType: string, audioUrl: string) {
    let transcript: Awaited<ReturnType<ReturnType<typeof getRecommendationClient>["transcribe"]>>;
    try {
      transcript = await getRecommendationClient().transcribe(audio, filename, mimeType);
    } catch (err) {
      if (err instanceof RecommendationUnavailableError) {
        throw Errors.serviceUnavailable("Voice notes are not switched on for this server yet. Make the change yourself for now.");
      }
      if (err instanceof TranscriptionRefusedError) throw Errors.validation(err.message);
      throw err;
    }

    if (!transcript.text.trim()) {
      return save(storeId, userId, audioUrl, { text: "", language: transcript.language, confidence: 0, durationSeconds: transcript.durationSeconds }, null, "Nothing could be heard in that recording.", null);
    }

    // The model only reads the words. It is given no product list, no prices and no ids, so it has
    // nothing to act on and nothing to leak; matching the product is done afterwards, by search.
    let raw = null;
    let model: string | null = null;
    try {
      const result = await aiGenerate({
        tenantId: storeId,
        promptType: "voice_note",
        system: SYSTEM_PROMPT,
        prompt: `The shopkeeper said: ${transcript.text.slice(0, 1000)}`,
        maxTokens: 300,
        billedTo: "platform",
      });
      raw = parseRawDraft(result.text);
      model = result.model;
    } catch {
      // No key or the provider down: the words are still saved, so the merchant can read them.
      raw = null;
    }

    const matched = raw?.product ? await matchProduct(storeId, raw.product) : null;
    const { draft, problem } = buildDraft(raw, matched, transcript.confidence);
    return save(storeId, userId, audioUrl, transcript, draft, problem, model);
  },

  async list(storeId: string, status?: string) {
    const notes = await prisma.voiceNote.findMany({ where: { tenantId: storeId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 50 });
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId }, select: { currency: true } });
    return notes.map((n) => present(n, tenant?.currency ?? "PKR"));
  },

  /**
   * The merchant confirms a draft. This is the only place a voice note changes anything, and it does
   * it through the ordinary product service, so every rule that applies to a typed change applies
   * here too: plan limits, validation, the search vocabulary, the recommendation index.
   */
  async apply(storeId: string, noteId: string, userId: string) {
    const note = await prisma.voiceNote.findFirst({ where: { id: noteId, tenantId: storeId } });
    if (!note) throw Errors.notFound("Voice note");
    if (note.status !== "pending") throw Errors.conflict("This note has already been dealt with.");
    const draft = note.draft as unknown as VoiceDraft | null;
    if (!draft) throw Errors.validation("There is nothing to apply in this note.");

    let outcome: string;
    if (draft.kind === "add_product") {
      const created = await productService.create(
        storeId,
        { title: draft.title!, price: draft.price!, stock: draft.stock ?? 0, category: draft.category ?? "uncategorised", description: "", images: [], taxable: true, tags: [] },
        userId
      );
      outcome = `Added "${created.title}".`;
    } else {
      const existing = await Product.findOne({ _id: draft.productId, storeId });
      if (!existing) throw Errors.notFound("Product");
      // The whole product is sent back through update, so its own validation runs on every field.
      const current = await productService.get(storeId, draft.productId!);
      const input = {
        title: current.title,
        description: current.description ?? undefined,
        price: draft.kind === "set_price" ? draft.price! : current.price,
        stock: draft.kind === "set_stock" ? draft.stock! : current.stock,
        category: current.category,
        images: current.images,
        sku: current.sku ?? undefined,
        barcode: current.barcode ?? undefined,
        taxable: current.taxable,
        tags: current.tags,
      };
      await productService.update(storeId, draft.productId!, input, userId);
      outcome = draft.kind === "set_price" ? `Price of "${draft.productName}" changed.` : `Stock of "${draft.productName}" set to ${draft.stock}.`;
    }

    await prisma.voiceNote.updateMany({ where: { id: noteId, tenantId: storeId, status: "pending" }, data: { status: "applied", appliedAt: new Date() } });
    return { id: noteId, status: "applied", outcome };
  },

  async discard(storeId: string, noteId: string) {
    const { count } = await prisma.voiceNote.updateMany({ where: { id: noteId, tenantId: storeId, status: "pending" }, data: { status: "discarded" } });
    if (count === 0) throw Errors.notFound("Voice note");
  },
};

/**
 * Finds the product the merchant meant, through the same search ladder a shopper uses, so a spoken
 * "chai cup" matches "Clay Chai Cup" and a mispronunciation is forgiven the same way a typo is.
 */
async function matchProduct(storeId: string, spoken: string): Promise<CandidateProduct | null> {
  const outcome = await runLadder(storeId, spoken, { storeId });
  if (!outcome.filter) return null;
  const doc = await Product.findOne(outcome.filter, outcome.ranked ? { score: { $meta: "textScore" } } : undefined)
    .sort(outcome.ranked ? { score: { $meta: "textScore" } } : { title: 1 })
    .select("title price");
  if (!doc) return null;
  return { id: doc._id.toString(), title: doc.title, price: Number(doc.price.toString()) };
}

async function save(
  storeId: string,
  userId: string,
  audioUrl: string,
  transcript: { text: string; language: string | null; confidence: number; durationSeconds: number },
  draft: VoiceDraft | null,
  problem: string | null,
  model: string | null
) {
  const note = await prisma.voiceNote.create({
    data: {
      tenantId: storeId,
      userId,
      audioUrl,
      transcript: transcript.text,
      language: transcript.language,
      draft: (draft ?? undefined) as unknown as Prisma.InputJsonValue,
      problem,
      model,
    },
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: storeId }, select: { currency: true } });
  return present(note, tenant?.currency ?? "PKR");
}

type NoteRow = Prisma.VoiceNoteGetPayload<object>;

function present(note: NoteRow, currency: string) {
  const draft = (note.draft as unknown as VoiceDraft) ?? null;
  return {
    id: note.id,
    transcript: note.transcript,
    language: note.language,
    audioUrl: note.audioUrl,
    draft,
    /** The change in plain words, for the merchant to read before confirming. */
    summary: draft ? describeDraft(draft, currency) : null,
    problem: note.problem,
    status: note.status as "pending" | "applied" | "discarded",
    createdAt: note.createdAt,
  };
}

export const __forTests = { matchProduct };
void Types;
