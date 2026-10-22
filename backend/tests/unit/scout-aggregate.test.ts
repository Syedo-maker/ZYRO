/**
 * Product Scout's calculation (scout.aggregate.ts): arithmetic, grouping and the privacy rules, on
 * hand-made rows. No database and no AI.
 */
import { computeTrends, productTypeKey, DEFAULT_SCOUT_OPTIONS, type ScoutRow } from "../../src/modules/scout/scout.aggregate";

let n = 0;
/** One order line: a store sold `units` of `title` in `period`. */
const row = (tenantId: string, title: string, units: number, period: "current" | "previous" = "current", category = "Kitchen", market = "PKR"): ScoutRow => ({
  tenantId,
  market,
  orderId: `o${++n}`,
  category,
  title,
  period,
  units,
});
/** The same product type sold evenly by `stores` stores. */
const evenly = (title: string, stores: number, unitsEach: number, period: "current" | "previous" = "current", category = "Kitchen", market = "PKR") =>
  Array.from({ length: stores }, (_, i) => row(`s${i + 1}`, title, unitsEach, period, category, market));

describe("grouping", () => {
  it("a product type is the title's meaningful words: sizes, numbers and case do not split it", () => {
    expect(productTypeKey("Copper Kettle 1.5L")).toBe("copper kettle");
    expect(productTypeKey("copper kettle")).toBe("copper kettle");
    expect(productTypeKey("COPPER  KETTLE (Large)")).toBe("copper kettle");
  });

  it('"Toys" and "toys", and differently written titles of one type, are added together', () => {
    const [m] = computeTrends([
      row("s1", "Rubber Duck", 4, "current", "Toys"),
      row("s2", "rubber duck 2 pack", 4, "current", " toys "),
      row("s3", "RUBBER DUCK", 4, "current", "TOYS"),
    ]);
    expect(m.categories).toEqual([expect.objectContaining({ key: "toys", name: "Toys", units: 12, stores: 3 })]);
    expect(m.products).toEqual([expect.objectContaining({ id: "toys|rubber duck", name: "Rubber duck", units: 12, stores: 3 })]);
  });

  it("orders are counted once each, per store", () => {
    const rows = [...evenly("Clay Cup", 3, 2), { ...row("s1", "Clay Cup", 1), orderId: "shared" }, { ...row("s1", "Clay Cup", 1), orderId: "shared" }];
    expect(computeTrends(rows)[0].products[0]).toMatchObject({ units: 8, orders: 4 });
  });
});

describe("growth", () => {
  it("is the change on the previous period, rounded, when both periods may be shown", () => {
    const [m] = computeTrends([...evenly("Clay Cup", 3, 10), ...evenly("Clay Cup", 3, 8, "previous")]);
    expect(m.products[0]).toMatchObject({ units: 30, previousUnits: 24, growthPercent: 25, isNew: false });
  });

  it("a fall is negative", () => {
    const [m] = computeTrends([...evenly("Clay Cup", 3, 5), ...evenly("Clay Cup", 3, 10, "previous")]);
    expect(m.products[0]).toMatchObject({ growthPercent: -50 });
  });

  it("nothing sold before means new, with nothing to compare against", () => {
    const [m] = computeTrends(evenly("Clay Cup", 3, 5));
    expect(m.products[0]).toMatchObject({ previousUnits: null, growthPercent: null, isNew: true });
  });
});

describe("privacy", () => {
  it("fewer than 3 stores: not published at all", () => {
    expect(computeTrends(evenly("Clay Cup", 2, 50))[0].products).toEqual([]);
    expect(computeTrends(evenly("Clay Cup", 2, 50))[0].categories).toEqual([]);
  });

  it("the minimum is a setting", () => {
    expect(computeTrends(evenly("Clay Cup", 3, 5), { ...DEFAULT_SCOUT_OPTIONS, minStores: 4 })[0].products).toEqual([]);
    expect(computeTrends(evenly("Clay Cup", 4, 5), { ...DEFAULT_SCOUT_OPTIONS, minStores: 4 })[0].products).toHaveLength(1);
  });

  it("3 stores where one sold over 60% of the units: withheld, because the figure would describe that store", () => {
    const rows = [row("s1", "Clay Cup", 70), row("s2", "Clay Cup", 15), row("s3", "Clay Cup", 15)];
    expect(computeTrends(rows)[0].products).toEqual([]);
    // Exactly 60% is allowed; the limit is a setting too.
    expect(computeTrends([row("s1", "Clay Cup", 60), row("s2", "Clay Cup", 20), row("s3", "Clay Cup", 20)])[0].products).toHaveLength(1);
    expect(computeTrends(rows, { ...DEFAULT_SCOUT_OPTIONS, maxShare: 0.75 })[0].products).toHaveLength(1);
  });

  it("the 60% rule applies to each period on its own: a dominated previous period hides the growth, not the product", () => {
    const rows = [...evenly("Clay Cup", 3, 10), row("s1", "Clay Cup", 40, "previous"), row("s2", "Clay Cup", 2, "previous"), row("s3", "Clay Cup", 2, "previous")];
    const p = computeTrends(rows)[0].products[0];
    expect(p).toMatchObject({ units: 30, previousUnits: null, growthPercent: null, isNew: false });
  });

  it("and to the category as well as the product type", () => {
    // Each type has 3 stores, but one store dominates the category's units as a whole.
    const rows = [
      ...evenly("Clay Cup", 3, 1),
      ...evenly("Clay Plate", 3, 1),
      row("s1", "Steel Pot", 30),
      row("s4", "Steel Pot", 1),
      row("s5", "Steel Pot", 1),
    ];
    const [m] = computeTrends(rows);
    expect(m.categories).toEqual([]); // s1 has 32 of 38 units of kitchen
    expect(m.products.map((p) => p.name).sort()).toEqual(["Clay cup", "Clay plate"]);
  });

  it("the output carries no store id, order id or any title a store wrote", () => {
    const [m] = computeTrends([row("store-abc", "Bazuka Special Kettle!", 5), row("store-def", "bazuka special kettle", 5), row("store-ghi", "BAZUKA SPECIAL KETTLE 2L", 5)]);
    const text = JSON.stringify(m);
    for (const secret of ["store-abc", "store-def", "store-ghi", "o1", "Bazuka Special Kettle!", "2L"]) expect(text).not.toContain(secret);
    expect(m.products[0].name).toBe("Bazuka special kettle");
  });

  it("markets are never mixed", () => {
    const rows = [...evenly("Clay Cup", 2, 5, "current", "Kitchen", "PKR"), row("s9", "Clay Cup", 5, "current", "Kitchen", "USD")];
    const out = computeTrends(rows);
    expect(out.map((m) => m.market)).toEqual(["PKR", "USD"]);
    expect(out.every((m) => m.products.length === 0)).toBe(true); // 2 stores in one market and 1 in the other, never 3 together
  });
});

describe("rankings", () => {
  const rows = [
    ...evenly("Clay Cup", 3, 20), // 60 units, no previous
    ...evenly("Steel Pot", 3, 10),
    ...evenly("Steel Pot", 3, 5, "previous"), // +100%
    ...evenly("Kite", 3, 4, "current", "Toys"),
    ...evenly("Kite", 3, 2, "previous", "Toys"), // +100% but only 12 units
    ...evenly("Ball", 3, 1, "current", "Toys"),
    ...evenly("Ball", 3, 1, "previous", "Toys"), // 3 units: below the growth minimum
  ];
  const [m] = computeTrends(rows);

  it("top sellers by units", () => {
    expect(m.topSellers).toEqual(["kitchen|clay cup", "kitchen|steel pot", "toys|kite", "toys|ball"]);
  });

  it("fastest growing: only with growth and enough units, highest growth first", () => {
    expect(m.fastestGrowing).toEqual(["kitchen|steel pot", "toys|kite"]);
  });

  it("rising in each category", () => {
    expect(m.rising).toEqual([
      { category: "kitchen", products: ["kitchen|steel pot"] },
      { category: "toys", products: ["toys|kite"] },
    ]);
  });
});
