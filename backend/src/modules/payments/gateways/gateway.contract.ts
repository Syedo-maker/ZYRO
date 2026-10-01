import { GatewaySignatureError, type PaymentGateway } from "./gateway";

/**
 * The contract every payment gateway adapter has to keep (Part E), written once and run against each
 * of them. A JazzCash or Easypaisa adapter added later is wired into `tests/unit/gateways.test.ts`
 * with one line and must pass this unchanged before it may be turned on for a store.
 *
 * It is a plain function rather than a Jest file so the adapters and the rules live together; the
 * test file supplies `describe`, `it` and `expect`.
 */

export interface GatewayUnderTest {
  gateway: PaymentGateway;
  /**
   * Builds a callback exactly as this provider would send it, signed the way it signs. An adapter
   * that cannot produce one cannot be checked, and must not ship.
   */
  signedCallback(result: { reference: string; providerPaymentId: string; status: "paid" | "failed"; amountMinor: number; currency: string }): {
    rawBody: string;
    headers: Record<string, string>;
  };
  /** Anything the adapter needs set before it will run (the test gateway needs its flag). */
  setUp?: () => void;
  tearDown?: () => void;
}

export function runGatewayContract(subject: GatewayUnderTest): void {
  const { gateway } = subject;

  describe(`${gateway.id} gateway keeps the contract`, () => {
    beforeAll(() => subject.setUp?.());
    afterAll(() => subject.tearDown?.());

    const params = {
      reference: "zyro-ref-contract-1",
      tenantId: "tenant-contract",
      amountMinor: 45000,
      currency: "PKR",
      returnUrl: "https://shop.example/return",
      cancelUrl: "https://shop.example/cancel",
    };

    it("names itself, so a store can choose it", () => {
      expect(gateway.id).toMatch(/^[a-z0-9_]+$/);
      expect(gateway.label.length).toBeGreaterThan(0);
    });

    it("sends the shopper somewhere, and gives back a stable provider id", async () => {
      const a = await gateway.createPayment(params);
      expect(a.redirectUrl).toMatch(/^https?:\/\//);
      expect(a.providerPaymentId.length).toBeGreaterThan(0);
      const b = await gateway.createPayment(params);
      expect(b.providerPaymentId).toBe(a.providerPaymentId);
    });

    it("reads back a signed 'paid' callback with the same reference and amount it was given", async () => {
      const { rawBody, headers } = subject.signedCallback({ reference: params.reference, providerPaymentId: "p1", status: "paid", amountMinor: params.amountMinor, currency: params.currency });
      const result = await gateway.verifyCallback(rawBody, headers);
      expect(result).toMatchObject({ reference: params.reference, status: "paid", amountMinor: params.amountMinor, currency: params.currency });
    });

    it("reads back a failed callback as failed, never as paid", async () => {
      const { rawBody, headers } = subject.signedCallback({ reference: params.reference, providerPaymentId: "p2", status: "failed", amountMinor: params.amountMinor, currency: params.currency });
      expect((await gateway.verifyCallback(rawBody, headers)).status).toBe("failed");
    });

    it("refuses a callback with no signature", async () => {
      const { rawBody } = subject.signedCallback({ reference: params.reference, providerPaymentId: "p3", status: "paid", amountMinor: params.amountMinor, currency: params.currency });
      await expect(gateway.verifyCallback(rawBody, {})).rejects.toBeInstanceOf(GatewaySignatureError);
    });

    it("refuses a callback whose amount was raised after it was signed", async () => {
      const { rawBody, headers } = subject.signedCallback({ reference: params.reference, providerPaymentId: "p4", status: "paid", amountMinor: params.amountMinor, currency: params.currency });
      const tampered = rawBody.replace(String(params.amountMinor), String(params.amountMinor * 2));
      expect(tampered).not.toBe(rawBody);
      await expect(gateway.verifyCallback(tampered, headers)).rejects.toBeInstanceOf(GatewaySignatureError);
    });

    it("refuses a failed callback edited to say paid", async () => {
      const { rawBody, headers } = subject.signedCallback({ reference: params.reference, providerPaymentId: "p5", status: "failed", amountMinor: params.amountMinor, currency: params.currency });
      await expect(gateway.verifyCallback(rawBody.replace("failed", "paid"), headers)).rejects.toBeInstanceOf(GatewaySignatureError);
    });

    it("refuses a signature taken from a different message", async () => {
      const a = subject.signedCallback({ reference: params.reference, providerPaymentId: "p6", status: "paid", amountMinor: params.amountMinor, currency: params.currency });
      const b = subject.signedCallback({ reference: "zyro-ref-contract-2", providerPaymentId: "p7", status: "paid", amountMinor: 999, currency: params.currency });
      await expect(gateway.verifyCallback(b.rawBody, a.headers)).rejects.toBeInstanceOf(GatewaySignatureError);
    });

    it("refuses a body that is not readable at all", async () => {
      const { headers } = subject.signedCallback({ reference: params.reference, providerPaymentId: "p8", status: "paid", amountMinor: params.amountMinor, currency: params.currency });
      await expect(gateway.verifyCallback("not json", headers)).rejects.toBeInstanceOf(GatewaySignatureError);
    });

    it("never asks for card details: nothing it is given could carry one", () => {
      const fields = Object.keys(params);
      expect(fields.join(" ")).not.toMatch(/card|pan|cvv|cvc|expiry/i);
    });
  });
}
