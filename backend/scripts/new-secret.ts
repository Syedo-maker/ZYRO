/**
 * A new random value for one of Zyro's secrets, and what rotating it does (production readiness,
 * 2026-11). Paste the value into the platform's secret store (never into a file in the repository),
 * then restart the API and the worker.
 *
 *   npm run new-secret -- JWT_ACCESS_SECRET
 *
 * The value goes to stdout only; nothing is stored or logged.
 */
import { randomBytes } from "node:crypto";

const SECRETS: Record<string, string> = {
  JWT_ACCESS_SECRET:
    "Signs sign-in tokens. After the change, current access tokens stop working at once; browsers get a new one silently from their refresh token (stored in the database, not signed with this), so nobody has to sign in again.",
  FILE_SIGNING_SECRET:
    "Signs short-lived links to private files on the local storage driver. Links already handed out stop working; new ones work. (Not used with Azure storage.)",
  COD_PHONE_PEPPER:
    "Mixed into the shared cash-on-delivery phone hashes. CAUTION: after a change, past delivery outcomes no longer match any phone, so every number starts with a clean history. Set it once before launch and rotate only if it leaked.",
  RECOMMENDATION_SERVICE_TOKEN:
    "Shared between the API and the recommendation service. Change it in both at the same time; in between, recommendations are empty (the store keeps working).",
  METRICS_TOKEN: "Lets the metrics collector read /metrics. Update the collector's configuration at the same time.",
  GATEWAY_MOCK_SECRET: "Signs the test payment gateway's callbacks (tests only).",
};

const name = process.argv[2];
if (!name || !SECRETS[name]) {
  console.error(`Name one of: ${Object.keys(SECRETS).join(", ")}.\nProvider keys (Stripe, Anthropic, email, storage) are rotated in each provider's own dashboard.`);
  process.exit(1);
}
console.error(`${name}: ${SECRETS[name]}\n`);
process.stdout.write(randomBytes(48).toString("base64url") + "\n");
