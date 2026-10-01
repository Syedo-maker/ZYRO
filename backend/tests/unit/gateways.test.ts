/**
 * Every payment gateway adapter, held to the same contract (Part E). A JazzCash or Easypaisa
 * adapter added later is one entry in `SUBJECTS` and must pass this file unchanged before it may be
 * turned on for a store; that is the whole point of `gateway.contract.ts` being a shared function.
 */
import { runGatewayContract, type GatewayUnderTest } from "../../src/modules/payments/gateways/gateway.contract";
import { mockGateway, signMockCallback } from "../../src/modules/payments/gateways/mock.gateway";
import { getGateway, listGateways, setGateways, GatewaySignatureError } from "../../src/modules/payments/gateways";
import { SHIPPED_GATEWAYS, restoreGateways } from "../../src/modules/payments/gateways/index";

const SUBJECTS: GatewayUnderTest[] = [
  {
    gateway: mockGateway,
    setUp: () => {
      process.env.GATEWAY_MOCK_ENABLED = "true";
    },
    tearDown: () => {
      delete process.env.GATEWAY_MOCK_ENABLED;
    },
    signedCallback(result) {
      const rawBody = JSON.stringify(result);
      return { rawBody, headers: { "x-mock-signature": signMockCallback(rawBody) } };
    },
  },
];

for (const subject of SUBJECTS) runGatewayContract(subject);

describe("the gateway registry", () => {
  afterEach(() => restoreGateways());

  it("ships the test gateway, and finds it by the name a store would store", () => {
    expect(listGateways().map((g) => g.id)).toEqual(SHIPPED_GATEWAYS.map((g) => g.id));
    expect(getGateway("mock")).toBe(mockGateway);
  });

  it("an unknown provider name gives nothing back, rather than a wrong gateway", () => {
    expect(getGateway("jazzcash")).toBeUndefined();
  });

  it("a provider can be swapped in without touching anything else", () => {
    const fake = { ...mockGateway, id: "jazzcash", label: "JazzCash" };
    setGateways([fake]);
    expect(listGateways()).toEqual([{ id: "jazzcash", label: "JazzCash" }]);
    expect(getGateway("mock")).toBeUndefined();
  });
});

describe("the test gateway cannot be left on by accident", () => {
  it("refuses to take a payment unless the server is explicitly in test mode", async () => {
    delete process.env.GATEWAY_MOCK_ENABLED;
    await expect(
      mockGateway.createPayment({ reference: "r", tenantId: "t", amountMinor: 100, currency: "PKR", returnUrl: "https://a.test/r", cancelUrl: "https://a.test/c" })
    ).rejects.toThrow(/GATEWAY_MOCK_ENABLED/);
  });

  it("still refuses a forged callback even in test mode, so the signing is real", async () => {
    await expect(mockGateway.verifyCallback('{"reference":"r"}', { "x-mock-signature": "deadbeef" })).rejects.toBeInstanceOf(GatewaySignatureError);
  });
});
