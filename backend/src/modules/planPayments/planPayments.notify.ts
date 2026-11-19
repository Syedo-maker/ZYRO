import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { prismaUnscoped } from "../../lib/prisma";
import { getEmailGateway } from "../../lib/email";
import { formatPrice } from "../../lib/currencies";
import { errorMessage, logger } from "../../lib/logger";
import type { PlanProofFinding } from "./planProof";

/**
 * Emails for plan payments (Pro plan payments, 2026-11). Plain text only, built from the platform's own
 * fields: a store name is stripped of line breaks and cut short, so nothing an owner typed can shape
 * the message. Approvers come from PLAN_APPROVER_EMAILS, never from a request.
 *
 * Each approver gets their own review link: a random token, of which only the SHA-256 hash is kept,
 * valid for a day. The link opens a page that needs the approver's own platform admin login; it never
 * approves or rejects anything itself (mail scanners open links), and there is no reply-to-approve.
 *
 * Sending is best effort: a failure is logged by request id and never undoes the request.
 */

export const REVIEW_LINK_HOURS = 24;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const clean = (value: string, max = 80) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const reviewUrl = (token: string) => `${env.storefrontUrl.replace(/\/+$/, "")}/admin/platform/plan-requests/review?token=${token}`;

async function send(to: string, subject: string, text: string, requestId: string) {
  try {
    await getEmailGateway().send({ to, subject, text });
  } catch (err) {
    logger.warn({ requestId, err: errorMessage(err) }, "plan payment email could not be sent");
  }
}

export interface RequestForEmail {
  id: string;
  referenceCode: string;
  plan: string;
  currency: string;
  amountMinor: number;
  transactionId: string | null;
  aiStatus: string | null;
  findings: unknown;
  storeName: string;
  provisionalUntil?: Date | null;
}

const AI_LINE: Record<string, string> = {
  passed: "every automatic check passed",
  flags: "some automatic checks need a closer look",
  unavailable: "the screenshot could not be read automatically: check it by eye",
};

/** A new review link per approver, then the email. Returns how many approvers were written to. */
export async function emailApprovers(request: RequestForEmail, reminder?: "24 hours" | "48 hours") {
  const findings = Array.isArray(request.findings) ? (request.findings as PlanProofFinding[]) : [];
  const flags = findings.filter((f) => f.severity !== "ok").map((f) => `- ${f.code} (${f.severity})`);
  const subject = `${reminder ? "Reminder: " : ""}Zyro: ${request.plan === "PRO" ? "Pro" : request.plan} plan payment to review (${request.referenceCode})`;
  for (const email of env.planPayments.approverEmails) {
    const token = randomBytes(32).toString("base64url");
    await prismaUnscoped.planReviewToken.create({
      data: { requestId: request.id, email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REVIEW_LINK_HOURS * 3600_000) },
    });
    const text = [
      reminder ? `This payment has been waiting for ${reminder}.` : "A store owner has sent a payment for a plan.",
      "",
      `Store: ${clean(request.storeName)}`,
      `Plan: ${request.plan === "PRO" ? "Pro" : request.plan}`,
      `Amount: ${formatPrice(request.amountMinor / 100, request.currency)} (${request.currency})`,
      `Reference: ${request.referenceCode}`,
      `Transaction ID: ${request.transactionId ?? "none"}`,
      `Automatic check: ${AI_LINE[request.aiStatus ?? "unavailable"] ?? AI_LINE.unavailable}`,
      ...(request.provisionalUntil ? [`Provisional Pro is running until ${request.provisionalUntil.toISOString().replace("T", " ").slice(0, 16)} UTC. Approve to make it the full period, or reject to end it now.`] : []),
      ...(flags.length ? ["", "Needs a look:", ...flags] : []),
      "",
      `Review request: ${reviewUrl(token)}`,
      "",
      `The link works for ${REVIEW_LINK_HOURS} hours and needs your own platform admin sign-in. Opening it does not approve or reject anything: only the button on that page does. Do not forward this email.`,
    ].join("\n");
    await send(email, subject, text, request.id);
  }
  return env.planPayments.approverEmails.length;
}

export async function emailOwnerApproved(to: string, r: { referenceCode: string; amountMinor: number; currency: string; transactionId: string | null; periodEnd: Date; requestId: string }) {
  await send(
    to,
    `Zyro: your Pro plan is active (${r.referenceCode})`,
    [
      "Thank you. Your payment was confirmed and your store is on the Pro plan.",
      "",
      `Paid: ${formatPrice(r.amountMinor / 100, r.currency)} (${r.currency})`,
      `Reference: ${r.referenceCode}`,
      `Transaction ID: ${r.transactionId ?? "none"}`,
      `Pro until: ${r.periodEnd.toISOString().slice(0, 10)}`,
      "",
      "Keep this email as your receipt.",
    ].join("\n"),
    r.requestId,
  );
}

export async function emailOwnerRejected(to: string, r: { referenceCode: string; reason: string; requestId: string; provisionalEnded?: boolean }) {
  await send(
    to,
    `Zyro: your plan payment could not be confirmed (${r.referenceCode})`,
    [
      r.provisionalEnded
        ? "We could not confirm your payment, so your provisional Pro has ended and your store is back on the Free plan. Nothing in your store was deleted."
        : "We could not confirm your payment, so your plan was not changed.",
      "",
      `Reference: ${r.referenceCode}`,
      `Reason: ${clean(r.reason, 300)}`,
      "",
      env.planPayments.refundInstructions,
    ].join("\n"),
    r.requestId,
  );
}

export async function emailOwnerRevoked(to: string, r: { referenceCode: string; reason: string; requestId: string }) {
  await send(
    to,
    `Zyro: your Pro plan was ended (${r.referenceCode})`,
    ["Your store is back on the Free plan. Nothing in your store was deleted.", "", `Reference: ${r.referenceCode}`, `Reason: ${clean(r.reason, 300)}`, "", env.planPayments.refundInstructions].join("\n"),
    r.requestId,
  );
}

/** Plain notices to an owner (plan ending soon, plan ended, provisional plan ended). */
export async function emailOwnerNotice(to: string, subject: string, lines: string[], requestId: string) {
  await send(to, subject, lines.join("\n"), requestId);
}
