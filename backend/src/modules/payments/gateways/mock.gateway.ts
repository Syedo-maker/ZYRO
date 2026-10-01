import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env";
import { GatewaySignatureError, type PaymentGateway } from "./gateway";

/**
 * A working gateway that behaves like a real one, for building and testing the whole local-payment
 * flow before a merchant account exists (Part E). It is not a pretend object: it signs its callbacks
 * with HMAC-SHA256 the way JazzCash and Easypaisa sign theirs, and it rejects an unsigned or altered
 * message, so the code around it is exercised for real rather than skipped.
 *
 * What it does not do is move money. Its "hosted page" is a page ZYRO serves, and `GATEWAY_MOCK_SECRET`
 * stands in for a merchant's integrity salt. It is therefore refused unless the server is explicitly
 * in test mode (`GATEWAY_MOCK_ENABLED=true`), so it can never be left on in front of real shoppers.
 *
 * A real adapter (jazzcash.gateway.ts, easypaisa.gateway.ts) is written from the merchant integration
 * documents, which give the exact field names, the hash formula and the sandbox URLs. Those are issued
 * only to merchants with an account, so they are not guessed here; the adapter has to pass
 * `gateway.contract.ts`, the same test this one passes, before it is turned on.
 */

const SECRET = () => process.env.GATEWAY_MOCK_SECRET ?? "zyro-mock-gateway-secret";

export function signMockCallback(rawBody: string): string {
  return createHmac("sha256", SECRET()).update(rawBody, "utf8").digest("hex");
}

function verify(rawBody: string, signature: string | undefined): void {
  if (!signature) throw new GatewaySignatureError("The callback has no signature header");
  const expected = Buffer.from(signMockCallback(rawBody), "utf8");
  const given = Buffer.from(signature, "utf8");
  // Compared in constant time, and only after the lengths match, so the comparison itself leaks nothing.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new GatewaySignatureError("The callback signature does not match its body");
  }
}

export const mockGateway: PaymentGateway = {
  id: "mock",
  label: "Test gateway (no real money)",

  async createPayment(params) {
    if (process.env.GATEWAY_MOCK_ENABLED !== "true") {
      throw new Error("The test gateway is only available when GATEWAY_MOCK_ENABLED=true");
    }
    const providerPaymentId = `mockpay_${params.reference}`;
    // The amount the server priced travels in the link; it is never read back from the browser.
    const url = new URL(`${env.publicUrl}/__mock-gateway/pay`);
    url.searchParams.set("reference", params.reference);
    url.searchParams.set("amount", String(params.amountMinor));
    url.searchParams.set("currency", params.currency);
    url.searchParams.set("providerPaymentId", providerPaymentId);
    url.searchParams.set("returnUrl", params.returnUrl);
    return { providerPaymentId, redirectUrl: url.toString() };
  },

  async verifyCallback(rawBody, headers) {
    verify(rawBody, headers["x-mock-signature"]);
    let body: { reference?: string; providerPaymentId?: string; status?: string; amountMinor?: number; currency?: string; failureCode?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new GatewaySignatureError("The callback body is not readable");
    }
    if (!body.reference || !body.providerPaymentId || typeof body.amountMinor !== "number" || !body.currency) {
      throw new GatewaySignatureError("The callback is missing fields the gateway always sends");
    }
    const status = body.status === "paid" ? "paid" : body.status === "pending" ? "pending" : "failed";
    return {
      reference: body.reference,
      providerPaymentId: body.providerPaymentId,
      status,
      amountMinor: body.amountMinor,
      currency: body.currency.toUpperCase(),
      ...(body.failureCode ? { failureCode: body.failureCode } : {}),
    };
  },
};
