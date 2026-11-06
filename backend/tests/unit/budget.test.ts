/** Unit tests for the shopper's budget (backend/src/lib/budget.ts), shared by the assistant's answer and its product cards. */
import { parseBudget, withinBudget } from "../../src/lib/budget";

describe("reading a budget from what the shopper typed", () => {
  it.each([
    ["Something for a winter gift under Rs 3000?", 3000],
    ["anything below rs. 2,500", 2500],
    ["less than 1.5k please", 1500],
    ["show me cups within 900", 900],
    ["my budget is 4000", 4000],
    ["budget of Rs 5,000 for a lamp", 5000],
    ["up to PKR 7500", 7500],
    ["max 1200", 1200],
    ["no more than 3000 rupees", 3000],
    ["3000 tak koi achi cheez", 3000],
    ["Rs 2000 se kam", 2000],
    ["2k ke andar", 2000],
    ["500 or less", 500],
  ])("%s -> %i", (message, max) => {
    expect(parseBudget(message, "PKR")).toEqual({ max });
  });

  it("finds no budget when none is given", () => {
    expect(parseBudget("Do you have clay chai cups?", "PKR")).toBeNull();
    expect(parseBudget("What is the price of the brass lamp?", "PKR")).toBeNull();
    expect(parseBudget("I want 2 kettles", "PKR")).toBeNull(); // a quantity, not a price ceiling
  });

  it("ignores a budget of zero", () => {
    expect(parseBudget("under 0", "PKR")).toBeNull();
  });

  it("reads Rs as whichever rupee the shop sells in", () => {
    expect(parseBudget("under Rs 3000", "INR")).toEqual({ max: 3000 });
    expect(parseBudget("under ₹3000", "INR")).toEqual({ max: 3000 });
  });

  it("reads dollars, pounds and euros in a shop selling in them", () => {
    expect(parseBudget("anything under $50?", "USD")).toEqual({ max: 50 });
    expect(parseBudget("below £20", "GBP")).toEqual({ max: 20 });
    expect(parseBudget("under 30 euros", "EUR")).toEqual({ max: 30 });
  });

  it("ignores a budget in another currency than the shop's, rather than guessing a conversion", () => {
    expect(parseBudget("anything under $50?", "PKR")).toBeNull();
    expect(parseBudget("under Rs 3000", "USD")).toBeNull();
    expect(parseBudget("under ₹3000", "PKR")).toBeNull();
  });
});

describe("keeping only products within the budget", () => {
  const products = [
    { title: "Clay Chai Cup", salePrice: 1620 },
    { title: "Winter Shawl", salePrice: 2500 },
    { title: "Brass Lamp", salePrice: 7500 },
  ];

  it("compares the selling price, including a product priced exactly at the budget", () => {
    expect(withinBudget(products, { max: 2500 }).map((p) => p.title)).toEqual(["Clay Chai Cup", "Winter Shawl"]);
  });

  it("returns nothing when the budget is below every product", () => {
    expect(withinBudget(products, { max: 100 })).toEqual([]);
  });

  it("returns every product when there is no budget", () => {
    expect(withinBudget(products, null)).toHaveLength(3);
  });
});
