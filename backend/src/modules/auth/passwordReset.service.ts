import crypto from "node:crypto";
import { prismaUnscoped } from "../../lib/prisma";
import { password as passwordLib } from "../../lib/password";
import { emailStatus, getEmailGateway } from "../../lib/email";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { Errors } from "../../errors/AppError";

/**
 * Forgot and reset password (B1, 2026-11), for every kind of account (owner, staff and shopper all sign
 * in as a User; which stores they may then act in is worked out per request, as before).
 *
 * - The link carries a random 32-byte token; only its SHA-256 hash is stored.
 * - It works for 30 minutes and once. Asking for a new link retires every older unused one.
 * - A successful reset ends every session (all refresh tokens), so whoever had the old password is
 *   signed out at their next refresh.
 * - Asking for a link answers the same, in the same time, whether or not the email is registered; the
 *   email is sent after the response, so its delay cannot tell them apart either.
 * - The link always points at the configured web address (STOREFRONT_URL), never at a request header.
 */

export const RESET_TTL_MS = 30 * 60 * 1000;
const TOKEN_BYTES = 32;

/** What anyone asking for a link is told, registered or not. */
export const RESET_REQUESTED_MESSAGE = "If this email is registered, we sent a reset link. It works for 30 minutes.";
/** What a wrong, used or expired link is told: one message, so a link's state is not revealed. */
export const RESET_INVALID_MESSAGE = "This reset link is invalid or has expired. Ask for a new one.";

const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

/** A store id from the page the request came from, so the link can bring a shopper back to that store's sign-in. */
const STORE_ID = /^[a-z0-9]{10,40}$/;

function resetLink(rawToken: string, storeId?: string): string {
  const base = env.storefrontUrl.replace(/\/+$/, "");
  const store = storeId && STORE_ID.test(storeId) ? `&store=${storeId}` : "";
  return `${base}/reset-password?token=${rawToken}${store}`;
}

async function deliver(to: string, link: string): Promise<void> {
  const status = emailStatus();
  if (!status.configured) {
    // Never in production: there the link must only ever reach the inbox it was sent to.
    if (!env.isProduction) logger.warn(`[password reset] email is not set up (missing ${status.missing.join(", ")}); development link for ${to}: ${link}`);
    else logger.error({ missing: status.missing }, "[password reset] email is not set up, so a reset link could not be sent");
    return;
  }
  await getEmailGateway().send({
    to,
    subject: "Reset your ZYRO password",
    text:
      `Someone asked to reset the password for this email on ZYRO.\n\n` +
      `To choose a new password, open this link within 30 minutes:\n${link}\n\n` +
      `If it was not you, ignore this email: your password stays the same.`,
  });
}

export const passwordResetService = {
  /**
   * Starts a reset. Returns nothing the caller can use to tell whether the email is registered: the work
   * that differs (the token and the email) happens in the background, after the response.
   */
  async request(email: string, storeId?: string): Promise<void> {
    // Matched exactly as login matches it (auth.service.ts), so the account found is the one that signs in.
    const user = await prismaUnscoped.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) return;
    void (async () => {
      const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
      const now = new Date();
      await prismaUnscoped.$transaction([
        // Older unused links stop working the moment a new one is asked for.
        prismaUnscoped.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
        prismaUnscoped.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(raw), createdAt: now, expiresAt: new Date(now.getTime() + RESET_TTL_MS) } }),
      ]);
      await deliver(user.email, resetLink(raw, storeId));
    })().catch((err: Error) => logger.error({ err: err.message }, "[password reset] could not create or send a reset link"));
  },

  /** Sets the new password if the link is valid, unused and unexpired, then ends every session. */
  async reset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const token = await prismaUnscoped.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!token) throw Errors.validation(RESET_INVALID_MESSAGE);
    const passwordHash = await passwordLib.hash(newPassword);
    await prismaUnscoped.$transaction(async (tx) => {
      // Claiming the link and checking it are one statement, so two uses at once cannot both succeed.
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count === 0) throw Errors.validation(RESET_INVALID_MESSAGE);
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({ where: { userId: token.userId, usedAt: null }, data: { usedAt: now } });
      await tx.refreshToken.deleteMany({ where: { userId: token.userId } }); // every session ends
    });
  },
};
