/**
 * Unit tests for the plan catalog and its rules (Part A, backend/src/lib/plans.ts). Pure
 * functions: no database, no network.
 */
import { PLANS, PLAN_ORDER, TOP_UP_PACKS, findTopUpPack, effectiveTier, planEconomics, worstCaseMonthlyCostUsd, aiCeilingCostUsd } from "../../src/lib/plans";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-09-26T12:00:00Z");

describe("effectiveTier: which plan a store can use right now", () => {
  it("a Free store is Free whatever its dates say", () => {
    expect(effectiveTier({ plan: "FREE", planExpiresAt: null }, now)).toBe("FREE");
    expect(effectiveTier({ plan: "FREE", planExpiresAt: new Date(now.getTime() + 100 * HOUR) }, now)).toBe("FREE");
  });

  it("a paid plan with no paid-until date is treated as Free (never trusted open-ended)", () => {
    expect(effectiveTier({ plan: "PRO", planExpiresAt: null }, now)).toBe("FREE");
  });

  it("a paid plan inside its paid period is that plan", () => {
    expect(effectiveTier({ plan: "BUSINESS", planExpiresAt: new Date(now.getTime() + HOUR) }, now)).toBe("BUSINESS");
  });

  it("a paid plan keeps working for the 24 hour grace after its period ends", () => {
    expect(effectiveTier({ plan: "PRO", planExpiresAt: new Date(now.getTime() - 23 * HOUR) }, now)).toBe("PRO");
  });

  it("after the grace, a paid plan counts as Free even if no webhook ever arrived", () => {
    expect(effectiveTier({ plan: "PRO", planExpiresAt: new Date(now.getTime() - 25 * HOUR) }, now)).toBe("FREE");
  });
});

describe("the catalog", () => {
  it("lists Free, Pro and Business in price order", () => {
    expect(PLAN_ORDER).toEqual(["FREE", "PRO", "BUSINESS"]);
    const prices = PLAN_ORDER.map((t) => PLANS[t].priceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(PLANS.FREE.priceCents).toBe(0);
  });

  it("every higher plan allows at least as much as the one below it", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]];
      const higher = PLANS[PLAN_ORDER[i]];
      expect(higher.maxProducts).toBeGreaterThanOrEqual(lower.maxProducts);
      expect(higher.maxStaff).toBeGreaterThanOrEqual(lower.maxStaff);
      expect(higher.aiGenerationsPerMonth).toBeGreaterThanOrEqual(lower.aiGenerationsPerMonth);
      expect(higher.aiChatMessagesPerMonth).toBeGreaterThanOrEqual(lower.aiChatMessagesPerMonth);
      expect(higher.analyticsMaxDays).toBeGreaterThanOrEqual(lower.analyticsMaxDays);
    }
  });

  it("only Business includes a custom domain", () => {
    expect(PLAN_ORDER.filter((t) => PLANS[t].customDomain)).toEqual(["BUSINESS"]);
  });

  it("Business's product limit matches the recommendation service's per-store cap (5000)", () => {
    expect(PLANS.BUSINESS.maxProducts).toBe(5000);
  });

  it("finds a top-up pack by id, and nothing for an unknown id", () => {
    expect(findTopUpPack("small")?.generations).toBeGreaterThan(0);
    expect(findTopUpPack("huge")).toBeUndefined();
    expect(TOP_UP_PACKS.every((p) => p.priceCents > 0)).toBe(true);
  });
});

describe("prices stay above cost", () => {
  it("every paid plan and pack is priced above its worst-case cost", () => {
    for (const row of planEconomics()) {
      if (row.priceUsd > 0) expect(row.profitable).toBe(true);
    }
  });

  it("the worst case counts AI at its ceiling, servers and Stripe's fee", () => {
    const pro = PLANS.PRO;
    const ai = aiCeilingCostUsd(pro.aiGenerationsPerMonth, pro.aiChatMessagesPerMonth);
    const stripe = (pro.priceCents * 0.029 + 30) / 100;
    expect(worstCaseMonthlyCostUsd(pro)).toBeCloseTo(ai + 1.5 + stripe, 6);
  });

  it("the Free plan's worst case stays within its $1 budget", () => {
    expect(worstCaseMonthlyCostUsd(PLANS.FREE)).toBeLessThanOrEqual(1);
  });
});
