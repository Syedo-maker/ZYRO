/**
 * The three prices on their own (the supervisor's product-listing change, discount modes 2026-10-23):
 * the selling price as MRP minus a discount given as an amount (Rs off) or a percentage, the Rs / %
 * conversion the form's switch uses, the rules the API checks, products stored in older shapes, and
 * the MRP and discount an order line keeps. No database.
 *
 * frontend/tests/prices.test.ts checks the form's copy of the calculation with the same cases.
 */
import { Types } from "mongoose";
import { computePrices, convertDiscount, priceProblem, type Discount } from "../../src/lib/prices";
import { priceOf } from "../../src/models/Product.model";
import { productInputSchema, discountFromInput } from "../../src/modules/products/product.validation";
import { priceSnapshot } from "../../src/modules/commerce/order.service";

const d = (n: number) => Types.Decimal128.fromString(String(n));
const amount = (value: number): Discount => ({ type: "amount", value });
const percent = (value: number): Discount => ({ type: "percent", value });

describe("the selling price: MRP minus the discount", () => {
  it.each([
    // [MRP, discount, discount taken off, selling price]
    [1000, null, 0, 1000],
    [1000, amount(200), 200, 800],
    [999.99, amount(0.99), 0.99, 999],
    [1000, amount(199.999), 200, 800], // amounts are rounded to the hundredth
    [1000, percent(15), 150, 850],
    [450, percent(12.5), 56.25, 393.75],
    [999, percent(33.33), 332.97, 666.03], // the percentage's amount is rounded to the hundredth first
    [100, percent(33.333), 33.33, 66.67], // percentages are kept to two places
    [0.05, percent(50), 0.03, 0.02], // half a hundredth rounds up
  ] as const)("MRP %d with %j: %d off, customers pay %d", (mrp, discount, off, sale) => {
    const p = computePrices(mrp, discount);
    expect(p.discountAmount).toBe(off);
    expect(p.sale).toBe(sale);
    // The three always add up exactly.
    expect(Math.round(p.actual * 100) - Math.round(p.discountAmount * 100)).toBe(Math.round(p.sale * 100));
  });

  it("a discount of zero, in either mode, is no discount", () => {
    expect(computePrices(1000, amount(0))).toEqual({ actual: 1000, discount: null, discountAmount: 0, sale: 1000 });
    expect(computePrices(1000, percent(0))).toEqual({ actual: 1000, discount: null, discountAmount: 0, sale: 1000 });
  });

  it("keeps the discount as set, rounded", () => {
    expect(computePrices(1000, percent(33.333)).discount).toEqual(percent(33.33));
    expect(computePrices(1000, amount(199.999)).discount).toEqual(amount(200));
  });
});

describe("the rules", () => {
  it.each([
    ["no discount", 1000, null],
    ["an amount just under the MRP", 1000, amount(999.99)],
    ["a percentage just under 100%", 1000, percent(99.99)],
    ["a discount of zero", 1000, amount(0)],
  ] as const)("accepts %s", (_label, mrp, discount) => {
    expect(priceProblem(mrp, discount)).toBeNull();
  });

  it.each([
    ["an MRP of zero", 0, null, "The price (MRP) must be more than zero"],
    ["a negative MRP", -5, null, "The price (MRP) must be more than zero"],
    ["an MRP under a hundredth", 0.004, null, "The price (MRP) must be more than zero"],
    ["a negative amount", 1000, amount(-1), "The discount cannot be below zero"],
    ["a negative percentage", 1000, percent(-1), "The discount cannot be below zero"],
    ["an amount equal to the MRP", 1000, amount(1000), "The discount must be less than the price (MRP)"],
    ["an amount above the MRP", 1000, amount(1200), "The discount must be less than the price (MRP)"],
    ["100%", 1000, percent(100), "A percentage discount must be less than 100%"],
    ["a percentage that rounds to 100%", 1000, percent(99.999), "The selling price must stay above zero"],
    ["a percentage that leaves less than a hundredth", 0.01, percent(50), "The selling price must stay above zero"],
  ] as const)("refuses %s", (_label, mrp, discount, message) => {
    expect(priceProblem(mrp, discount)).toBe(message);
  });
});

describe("switching between Rs and %", () => {
  it.each([
    // [MRP, from, to, value in the new mode]
    [1000, amount(200), "percent", 20],
    [1000, percent(20), "amount", 200],
    [999, amount(333), "percent", 33.33],
    [999, percent(33.33), "amount", 332.97],
    [450, percent(12.5), "amount", 56.25],
    [1000, amount(999.99), "percent", 99.99], // never rounds up to 100%, which would be refused
    [1000, amount(0), "percent", 0],
  ] as const)("MRP %d: %j becomes %s %d", (mrp, from, to, value) => {
    expect(convertDiscount(mrp, from, to)).toBe(value);
  });

  it("converts without losing the discount: the selling price stays within a hundredth or two", () => {
    for (const [mrp, from] of [
      [1000, amount(200)],
      [999, amount(333)],
      [1234.56, amount(100)],
      [450, percent(12.5)],
      [79.99, percent(15)],
    ] as const) {
      const to = from.type === "amount" ? "percent" : "amount";
      const converted: Discount = { type: to, value: convertDiscount(mrp, from, to) };
      expect(priceProblem(mrp, converted)).toBeNull();
      expect(Math.abs(computePrices(mrp, converted).sale - computePrices(mrp, from).sale)).toBeLessThanOrEqual(0.06);
    }
  });

  it("an amount that is a whole percentage converts exactly, there and back", () => {
    const pct = convertDiscount(1000, amount(250), "percent");
    expect(pct).toBe(25);
    expect(convertDiscount(1000, percent(pct), "amount")).toBe(250);
  });
});

describe("the request rules", () => {
  const base = { title: "Kettle", stock: 1, categoryId: "c1" };
  const errors = (body: Record<string, unknown>) => {
    const r = productInputSchema.safeParse({ ...base, ...body });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it.each([
    ["an MRP only", { actualPrice: 1000 }],
    ["an amount off", { actualPrice: 1000, discountType: "amount", discountValue: 200 }],
    ["a percentage off", { actualPrice: 1000, discountType: "percent", discountValue: 15 }],
    ["no discount, sent as nulls (an edit that removes one)", { actualPrice: 1000, discountType: null, discountValue: null }],
    ["a discount of zero", { actualPrice: 1000, discountType: "percent", discountValue: 0 }],
    ["an older caller's discounted price", { actualPrice: 1000, discountPrice: 800 }],
    ["an older caller's single price", { price: 750 }],
  ])("accepts %s", (_label, body) => {
    expect(errors(body)).toEqual([]);
  });

  it.each([
    ["no price at all", {}, /^actualPrice: The price is required/],
    ["an MRP of zero", { actualPrice: 0 }, /^actualPrice: The price must be more than zero/],
    ["a negative discount", { actualPrice: 1000, discountType: "amount", discountValue: -1 }, /^discountValue: The discount cannot be below zero/],
    ["an amount as large as the MRP", { actualPrice: 1000, discountType: "amount", discountValue: 1000 }, /^discountValue: The discount must be less than the price \(MRP\)/],
    ["100%", { actualPrice: 1000, discountType: "percent", discountValue: 100 }, /^discountValue: A percentage discount must be less than 100%/],
    ["a selling price of zero", { actualPrice: 0.01, discountType: "percent", discountValue: 50 }, /^discountValue: The selling price must stay above zero/],
    ["a value without its type", { actualPrice: 1000, discountValue: 200 }, /^discountType: Say whether the discount is an amount or a percentage/],
    ["a type without its value", { actualPrice: 1000, discountType: "amount" }, /^discountValue: Give the discount/],
    ["an unknown type", { actualPrice: 1000, discountType: "bogo", discountValue: 1 }, /^discountType: /],
    ["both a discounted price and a type", { actualPrice: 1000, discountPrice: 800, discountType: "amount", discountValue: 200 }, /^discountPrice: Send the discount either/],
    ["an older caller's discounted price above the MRP", { actualPrice: 1000, discountPrice: 1200 }, /^discountPrice: The discounted price cannot be more than the actual price/],
  ])("refuses %s", (_label, body, message) => {
    expect(errors(body).some((e) => message.test(e))).toBe(true);
  });

  it("reads an older caller's discounted price as an amount off", () => {
    expect(discountFromInput({ actualPrice: 1000, discountPrice: 800 })).toEqual(amount(200));
    expect(discountFromInput({ actualPrice: 1000, discountPrice: 1000 })).toBeNull();
  });
});

describe("products in every stored shape", () => {
  it("an amount off: the badge says Rs off", () => {
    const p = priceOf({ actualPrice: d(1000), discountType: "amount", discountValue: d(200), salePrice: d(800) });
    expect(p).toEqual({ actual: 1000, discount: amount(200), discountAmount: 200, sale: 800, percentOff: 20 });
  });

  it("a percentage off: the badge says % off", () => {
    const p = priceOf({ actualPrice: d(999), discountType: "percent", discountValue: d(33.33), salePrice: d(666.03) });
    expect(p).toEqual({ actual: 999, discount: percent(33.33), discountAmount: 332.97, sale: 666.03, percentOff: 33 });
  });

  it("no discount", () => {
    expect(priceOf({ actualPrice: d(1000), salePrice: d(1000) })).toEqual({ actual: 1000, discount: null, discountAmount: 0, sale: 1000, percentOff: null });
  });

  it("an old product with a single price is the MRP, with no discount", () => {
    expect(priceOf({ price: d(750) })).toEqual({ actual: 750, discount: null, discountAmount: 0, sale: 750, percentOff: null });
  });

  it("a product saved with the discounted price from before the discount modes is an amount off", () => {
    expect(priceOf({ actualPrice: d(1000), discountPrice: d(850), salePrice: d(850) })).toEqual({ actual: 1000, discount: amount(150), discountAmount: 150, sale: 850, percentOff: 15 });
  });

  it.each([
    [1000, 995, 1], // exactly 0.5% rounds up to 1
    [1000, 996, null], // 0.4% shows no percentage
    [300, 199, 34], // 33.67 rounds up
  ])("the whole percent off for MRP %d selling at %d is %s", (actual, sale, pct) => {
    expect(priceOf({ actualPrice: d(actual), discountType: "amount", discountValue: d(actual - sale), salePrice: d(sale) }).percentOff).toBe(pct);
  });
});

describe("what an order line keeps", () => {
  it("the MRP and the discount per unit beside the price paid", () => {
    expect(priceSnapshot({ unitPrice: 800, unitMrp: 1000 })).toEqual({ unitMrpSnapshot: "1000.00", unitDiscountSnapshot: "200.00" });
    expect(priceSnapshot({ unitPrice: 666.03, unitMrp: 999 })).toEqual({ unitMrpSnapshot: "999.00", unitDiscountSnapshot: "332.97" });
  });

  it("no discount when there was none", () => {
    expect(priceSnapshot({ unitPrice: 450, unitMrp: 450 })).toEqual({ unitMrpSnapshot: "450.00", unitDiscountSnapshot: "0.00" });
  });

  it("a checkout priced before the change, with no MRP, records the price paid as the MRP", () => {
    expect(priceSnapshot({ unitPrice: 450 })).toEqual({ unitMrpSnapshot: "450.00", unitDiscountSnapshot: "0.00" });
  });
});
