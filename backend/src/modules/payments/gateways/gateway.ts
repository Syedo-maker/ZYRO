/**
 * The seam a local payment gateway plugs into (Part E). JazzCash, Easypaisa, Safepay and XPay all
 * work the same way from our side: send the shopper to the provider with an amount and a reference,
 * then wait to be told, in a signed message, whether it was paid. One interface covers that, so a
 * provider can be added or swapped without touching checkout, orders or the UI.
 *
 * Rules every adapter has to keep, and that `gateway.contract.ts` tests for:
 *
 * 1. **An amount is never taken from the client.** `createPayment` is given the amount the server
 *    priced, in the smallest unit, and must send exactly that.
 * 2. **A redirect back is not a payment.** Only `verifyCallback` may report a payment as paid, and
 *    only after checking the provider's signature over the raw bytes it sent.
 * 3. **A tampered or unsigned message is rejected**, never treated as unpaid-but-fine.
 * 4. **The same notice twice is the same payment.** `providerPaymentId` is stable, so the caller
 *    can make the second notice a no-op.
 * 5. **No card details ever reach us.** The shopper types those on the provider's own page. An
 *    adapter that would receive a card number is the wrong design and would put ZYRO in PCI scope.
 *
 * No real provider adapter ships yet: JazzCash and Easypaisa publish their exact fields, signature
 * formulas and sandbox URLs only to merchants who have an account, and guessing them would mean
 * shipping code that cannot be run against the real thing. `MockGateway` below implements the
 * contract so the whole flow is built and tested now; a real adapter is written against the
 * merchant documents and has to pass the same contract test before it is turned on.
 */

export interface CreateGatewayPaymentParams {
  /** Our own reference, unique per store; comes back in the callback. */
  reference: string;
  tenantId: string;
  /** The amount the server priced, in the currency's smallest unit (paisa for PKR). */
  amountMinor: number;
  currency: string;
  /** Where to send the shopper afterwards. The result of paying is never read from these. */
  returnUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface CreateGatewayPaymentResult {
  /** The provider's own id for this attempt. */
  providerPaymentId: string;
  /** Where to send the shopper: a hosted page, or a wallet deep link. */
  redirectUrl: string;
}

export interface GatewayCallbackResult {
  /** Our reference, read back out of the provider's message. */
  reference: string;
  providerPaymentId: string;
  status: "paid" | "failed" | "pending";
  /** What the provider says was actually taken, in the smallest unit. The caller must check this. */
  amountMinor: number;
  currency: string;
  /** The provider's own reason for a failure, for the payment-failure helper. */
  failureCode?: string;
}

export class GatewaySignatureError extends Error {}

export interface PaymentGateway {
  /** The name stored in PaymentSettings.gatewayProvider. */
  readonly id: string;
  /** Shown to merchants when they pick a gateway. */
  readonly label: string;
  createPayment(params: CreateGatewayPaymentParams): Promise<CreateGatewayPaymentResult>;
  /**
   * Checks the provider's signature over the exact bytes it sent and reports what it says.
   * Must throw `GatewaySignatureError` when the signature is missing, wrong, or does not cover
   * the body. Must never return "paid" for a message it could not verify.
   */
  verifyCallback(rawBody: string, headers: Record<string, string | undefined>): Promise<GatewayCallbackResult>;
}

const registry = new Map<string, PaymentGateway>();

export function registerGateway(gateway: PaymentGateway): void {
  registry.set(gateway.id, gateway);
}

export function getGateway(id: string): PaymentGateway | undefined {
  return registry.get(id);
}

export function listGateways(): { id: string; label: string }[] {
  return [...registry.values()].map((g) => ({ id: g.id, label: g.label }));
}

/**
 * Replaces the registry wholesale (tests use it to prove a provider can be swapped). Pass the
 * shipped list back to restore it; `index.ts` is where the shipped gateways are registered, so this
 * module stays free of any provider's specifics.
 */
export function setGateways(gateways: PaymentGateway[]): void {
  registry.clear();
  for (const g of gateways) registerGateway(g);
}
