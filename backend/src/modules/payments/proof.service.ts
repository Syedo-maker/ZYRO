import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { checkProof, hasProblem, summarise, type ExtractedProof, type ProofFinding } from "./proof.checks";
import type { ReviewProofInput, SubmitProofInput } from "./payments.validation";

/**
 * The payment screenshot verifier (Part E). A shopper who paid by bank or wallet transfer uploads
 * the receipt; the AI is asked only to read what is in the picture, the server compares that with
 * the order (proof.checks.ts), and the merchant accepts or rejects.
 *
 * The AI never accepts a payment, and is never asked whether to. It is given no order total, no
 * expected reference and no question about validity, so it cannot be led into agreeing that a
 * screenshot matches: it reports what it sees, and the comparison happens in code afterwards.
 */

const SYSTEM_PROMPT =
  "You read a screenshot of a money transfer receipt and report only what is printed in it. " +
  "Reply with JSON and nothing else, in this exact shape: " +
  '{"readable":true|false,"amount":number|null,"currency":string|null,"date":"YYYY-MM-DD"|null,' +
  '"reference":string|null,"bank":string|null,"sender":string|null,"note":string|null}. ' +
  "Use null for anything you cannot read clearly. Never guess a digit. Set readable to false when the " +
  "image is not a payment receipt or is too unclear, and put why in note. " +
  "Do not say whether the payment is correct, valid, genuine or complete: that is not your decision, " +
  "and you are not told what it should be. Do not add any field, comment or text outside the JSON.";

const PROMPT = "Read this payment receipt.";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type MediaType = "image/jpeg" | "image/png" | "image/webp";
const MEDIA_BY_EXT: Record<string, MediaType> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/**
 * Loads an uploaded image off disk. The URL must be one this server issued for its own uploads
 * folder, and the name is checked to be a single file name: a shopper must never be able to point
 * this at another path on the server and have its contents sent to the AI.
 */
async function loadImage(imageUrl: string): Promise<{ mediaType: MediaType; data: string } | null> {
  const expected = `${env.publicUrl}/uploads/`;
  if (!imageUrl.startsWith(expected)) return null;
  const name = imageUrl.slice(expected.length);
  if (!name || name !== path.basename(name) || name.includes("..")) return null;
  const mediaType = MEDIA_BY_EXT[path.extname(name).toLowerCase()];
  if (!mediaType) return null;
  try {
    const bytes = await readFile(path.join(env.uploadsDir, name));
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { mediaType, data: bytes.toString("base64") };
  } catch {
    return null;
  }
}

/** Reads the model's JSON, keeping only fields of the right shape. Anything odd becomes null. */
export function parseExtraction(text: string): ExtractedProof | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const date = str(raw.date);
  return {
    readable: raw.readable !== false,
    amount: num(raw.amount),
    currency: str(raw.currency),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    reference: str(raw.reference),
    bank: str(raw.bank),
    sender: str(raw.sender),
    note: str(raw.note),
  };
}

export const proofService = {
  /**
   * Whether a screenshot may be uploaded for this order at all. Called before the file is kept, so
   * an unpaid bank-transfer order in this store is the only thing that opens the upload.
   */
  async assertCanUpload(tenantId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, status: "PENDING", payments: { some: { method: "BANK_TRANSFER", status: "PENDING" } } },
      select: { id: true },
    });
    if (!order) throw Errors.notFound("Order");
  },

  /**
   * A shopper sends in their receipt. The AI reads it, the server checks it, and the proof is saved
   * as `pending`: never accepted here, whatever the checks say.
   */
  async submit(tenantId: string, orderId: string, input: SubmitProofInput) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { payments: { where: { method: "BANK_TRANSFER" } } },
    });
    if (!order) throw Errors.notFound("Order");
    if (order.payments.length === 0) throw Errors.validation("This order was not placed as a bank transfer.");
    if (order.payments.every((p) => p.status === "SUCCEEDED")) throw Errors.conflict("This order has already been paid for.");

    const existing = await prisma.paymentProof.findFirst({ where: { tenantId, orderId, status: { in: ["pending", "accepted"] } } });
    if (existing) throw Errors.conflict("A payment screenshot for this order is already waiting to be checked.");

    const referenceAlreadyUsed = input.declaredReference
      ? (await prisma.paymentProof.count({ where: { tenantId, declaredReference: input.declaredReference, orderId: { not: orderId } } })) > 0
      : false;

    const image = await loadImage(input.imageUrl);
    if (!image) throw Errors.validation("The screenshot must be an image uploaded to this store.");

    let extracted: ExtractedProof | null = null;
    let model: string | null = null;
    try {
      // The platform pays for this, like the other Part E and Part D features; a store's own AI
      // allowance is for the content tools it chooses to use.
      const result = await aiGenerate({
        tenantId,
        promptType: "payment_proof",
        system: SYSTEM_PROMPT,
        prompt: PROMPT,
        image,
        maxTokens: 400,
        billedTo: "platform",
      });
      extracted = parseExtraction(result.text);
      model = result.model;
    } catch {
      // No key, the provider down, or an unreadable reply: the merchant checks the image unaided,
      // and the server's own checks (amount typed in, reference reused) still run.
      extracted = null;
    }

    const findings = checkProof(extracted, {
      orderTotal: Number(order.total.toString()),
      currency: order.currency,
      declaredAmount: input.declaredAmount,
      declaredReference: input.declaredReference ?? null,
      orderPlacedAt: order.createdAt,
      referenceAlreadyUsed,
    });

    try {
      const proof = await prisma.paymentProof.create({
        data: {
          tenantId,
          orderId,
          imageUrl: input.imageUrl,
          declaredAmount: input.declaredAmount.toFixed(2),
          declaredReference: input.declaredReference ?? null,
          extracted: (extracted ?? undefined) as unknown as Prisma.InputJsonValue,
          findings: findings as unknown as Prisma.InputJsonValue,
          model,
        },
      });
      return present(proof);
    } catch (err) {
      // The same reference twice in this store: the unique key is the real guard, the count above is
      // only there to say so in the findings.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict("That transfer reference has already been used in this store.");
      }
      throw err;
    }
  },

  /** What the shopper sees after sending a receipt in: that it is waiting, never the findings. */
  async forShopper(tenantId: string, orderId: string) {
    const proof = await prisma.paymentProof.findFirst({ where: { tenantId, orderId }, orderBy: { createdAt: "desc" } });
    if (!proof) return { status: "none" as const };
    return {
      status: proof.status as "pending" | "accepted" | "rejected",
      submittedAt: proof.createdAt,
      ...(proof.status === "rejected" ? { reason: proof.rejectionReason } : {}),
    };
  },

  /** The merchant's queue of receipts waiting to be checked. */
  async list(tenantId: string, status: string | undefined) {
    const proofs = await prisma.paymentProof.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { order: { select: { orderNumber: true, total: true, currency: true } } },
    });
    return proofs.map((p) => ({ ...present(p), order: { orderNumber: p.order.orderNumber, total: Number(p.order.total.toString()), currency: p.order.currency } }));
  },

  /**
   * The merchant decides. This is the only place a bank-transfer payment becomes SUCCEEDED, and it
   * takes a user id: a payment is always accepted by a person, never by the AI and never by a rule.
   */
  async review(tenantId: string, proofId: string, userId: string, input: ReviewProofInput) {
    const proof = await prisma.paymentProof.findFirst({ where: { id: proofId, tenantId } });
    if (!proof) throw Errors.notFound("Payment screenshot");
    if (proof.status !== "pending") throw Errors.conflict("This screenshot has already been dealt with.");

    const updated = await prisma.$transaction(async (tx) => {
      if (input.decision === "accept") {
        const order = await tx.order.findFirst({ where: { id: proof.orderId, tenantId }, include: { payments: { where: { method: "BANK_TRANSFER" } } } });
        if (!order) throw Errors.notFound("Order");
        await tx.payment.updateMany({ where: { orderId: order.id, tenantId, method: "BANK_TRANSFER", status: "PENDING" }, data: { status: "SUCCEEDED" } });
        await tx.order.updateMany({ where: { id: order.id, tenantId, status: "PENDING" }, data: { status: "PAID" } });
      }
      await tx.paymentProof.updateMany({
        where: { id: proofId, tenantId, status: "pending" },
        data: {
          status: input.decision === "accept" ? "accepted" : "rejected",
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          rejectionReason: input.decision === "reject" ? (input.reason ?? "The merchant could not match this screenshot to the order.") : null,
        },
      });
      return tx.paymentProof.findFirst({ where: { id: proofId, tenantId } });
    });
    return present(updated!);
  },
};

type ProofRow = Prisma.PaymentProofGetPayload<object>;

function present(p: ProofRow) {
  const findings = (p.findings as unknown as ProofFinding[]) ?? [];
  return {
    id: p.id,
    orderId: p.orderId,
    imageUrl: p.imageUrl,
    declaredAmount: Number(p.declaredAmount.toString()),
    declaredReference: p.declaredReference,
    /** What the AI read. Shown to the merchant beside the image so they can see what it based this on. */
    extracted: (p.extracted as unknown as ExtractedProof) ?? null,
    findings,
    needsAttention: hasProblem(findings),
    summary: summarise(findings),
    status: p.status,
    reviewedAt: p.reviewedAt,
    rejectionReason: p.rejectionReason,
    readBy: p.model,
    createdAt: p.createdAt,
  };
}
