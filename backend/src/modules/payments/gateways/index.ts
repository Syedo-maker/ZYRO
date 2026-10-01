/**
 * The gateways ZYRO ships with (Part E). Adding a provider is one import and one line here, plus an
 * adapter that passes `gateway.contract.ts`; nothing else in the app changes.
 */
import { registerGateway, setGateways, type PaymentGateway } from "./gateway";
import { mockGateway } from "./mock.gateway";

export const SHIPPED_GATEWAYS: PaymentGateway[] = [mockGateway];

for (const g of SHIPPED_GATEWAYS) registerGateway(g);

/** Puts the shipped list back after a test has swapped it out. */
export function restoreGateways(): void {
  setGateways(SHIPPED_GATEWAYS);
}

export * from "./gateway";
