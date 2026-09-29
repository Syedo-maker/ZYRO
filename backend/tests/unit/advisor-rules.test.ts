/** Part C: the Growth Advisor's festival calendar, checks and topic choice. Pure functions. */
import { upcomingFestivals } from "../../src/modules/advisor/festivals";
import { chooseTopics, evaluateRules, type AdvisorFacts } from "../../src/modules/advisor/advisor.rules";
import { weekStartOf, __forTests } from "../../src/modules/advisor/advisor.service";

const base = (): AdvisorFacts => ({
  currency: "PKR",
  last30: { netSales: 0, orders: 0 },
  prev30: { netSales: 0, orders: 0 },
  lowStockBestSellers: [],
  slowMovers: { count: 0, examples: [] },
  abandonedCarts: { sent7d: 0, converted7d: 0 },
  aiQuota: { used: 0, limit: 15 },
  products: { used: 0, limit: 50 },
  plan: { name: "Free", nextPlan: "Pro" },
  festivals: [],
});
const keys = (f: AdvisorFacts) => evaluateRules(f).map((r) => r.key);

describe("festival calendar", () => {
  it("finds Ramzan 1448 around 8 February 2027 from the Islamic (Umm al-Qura) calendar, marked approximate", () => {
    const f = upcomingFestivals(new Date("2027-01-10T00:00:00Z"));
    const ramzan = f.find((x) => x.key === "ramzan");
    expect(ramzan).toBeDefined();
    expect(Math.abs(new Date(ramzan!.date).getTime() - new Date("2027-02-08").getTime())).toBeLessThanOrEqual(2 * 24 * 3600 * 1000);
    expect(ramzan!.approximate).toBe(true);
  });

  it("14 August is exact, and only shows inside the 14 to 42 day window", () => {
    expect(upcomingFestivals(new Date("2027-07-10T00:00:00Z")).find((x) => x.key === "independence-day")).toMatchObject({ date: "2027-08-14", daysAway: 35, approximate: false });
    expect(upcomingFestivals(new Date("2027-08-05T00:00:00Z")).find((x) => x.key === "independence-day")).toBeUndefined(); // 9 days: too late to act
    expect(upcomingFestivals(new Date("2027-05-01T00:00:00Z")).find((x) => x.key === "independence-day")).toBeUndefined(); // 105 days: too early
  });

  it("the wedding season (1 November) is picked up at the end of September", () => {
    expect(upcomingFestivals(new Date("2026-09-29T00:00:00Z")).map((x) => x.key)).toContain("wedding-season");
  });

  it("lists the soonest first", () => {
    const days = upcomingFestivals(new Date("2027-02-01T00:00:00Z"), 0, 400).map((x) => x.daysAway);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
});

describe("checks", () => {
  it("nothing to say for a quiet store with no festival near", () => {
    expect(keys(base())).toEqual([]);
  });

  it("a best seller low on stock fires first", () => {
    const f = { ...base(), lowStockBestSellers: [{ title: "Chai Cup", quantity: 2, daysOfSupply: 3, unitsSold30d: 20 }] };
    expect(evaluateRules(f)[0]).toMatchObject({ key: "best_seller_low_stock", kind: "tip", facts: { product: "Chai Cup", left: 2 } });
  });

  it("sales up 30% or more is praise; down 30% or more is a tip; in between is nothing", () => {
    expect(keys({ ...base(), last30: { netSales: 130, orders: 6 }, prev30: { netSales: 100, orders: 5 } })).toEqual(["sales_up"]);
    expect(keys({ ...base(), last30: { netSales: 70, orders: 6 }, prev30: { netSales: 100, orders: 5 } })).toEqual(["sales_down"]);
    expect(keys({ ...base(), last30: { netSales: 120, orders: 6 }, prev30: { netSales: 100, orders: 5 } })).toEqual([]);
  });

  it("a trend on too few orders says nothing (one order to two is not 'up 100%')", () => {
    expect(keys({ ...base(), last30: { netSales: 200, orders: 2 }, prev30: { netSales: 100, orders: 1 } })).toEqual([]);
  });

  it("abandoned carts fire at 5 a week, slow movers at 3 products", () => {
    expect(keys({ ...base(), abandonedCarts: { sent7d: 4, converted7d: 0 } })).toEqual([]);
    expect(keys({ ...base(), abandonedCarts: { sent7d: 5, converted7d: 1 } })).toEqual(["abandoned_carts"]);
    expect(keys({ ...base(), slowMovers: { count: 3, examples: ["a", "b", "c"] } })).toEqual(["slow_movers"]);
  });

  it("an upgrade is suggested only near a limit, and a product-limit upgrade only if a bigger plan exists", () => {
    expect(keys({ ...base(), aiQuota: { used: 11, limit: 15 } })).toEqual([]);
    expect(keys({ ...base(), aiQuota: { used: 12, limit: 15 } })).toEqual(["ai_quota_high"]);
    expect(keys({ ...base(), products: { used: 40, limit: 50 } })).toEqual(["near_product_limit"]);
    expect(keys({ ...base(), products: { used: 4900, limit: 5000 }, plan: { name: "Business", nextPlan: null } })).toEqual([]);
  });
});

describe("choosing what to say", () => {
  const all: AdvisorFacts = {
    ...base(),
    lowStockBestSellers: [{ title: "Chai Cup", quantity: 2, daysOfSupply: 3, unitsSold30d: 20 }],
    last30: { netSales: 180, orders: 6 },
    prev30: { netSales: 100, orders: 5 },
    abandonedCarts: { sent7d: 6, converted7d: 1 },
    aiQuota: { used: 13, limit: 15 },
  };

  it("one main tip, the praise, and one upgrade line", () => {
    expect(chooseTopics(evaluateRules(all), []).map((r) => r.key)).toEqual(["best_seller_low_stock", "sales_up", "ai_quota_high"]);
  });

  it("points made in recent weeks are not repeated, except a best seller still running out", () => {
    expect(chooseTopics(evaluateRules(all), ["best_seller_low_stock", "sales_up", "ai_quota_high"]).map((r) => r.key)).toEqual(["best_seller_low_stock"]);
    const restocked = { ...all, lowStockBestSellers: [] };
    expect(chooseTopics(evaluateRules(restocked), ["sales_up", "ai_quota_high"]).map((r) => r.key)).toEqual(["abandoned_carts"]);
  });

  it("nothing new to say means no tip", () => {
    expect(chooseTopics(evaluateRules({ ...base(), abandonedCarts: { sent7d: 6, converted7d: 0 } }), ["abandoned_carts"])).toEqual([]);
  });
});

describe("the written tip", () => {
  it("weeks start on Monday (UTC)", () => {
    expect(weekStartOf(new Date("2026-09-29T10:00:00Z"))).toBe("2026-09-28"); // a Tuesday
    expect(weekStartOf(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28"); // the Monday itself
    expect(weekStartOf(new Date("2026-10-04T23:59:00Z"))).toBe("2026-09-28"); // the Sunday
  });

  it("the template puts the praise first and says 'around' for an approximate festival date", () => {
    const f = { ...base(), last30: { netSales: 180, orders: 6 }, prev30: { netSales: 100, orders: 5 }, festivals: upcomingFestivals(new Date("2027-01-10T00:00:00Z")).filter((x) => x.key === "ramzan") };
    const text = __forTests.templateMessage(chooseTopics(evaluateRules(f), []), "PKR");
    expect(text.startsWith("Net sales in the last 30 days")).toBe(true);
    expect(text).toMatch(/up 80%/);
    expect(text).toMatch(/Ramzan starts around/);
    expect(text).not.toMatch(/\[(tip|praise|upgrade)\]/);
  });
});
