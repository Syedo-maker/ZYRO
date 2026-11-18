/**
 * Retention clean-up (production readiness, 2026-11): deletes data that has stopped being useful and
 * only adds risk if kept. Safe to run daily (for example as a scheduled job).
 *
 *   npm run retention            delete
 *   npm run retention -- --dry   count only
 *
 *   expired sign-in sessions (refresh tokens)        7 days after they expired
 *   password-reset links, used or expired           7 days after they expired
 *
 * Kept on purpose: orders, payments and refunds (a store's sales records); payment proofs (kept with
 * their order; erase a person with customer-data.ts). Handled elsewhere: assistant chat transcripts
 * expire by themselves 90 days after the last message (a MongoDB TTL index); carts expire after
 * CART_TTL_SECONDS in Redis; failed background jobs are kept to the last 200 (npm run queues clean).
 */
import { prismaUnscoped } from "../src/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const dry = process.argv.includes("--dry");
  const cutoff = new Date(Date.now() - 7 * DAY);
  const sessions = { where: { expiresAt: { lt: cutoff } } };
  const resets = { where: { expiresAt: { lt: cutoff } } };
  if (dry) {
    console.log(`Would delete: ${await prismaUnscoped.refreshToken.count(sessions)} expired sessions, ${await prismaUnscoped.passwordResetToken.count(resets)} old password-reset links.`);
    return;
  }
  const s = await prismaUnscoped.refreshToken.deleteMany(sessions);
  const r = await prismaUnscoped.passwordResetToken.deleteMany(resets);
  console.log(`Deleted ${s.count} expired sessions and ${r.count} old password-reset links.`);
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prismaUnscoped.$disconnect());
