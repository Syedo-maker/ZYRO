/**
 * The three prices on their own (the supervisor's product-listing change): the rules the product form
 * and the API check, how the selling price follows from the other two, and the "% off" badge. No
 * database: the model's helpers and the request schema only.
 */
import { Types } from "mongoose";
import { priceOf, salePriceFor } from "../../src/models/Product.model";
import { productInputSchema } from "../../src/modules/products/product.validation";

const d = (n: number) => Types.Decimal128.fromString(String(n));
/** A product as stored after the change: the selling price saved next to the other two. */
const stored = (actual: number, discount?: number) => ({
  actualPrice: d(actual),
  ...(discount !== undefined ? { discountPrice: d(discount) } : {}),
  salePrice: d(salePriceFor(actual, discount)),
});

describe("the price rules", () => {
  const base = { title: "Kettle", stock: 1, categoryId: "c1" };
  const errors = (body: Record<string, unknown>) => {
    const r = productInputSchema.safeParse({ ...base, ...body });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it.each([
    ["an MRP only", { actualPrice: 1000 }],
    ["an MRP and a lower discounted price", { actualPrice: 1000, discountPrice: 800 }],
    ["a discounted price equal to the MRP", { actualPrice: 1000, discountPrice: 1000 }],
    ["no discount, sent as null (an edit that removes one)", { actualPrice: 1000, discountPrice: null }],
    ["paisa amounts", { actualPrice: 999.99, discountPrice: 499.5 }],
    ["the single price older callers send", { price: 750 }],
  ])("accepts %s", (_label, body) => {
    expect(errors(body)).toEqual([]);
  });

  it.each([
    ["no price at all", {}, /^actualPrice: The price is required/],
    ["an MRP of zero", { actualPrice: 0 }, /^actualPrice: The price must be more than zero/],
    ["a negative MRP", { actualPrice: -1 }, /^actualPrice: The price must be more than zero/],
    ["a discounted price of zero", { actualPrice: 1000, discountPrice: 0 }, /^discountPrice: A discounted price must be more than zero/],
    ["a negative discounted price", { actualPrice: 1000, discountPrice: -5 }, /^discountPrice: A discounted price must be more than zero/],
    ["a discounted price above the MRP", { actualPrice: 1000, discountPrice: 1000.01 }, /^discountPrice: The discounted price cannot be more than the actual price/],
    ["a discounted price above an older caller's single price", { price: 500, discountPrice: 600 }, /^discountPrice: The discounted price cannot be more than the actual price/],
    ["a price that is text", { actualPrice: "1000" }, /^actualPrice: /],
  ])("refuses %s", (_label, body, message) => {
    expect(errors(body).some((e) => message.test(e))).toBe(true);
  });
});

describe("the selling price", () => {
  it("is the discounted price when there is one, otherwise the MRP", () => {
    expect(salePriceFor(1000, 800)).toBe(800);
    expect(salePriceFor(1000)).toBe(1000);
    expect(salePriceFor(1000, null)).toBe(1000);
  });

  it("is never above the MRP for anything the rules accept", () => {
    for (const [actual, discount] of [
      [1000, undefined],
      [1000, 1000],
      [1000, 1],
      [0.01, 0.01],
    ] as const) {
      const p = priceOf(stored(actual, discount));
      expect(p.sale).toBeLessThanOrEqual(p.actual);
    }
  });

  it("a product stored before the three prices sells at its one price, with no discount", () => {
    expect(priceOf({ price: d(750) })).toEqual({ actual: 750, discount: null, sale: 750, percentOff: null });
  });
});

describe('the "% off" badge', () => {
  it.each([
    [1000, 800, 20],
    [1000, 500, 50],
    [999, 666, 33], // 33.33 rounds down
    [300, 199, 34], // 33.67 rounds up
    [1000, 995, 1], // exactly 0.5% rounds up to 1
    [1000, 1, 100], // 99.9% rounds to 100
  ])("MRP %d, selling at %d: %d%% off", (actual, discount, percent) => {
    expect(priceOf(stored(actual, discount)).percentOff).toBe(percent);
  });

  it.each([
    ["no discount", 1000, undefined],
    ["a discounted price equal to the MRP", 1000, 1000],
    ["a discount that rounds to 0% (0.4%)", 1000, 996],
  ])("is not shown for %s", (_label, actual, discount) => {
    expect(priceOf(stored(actual, discount)).percentOff).toBeNull();
  });
});
