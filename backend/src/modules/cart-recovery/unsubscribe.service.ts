import crypto from "node:crypto";
import { env } from "../../config/env";
import { prismaUnscoped } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";

/**
 * Unsubscribing from a shop's cart reminders (production readiness, 2026-11).
 *
 * Every reminder carries a link, and a List-Unsubscribe header so the email app can show its own
 * one-click button (RFC 8058). The link names the shop and the account, never the email address,
 * and is signed so nobody can unsubscribe someone else by guessing. It does not expire: an
 * unsubscribe link must keep working. Changing JWT_ACCESS_SECRET makes old links stop working, so the
 * page then tells the shopper to reply to the email instead.
 *
 * Opening the link only shows a page; the shopper presses a button to unsubscribe, so a mail
 * scanner that follows every link does not unsubscribe anyone by itself. The email app's one-click
 * button sends a POST, which unsubscribes at once.
 */

const ID = /^[a-z0-9]{10,40}$/;

function signature(storeId: string, userId: string): string {
  // A key of its own, derived from the server secret, so this signature is never valid as anything else.
  const key = crypto.createHmac("sha256", env.jwt.accessSecret).update("zyro:unsubscribe:v1").digest();
  return crypto.createHmac("sha256", key).update(`${storeId}:${userId}`).digest("base64url").slice(0, 32);
}

export function unsubscribeToken(storeId: string, userId: string): string {
  return `${storeId}.${userId}.${signature(storeId, userId)}`;
}

/** The page a reminder links to, and the address the email app's own unsubscribe button posts to. */
export function unsubscribeLinks(storeId: string, userId: string) {
  const t = unsubscribeToken(storeId, userId);
  const base = env.storefrontUrl.replace(/\/+$/, "");
  return { page: `${base}/unsubscribe?t=${t}`, oneClick: `${base}/api/v1/unsubscribe?t=${t}` };
}

const INVALID = "This unsubscribe link is not valid. To stop the emails, reply to one and ask the shop.";

function readToken(raw: unknown): { storeId: string; userId: string } {
  const parts = typeof raw === "string" ? raw.split(".") : [];
  if (parts.length !== 3 || !ID.test(parts[0]) || !ID.test(parts[1])) throw Errors.validation(INVALID);
  const [storeId, userId, given] = parts;
  const expected = Buffer.from(signature(storeId, userId));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw Errors.validation(INVALID);
  return { storeId, userId };
}

async function storeName(storeId: string) {
  const store = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { name: true } });
  if (!store) throw Errors.notFound("Store");
  return store.name;
}

export const unsubscribeService = {
  /** What the page shows: which shop, and whether this person is already unsubscribed from it. */
  async status(token: unknown) {
    const { storeId, userId } = readToken(token);
    const name = await storeName(storeId);
    const row = await prismaUnscoped.emailOptOut.findFirst({ where: { tenantId: storeId, userId }, select: { userId: true } });
    return { storeName: name, unsubscribed: Boolean(row) };
  },

  async unsubscribe(token: unknown) {
    const { storeId, userId } = readToken(token);
    const name = await storeName(storeId);
    // The account may have been deleted since the email was sent: then there is nothing left to email.
    const user = await prismaUnscoped.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (user) await prismaUnscoped.emailOptOut.createMany({ data: [{ tenantId: storeId, userId }], skipDuplicates: true });
    return { storeName: name, unsubscribed: true };
  },

  /** "Changed your mind?": the same link turns the reminders back on. */
  async resubscribe(token: unknown) {
    const { storeId, userId } = readToken(token);
    const name = await storeName(storeId);
    await prismaUnscoped.emailOptOut.deleteMany({ where: { tenantId: storeId, userId } });
    return { storeName: name, unsubscribed: false };
  },

  async isOptedOut(storeId: string, userId: string) {
    return Boolean(await prismaUnscoped.emailOptOut.findFirst({ where: { tenantId: storeId, userId }, select: { userId: true } }));
  },
};
