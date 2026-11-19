import path from "node:path";
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { billingCurrencies, planPaymentsConfigured } from "../../config/planPayments";
import { prismaUnscoped } from "../../lib/prisma";
import { getStorage, parseKey } from "../../lib/storage";
import { effectiveTier } from "../../lib/plans";
import { Errors } from "../../errors/AppError";
import { errorMessage, logger } from "../../lib/logger";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { activatePlan, endPlan, nextPeriodEnd, recordPlanAudit } from "../billing/planActivation";
import { billingCurrencyFor, chooseBillingCurrency, lockBillingCurrency, adminChangeBillingCurrency } from "../billing/billingCurrency";
import { checkPlanProof, normaliseTransactionId, parsePlanProof, summariseProof, PLAN_PROOF_PROMPT, PLAN_PROOF_SYSTEM_PROMPT, type PlanProofReading } from "./planProof";
import { emailApprovers, emailOwnerApproved, emailOwnerRejected, emailOwnerRevoked, hashToken } from "./planPayments.notify";
import { maybeGrantProvisional } from "./planPayments.jobs";

/**
 * Paying the platform for a plan by transfer, with a person approving (Pro plan payments, 2026-11).
 *
 *   owner:     open the upgrade page (a request with a reference code) -> pay -> upload the screenshot
 *              and enter the transaction ID -> "pending", reviewed by a person
 *   server:    the AI reads the screenshot, the server checks it (planProof.ts), approvers are emailed
 *   approver:  signs in, opens the request (from the email link or the queue), approves or rejects
 *
 * Only a platform admin whose email is in PLAN_APPROVER_EMAILS decides, and the first decision wins.
 * Approval goes through the one plan switch (billing/planActivation.ts), which a verified gateway can
 * call later without a person, under the same audit trail. Every query here names the store or the
 * request explicitly (the unscoped client: the approver's queue spans every store).
 */

export const REVIEW_NOTICE =
  "Your payment is reviewed by a person. This usually takes 24 to 48 hours. Your money is safe, and you get a refund if the request is rejected.";
const PLAN = "PRO" as const;
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
type MediaType = "image/jpeg" | "image/png" | "image/webp";
const MEDIA_BY_EXT: Record<string, MediaType> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const settings = () => env.planPayments;
function assertConfigured() {
  if (!planPaymentsConfigured(settings())) throw Errors.serviceUnavailable("Paying for a plan by transfer is not set up on this server yet.");
}

/** The store id's last characters and a random part: easy to read out, unique by constraint. */
function newReferenceCode(storeId: string) {
  let random = "";
  for (let i = 0; i < 6; i++) random += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `ZY-${storeId.slice(-4).toUpperCase()}-${random}`;
}

async function storeAndOwner(storeId: string) {
  const store = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { id: true, name: true, currency: true, ownerId: true, plan: true, planExpiresAt: true, planProvisional: true } });
  if (!store) throw Errors.notFound("Store");
  return store;
}

const ownerRequestView = (r: { id: string; referenceCode: string; status: string; amountMinor: number; currency: string; submittedAt: Date | null; decidedAt: Date | null; decisionReason: string | null; provisionalUntil: Date | null; periodEnd: Date | null }) => ({
  id: r.id,
  referenceCode: r.referenceCode,
  status: r.status,
  amountMinor: r.amountMinor,
  currency: r.currency,
  submittedAt: r.submittedAt,
  decidedAt: r.decidedAt,
  provisionalUntil: r.provisionalUntil,
  periodEnd: r.periodEnd,
  // The owner sees why a request was rejected; never the automatic findings, so they cannot be gamed.
  ...(r.status === "rejected" || r.status === "revoked" ? { reason: r.decisionReason } : {}),
});

export const planPaymentsService = {
  /** The upgrade page: price, payment details, any open request and the history. Owner only. */
  async overview(storeId: string, ownerId: string) {
    const store = await storeAndOwner(storeId);
    const configured = planPaymentsConfigured(settings());
    const billing = await billingCurrencyFor(ownerId, store.currency);
    const tier = effectiveTier(store);
    const requests = await prismaUnscoped.planPaymentRequest.findMany({ where: { tenantId: storeId }, orderBy: { createdAt: "desc" }, take: 10 });
    const open = requests.find((r) => r.status === "awaiting_proof" || r.status === "pending") ?? null;
    const price = billing.currency ? settings().pricesMinor[PLAN]?.[billing.currency] ?? null : null;
    return {
      configured,
      notice: REVIEW_NOTICE,
      currentPlan: { tier, until: tier === "FREE" ? null : store.planExpiresAt, provisional: tier !== "FREE" && store.planProvisional },
      plan: PLAN,
      currency: billing,
      price: configured && billing.currency && price ? { amountMinor: price, currency: billing.currency } : null,
      methods: configured && billing.currency ? settings().methods[billing.currency] ?? [] : [],
      openRequest: open ? ownerRequestView(open) : null,
      history: requests.filter((r) => r !== open && r.status !== "cancelled").map(ownerRequestView),
    };
  },

  async chooseCurrency(storeId: string, ownerId: string, currency: string) {
    assertConfigured();
    if (await prismaUnscoped.planPaymentRequest.count({ where: { tenantId: storeId, status: "pending" } })) {
      throw Errors.conflict("A payment is waiting for review. The currency can be changed after it is decided.");
    }
    const code = await chooseBillingCurrency(ownerId, currency, storeId);
    // A reference made for the old currency asked for a different amount: it is withdrawn.
    await prismaUnscoped.planPaymentRequest.updateMany({ where: { tenantId: storeId, status: "awaiting_proof", NOT: { currency: code } }, data: { status: "cancelled" } });
    return { currency: code };
  },

  /** Opens (or reuses) a request: the reference code to quote, at the price for the account's currency. */
  async startRequest(storeId: string, ownerId: string) {
    assertConfigured();
    const store = await storeAndOwner(storeId);
    if (await prismaUnscoped.planPaymentRequest.count({ where: { tenantId: storeId, status: "pending" } })) {
      throw Errors.conflict("A payment for this store is already waiting for review.");
    }
    const { currency } = await billingCurrencyFor(ownerId, store.currency);
    const amountMinor = currency ? settings().pricesMinor[PLAN]?.[currency] : undefined;
    if (!currency || !amountMinor) throw Errors.serviceUnavailable("The Pro plan has no price in your billing currency. Contact support.");
    const existing = await prismaUnscoped.planPaymentRequest.findFirst({ where: { tenantId: storeId, status: "awaiting_proof", currency, amountMinor } });
    if (existing) return ownerRequestView(existing);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await prismaUnscoped.planPaymentRequest.create({
          data: { tenantId: storeId, ownerId, plan: PLAN, currency, amountMinor, referenceCode: newReferenceCode(storeId) },
        });
        await recordPlanAudit(prismaUnscoped, { tenantId: storeId, requestId: created.id, actor: { kind: "owner", userId: ownerId }, action: "payment_request_opened", details: { amountMinor, currency } });
        return ownerRequestView(created);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    throw Errors.serviceUnavailable("Could not create a reference code. Please try again.");
  },

  /** Before a proof file is kept: only an open request of this store accepts one. */
  async assertCanUpload(storeId: string, requestId: string) {
    const request = await prismaUnscoped.planPaymentRequest.findFirst({ where: { id: requestId, tenantId: storeId, status: "awaiting_proof" }, select: { id: true } });
    if (!request) throw Errors.notFound("Open payment request");
  },

  /** The owner sends the screenshot and the transaction ID. Never activates anything by itself. */
  async submit(storeId: string, ownerId: string, requestId: string, input: { imageKey: string; transactionId: string }) {
    assertConfigured();
    const store = await storeAndOwner(storeId);
    const request = await prismaUnscoped.planPaymentRequest.findFirst({ where: { id: requestId, tenantId: storeId } });
    if (!request) throw Errors.notFound("Payment request");
    if (request.status !== "awaiting_proof") throw Errors.conflict("This payment request has already been sent.");

    const parsed = parseKey(input.imageKey);
    if (!parsed || parsed.area !== "plans" || parsed.storeId !== storeId) throw Errors.validation("The screenshot must be uploaded on this page first.");
    const transactionId = normaliseTransactionId(input.transactionId);
    if (transactionId.length < 4 || transactionId.length > 64) throw Errors.validation("Enter the transaction ID shown on your receipt (4 to 64 letters or digits).");
    // Refused before the AI reads anything, so repeating a known ID cannot buy a paid AI call.
    if (await prismaUnscoped.planPaymentRequest.count({ where: { transactionId } })) throw Errors.conflict("This transaction ID has already been used.");

    const mediaType = MEDIA_BY_EXT[path.extname(input.imageKey).toLowerCase()];
    const bytes = mediaType ? await getStorage().get(input.imageKey) : null;
    if (!mediaType || !bytes) throw Errors.validation("The screenshot must be uploaded on this page first.");

    let reading: PlanProofReading | null = null;
    let model: string | null = null;
    try {
      // The platform pays; the store's own AI allowance is not touched. A failed call costs nothing.
      const result = await aiGenerate({
        tenantId: storeId,
        promptType: "plan_payment_proof",
        system: PLAN_PROOF_SYSTEM_PROMPT,
        prompt: PLAN_PROOF_PROMPT,
        image: { mediaType, data: bytes.toString("base64") },
        maxTokens: 400,
        billedTo: "platform",
      });
      reading = parsePlanProof(result.text);
      model = reading ? result.model : null;
    } catch (err) {
      // No key, the kill switch, the provider down: a person checks it by eye. Logged by request id only.
      logger.warn({ requestId, err: errorMessage(err) }, "plan payment screenshot could not be read automatically");
      reading = null;
    }
    const findings = checkPlanProof(reading, {
      amountMinor: request.amountMinor,
      currency: request.currency,
      referenceCode: request.referenceCode,
      transactionId,
      transactionIdIsNew: true,
      methods: settings().methods[request.currency] ?? [],
      maxAgeDays: settings().proofMaxAgeDays,
    });
    const aiStatus = summariseProof(reading, findings, settings().provisional.minConfidence);

    let updated;
    try {
      updated = await prismaUnscoped.$transaction(async (tx) => {
        const changed = await tx.planPaymentRequest.updateMany({
          where: { id: requestId, tenantId: storeId, status: "awaiting_proof" },
          data: {
            status: "pending",
            transactionId,
            proofKey: input.imageKey,
            submittedAt: new Date(),
            aiExtracted: (reading ?? undefined) as Prisma.InputJsonValue | undefined,
            aiStatus,
            aiModel: model,
            findings: findings as unknown as Prisma.InputJsonValue,
          },
        });
        if (changed.count === 0) throw Errors.conflict("This payment request has already been sent.");
        await recordPlanAudit(tx, { tenantId: storeId, requestId, actor: { kind: "owner", userId: ownerId }, action: "payment_submitted", details: { amountMinor: request.amountMinor, currency: request.currency, transactionId, aiStatus } });
        return tx.planPaymentRequest.findUniqueOrThrow({ where: { id: requestId } });
      });
    } catch (err) {
      // Two requests racing with one transaction ID: the unique key is the real guard.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw Errors.conflict("This transaction ID has already been used.");
      throw err;
    }
    // Provisional Pro, only when switched on and every check passed with high confidence.
    const provisionalUntil = await maybeGrantProvisional(updated, reading?.confidence ?? null);
    const final = provisionalUntil ? { ...updated, provisionalUntil } : updated;
    await emailApprovers({ ...final, storeName: store.name });
    return ownerRequestView(final);
  },

  // ---- Platform admins ----------------------------------------------------------------------------

  /** Only a platform admin listed in PLAN_APPROVER_EMAILS may decide. */
  async assertApprover(userId: string) {
    const user = await prismaUnscoped.user.findUnique({ where: { id: userId }, select: { email: true, platformRole: true } });
    if (!user || user.platformRole !== "SUPER_ADMIN" || !settings().approverEmails.includes(user.email.toLowerCase())) {
      throw Errors.forbidden("Only the configured approvers can decide plan payments.");
    }
    return user.email.toLowerCase();
  },

  async list(status: string | undefined) {
    const where = status && status !== "all" ? { status } : { status: { in: ["pending"] } };
    const rows = await prismaUnscoped.planPaymentRequest.findMany({
      where,
      orderBy: { submittedAt: "asc" },
      take: 100,
      include: { tenant: { select: { name: true } }, owner: { select: { email: true } } },
    });
    return { data: rows.map((r) => adminView(r)) };
  },

  async get(id: string) {
    const r = await prismaUnscoped.planPaymentRequest.findUnique({ where: { id }, include: { tenant: { select: { name: true } }, owner: { select: { email: true } } } });
    if (!r) throw Errors.notFound("Payment request");
    // A short-lived signed link to the private proof, made fresh each time it is shown.
    const proofUrl = r.proofKey ? await getStorage().signedUrl(r.proofKey, env.storage.privateLinkSeconds) : null;
    const audit = await prismaUnscoped.planAuditEvent.findMany({ where: { requestId: id }, orderBy: { createdAt: "asc" }, select: { action: true, actorKind: true, actorUserId: true, createdAt: true, details: true } });
    return { ...adminView(r), proofUrl, aiExtracted: r.aiExtracted, audit };
  },

  /** Where an emailed link leads. Never uses the link up: only a decision does. */
  async resolveReviewLink(token: string, adminEmail: string) {
    const row = await prismaUnscoped.planReviewToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { request: { select: { id: true, status: true } } } });
    if (!row) return { state: "unknown" as const };
    if (row.email !== adminEmail) return { state: "other_approver" as const };
    const base = { requestId: row.request.id };
    if (row.request.status !== "pending") return { ...base, state: "decided" as const, status: row.request.status };
    if (row.usedAt) return { ...base, state: "used" as const };
    if (row.expiresAt < new Date()) return { ...base, state: "expired" as const };
    return { ...base, state: "valid" as const };
  },

  async approve(id: string, adminId: string, input: { token?: string; receivedAmount?: number; receivedCurrency?: string; receivedPkr?: number }) {
    const adminEmail = await this.assertApprover(adminId);
    const request = await prismaUnscoped.planPaymentRequest.findUnique({ where: { id }, include: { owner: { select: { email: true } } } });
    if (!request) throw Errors.notFound("Payment request");
    if (request.status !== "pending") return alreadyDecided(request);
    if (input.token) await checkToken(input.token, id, adminEmail);

    // What the approver confirms arrived must be exactly the price: a different amount or currency
    // never activates a plan (reject it and refund, or ask the owner to pay the difference separately).
    const receivedCurrency = (input.receivedCurrency ?? request.currency).toUpperCase();
    const receivedAmountMinor = input.receivedAmount === undefined ? request.amountMinor : Math.round(input.receivedAmount * 100);
    if (receivedCurrency !== request.currency || receivedAmountMinor !== request.amountMinor) {
      throw Errors.validation("The amount received must equal the price in the same currency. Reject the request if it does not.");
    }
    const receivedPkrMinor = input.receivedPkr === undefined ? null : Math.round(input.receivedPkr * 100);

    const result = await prismaUnscoped.$transaction(async (tx) => {
      const now = new Date();
      const store = await tx.tenant.findUniqueOrThrow({ where: { id: request.tenantId }, select: { plan: true, planExpiresAt: true, planProvisional: true } });
      const periodEnd = nextPeriodEnd(store, request.plan, settings().periodDays, now);
      // The first decision wins: the condition is in the update, so a second approver changes nothing.
      const changed = await tx.planPaymentRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: "approved", decidedById: adminId, decidedAt: now, receivedAmountMinor, receivedCurrency, receivedPkrMinor, periodEnd, provisionalUntil: null },
      });
      if (changed.count === 0) return null;
      await activatePlan(tx, {
        tenantId: request.tenantId,
        requestId: id,
        tier: request.plan as "PRO" | "BUSINESS",
        until: periodEnd,
        actor: { kind: "approver", userId: adminId },
        action: "plan_payment_approved",
        details: { amountMinor: request.amountMinor, currency: request.currency, transactionId: request.transactionId, proofKey: request.proofKey, receivedAmountMinor, receivedCurrency, receivedPkrMinor },
      });
      await lockBillingCurrency(tx, request.ownerId, request.currency);
      await tx.planReviewToken.updateMany({ where: { requestId: id, usedAt: null }, data: { usedAt: now } });
      return periodEnd;
    });
    if (!result) return alreadyDecided(await prismaUnscoped.planPaymentRequest.findUniqueOrThrow({ where: { id } }));
    await emailOwnerApproved(request.owner.email, { referenceCode: request.referenceCode, amountMinor: request.amountMinor, currency: request.currency, transactionId: request.transactionId, periodEnd: result, requestId: id });
    return { status: "approved", alreadyDecided: false, periodEnd: result };
  },

  async reject(id: string, adminId: string, input: { reason: string; token?: string }) {
    const adminEmail = await this.assertApprover(adminId);
    const reason = input.reason.trim();
    if (reason.length < 3) throw Errors.validation("Give the owner a reason (at least 3 characters).");
    const request = await prismaUnscoped.planPaymentRequest.findUnique({ where: { id }, include: { owner: { select: { email: true } } } });
    if (!request) throw Errors.notFound("Payment request");
    if (request.status !== "pending") return alreadyDecided(request);
    if (input.token) await checkToken(input.token, id, adminEmail);

    let provisionalEnded = false;
    const decided = await prismaUnscoped.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.planPaymentRequest.updateMany({ where: { id, status: "pending" }, data: { status: "rejected", decidedById: adminId, decidedAt: now, decisionReason: reason.slice(0, 300) } });
      if (changed.count === 0) return false;
      await recordPlanAudit(tx, { tenantId: request.tenantId, requestId: id, actor: { kind: "approver", userId: adminId }, action: "payment_rejected", details: { reason: reason.slice(0, 300), transactionId: request.transactionId } });
      // A provisional plan granted for this request ends now.
      const store = await tx.tenant.findUniqueOrThrow({ where: { id: request.tenantId }, select: { planProvisional: true } });
      if (request.provisionalUntil && store.planProvisional) {
        await endPlan(tx, { tenantId: request.tenantId, requestId: id, actor: { kind: "approver", userId: adminId }, action: "provisional_ended_rejected" });
        provisionalEnded = true;
      }
      await tx.planPaymentRequest.update({ where: { id }, data: { provisionalUntil: null } });
      await tx.planReviewToken.updateMany({ where: { requestId: id, usedAt: null }, data: { usedAt: now } });
      return true;
    });
    if (!decided) return alreadyDecided(await prismaUnscoped.planPaymentRequest.findUniqueOrThrow({ where: { id } }));
    await emailOwnerRejected(request.owner.email, { referenceCode: request.referenceCode, reason, requestId: id, provisionalEnded });
    return { status: "rejected", alreadyDecided: false };
  },

  /** A refund or reversal after approval: the plan ends now, with a reason. Nothing is deleted. */
  async revoke(id: string, adminId: string, input: { reason: string }) {
    await this.assertApprover(adminId);
    const reason = input.reason.trim();
    if (reason.length < 3) throw Errors.validation("Give a reason (at least 3 characters).");
    const request = await prismaUnscoped.planPaymentRequest.findUnique({ where: { id }, include: { owner: { select: { email: true } } } });
    if (!request) throw Errors.notFound("Payment request");
    if (request.status !== "approved") throw Errors.conflict("Only an approved payment can be revoked.");
    const done = await prismaUnscoped.$transaction(async (tx) => {
      const changed = await tx.planPaymentRequest.updateMany({ where: { id, status: "approved" }, data: { status: "revoked", decisionReason: reason.slice(0, 300) } });
      if (changed.count === 0) return false;
      await endPlan(tx, { tenantId: request.tenantId, requestId: id, actor: { kind: "approver", userId: adminId }, action: "plan_revoked", details: { reason: reason.slice(0, 300), transactionId: request.transactionId } });
      return true;
    });
    if (!done) return { status: "revoked", alreadyDecided: true };
    await emailOwnerRevoked(request.owner.email, { referenceCode: request.referenceCode, reason, requestId: id });
    return { status: "revoked", alreadyDecided: false };
  },

  async changeOwnerCurrency(ownerId: string, adminId: string, input: { currency: string; reason: string }) {
    await this.assertApprover(adminId);
    return { currency: await adminChangeBillingCurrency(ownerId, input.currency, { kind: "approver", userId: adminId }, input.reason) };
  },

  configuredCurrencies: () => billingCurrencies(settings()),
};

async function checkToken(token: string, requestId: string, adminEmail: string) {
  const row = await prismaUnscoped.planReviewToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.requestId !== requestId) throw Errors.forbidden("This review link is not for this request.");
  if (row.email !== adminEmail) throw Errors.forbidden("This review link was sent to another approver.");
  if (row.usedAt) throw Errors.forbidden("This review link has already been used.");
  if (row.expiresAt < new Date()) throw Errors.forbidden("This review link has expired. Open the request from the approval queue instead.");
}

function alreadyDecided(r: { status: string; decidedAt: Date | null }) {
  return { status: r.status, alreadyDecided: true, decidedAt: r.decidedAt };
}

type AdminRow = Prisma.PlanPaymentRequestGetPayload<{ include: { tenant: { select: { name: true } }; owner: { select: { email: true } } } }>;
function adminView(r: AdminRow) {
  return {
    id: r.id,
    storeId: r.tenantId,
    storeName: r.tenant.name,
    ownerEmail: r.owner.email,
    plan: r.plan,
    amountMinor: r.amountMinor,
    currency: r.currency,
    referenceCode: r.referenceCode,
    transactionId: r.transactionId,
    status: r.status,
    aiStatus: r.aiStatus,
    findings: r.findings,
    submittedAt: r.submittedAt,
    provisionalUntil: r.provisionalUntil,
    decidedAt: r.decidedAt,
    decidedById: r.decidedById,
    decisionReason: r.decisionReason,
    receivedAmountMinor: r.receivedAmountMinor,
    receivedCurrency: r.receivedCurrency,
    receivedPkrMinor: r.receivedPkrMinor,
    periodEnd: r.periodEnd,
  };
}
