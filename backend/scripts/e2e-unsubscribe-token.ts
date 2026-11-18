/**
 * For browser tests only (frontend/e2e/production-pages.e2e.mjs): prints the signed unsubscribe token
 * for a shop and an account, made with this machine's settings, as the e2e server would make it.
 * It prints a token (a signature), never a secret.
 *
 *   npx tsx scripts/e2e-unsubscribe-token.ts <storeId> <userId>
 */
import { unsubscribeToken } from "../src/modules/cart-recovery/unsubscribe.service";

const [storeId, userId] = process.argv.slice(2);
if (!/^[a-z0-9]{10,40}$/.test(storeId ?? "") || !/^[a-z0-9]{10,40}$/.test(userId ?? "")) {
  console.error("Usage: npx tsx scripts/e2e-unsubscribe-token.ts <storeId> <userId>");
  process.exit(1);
}
process.stdout.write(unsubscribeToken(storeId, userId));
