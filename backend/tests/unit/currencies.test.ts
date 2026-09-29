/** Unit tests for the currencies a store can sell in (backend/src/lib/currencies.ts). */
import { STORE_CURRENCIES, STORE_CURRENCY_CODES, minChargeMinor } from "../../src/lib/currencies";

describe("the currency list", () => {
  it("offers the currencies the merchants asked for: rupees (PKR, INR), dollars, pounds and euros", () => {
    expect(STORE_CURRENCY_CODES).toEqual(expect.arrayContaining(["PKR", "INR", "USD", "GBP", "EUR"]));
  });

  it("every entry is a distinct three-letter code that Intl knows, and can show hundredths when asked", () => {
    // Intl displays PKR without decimals by convention, but the currency itself (ISO 4217, and Stripe)
    // has two, so amounts are still kept in paisa; the display shows them whenever a price has any.
    expect(new Set(STORE_CURRENCY_CODES).size).toBe(STORE_CURRENCY_CODES.length);
    for (const { code } of STORE_CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect(new Intl.NumberFormat("en", { style: "currency", currency: code, minimumFractionDigits: 2 }).format(99.5)).toMatch(/99\.50/);
    }
  });

  it("every minimum is a positive whole number of hundredths", () => {
    for (const c of STORE_CURRENCIES) expect(Number.isInteger(c.minChargeMinor) && c.minChargeMinor > 0).toBe(true);
  });
});

describe("minChargeMinor", () => {
  it("is Stripe's 0.50 for US dollars, and a round rupee amount for PKR", () => {
    expect(minChargeMinor("USD")).toBe(50);
    expect(minChargeMinor("PKR")).toBe(20000);
  });

  it("ignores letter case", () => {
    expect(minChargeMinor("inr")).toBe(minChargeMinor("INR"));
  });

  it("an unknown code gets the highest floor, never a floor too low for Stripe", () => {
    expect(minChargeMinor("XYZ")).toBe(Math.max(...STORE_CURRENCIES.map((c) => c.minChargeMinor)));
  });
});
