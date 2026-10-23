/**
 * Product Scout's calculation (scout.aggregate.ts): arithmetic, grouping and the privacy rules, on
 * hand-made rows. No database and no AI.
 */
import { computeTrends, passesRules, productTypeKey, DEFAULT_SCOUT_OPTIONS, type ScoutRow } from "../../src/modules/scout/scout.aggregate";

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

  it("a product whose previous period fails a rule is hidden whole, never shown without its growth", () => {
    const rows = [...evenly("Clay Cup", 3, 10), row("s1", "Clay Cup", 40, "previous"), row("s2", "Clay Cup", 2, "previous"), row("s3", "Clay Cup", 2, "previous")];
    expect(computeTrends(rows)[0].products).toEqual([]);
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

describe("the two biggest shops together (the (2, 85%) rule)", () => {
  it("is hidden when the top two together sold more than 85%, even with enough shops and none above 60%", () => {
    // 4 shops; the biggest has 45% (under 60%), but the top two have 90%.
    const rows = [row("s1", "Clay Cup", 45), row("s2", "Clay Cup", 45), row("s3", "Clay Cup", 5), row("s4", "Clay Cup", 5)];
    expect(computeTrends(rows)[0].products).toEqual([]);
  });

  it("is shown at 85% or under", () => {
    const rows = [row("s1", "Clay Cup", 45), row("s2", "Clay Cup", 40), row("s3", "Clay Cup", 10), row("s4", "Clay Cup", 5)];
    expect(computeTrends(rows)[0].products[0]).toMatchObject({ units: 100, stores: 4 });
  });

  it("the limit is a setting", () => {
    const rows = [row("s1", "Clay Cup", 45), row("s2", "Clay Cup", 40), row("s3", "Clay Cup", 10), row("s4", "Clay Cup", 5)];
    expect(computeTrends(rows, { ...DEFAULT_SCOUT_OPTIONS, maxTopTwoShare: 0.8 })[0].products).toEqual([]);
  });

  it("applies to the previous period too, hiding the product whole", () => {
    const rows = [...evenly("Clay Cup", 4, 10), row("s1", "Clay Cup", 45, "previous"), row("s2", "Clay Cup", 45, "previous"), row("s3", "Clay Cup", 5, "previous"), row("s4", "Clay Cup", 5, "previous")];
    expect(computeTrends(rows)[0].products).toEqual([]);
  });
});

describe("all three rules together", () => {
  // Each case: units per shop this period, and whether it may be shown (defaults: 3 shops, 60%, 85%).
  it.each([
    ["3 even shops", [10, 10, 10], true],
    ["only 2 shops", [10, 10], false],
    ["3 shops, one with 70%", [70, 15, 15], false],
    ["3 shops, exactly 60% and the top two exactly 85%", [60, 25, 15], true],
    ["4 shops, none over 60%, but the top two at 90%", [45, 45, 5, 5], false],
    ["5 shops, top one 50%, top two 80%", [50, 30, 10, 5, 5], true],
    ["5 shops, top one 61%", [61, 20, 9, 5, 5], false],
    ["1 shop", [100], false],
  ])("%s", (_label, units, shown) => {
    const rows = (units as number[]).map((u, i) => row(`s${i + 1}`, "Clay Cup", u));
    expect(computeTrends(rows)[0].products.length === 1).toBe(shown);
    // Hidden means hidden whole: no product, and no category total that would carry its numbers.
    if (!shown) expect(computeTrends(rows)[0].categories).toEqual([]);
  });

  it("passesRules is the one check behind all of them", () => {
    const m = (units: number[]) => new Map(units.map((u, i) => [`s${i}`, u]));
    expect(passesRules(m([10, 10, 10]), DEFAULT_SCOUT_OPTIONS)).toBe(true);
    expect(passesRules(m([45, 45, 5, 5]), DEFAULT_SCOUT_OPTIONS)).toBe(false);
    expect(passesRules(m([0, 0, 10, 10, 10]), DEFAULT_SCOUT_OPTIONS)).toBe(true); // shops with nothing do not count
    expect(passesRules(m([0, 10, 10]), DEFAULT_SCOUT_OPTIONS)).toBe(false);
  });
});

describe("what subtraction would show", () => {
  it("a category is withheld when taking its shown products away leaves fewer than 3 stores", () => {
    // Kettles (3 stores) are shown; pots (2 stores) are not. Kitchen minus kettles would be the pots.
    const [m] = computeTrends([...evenly("Copper Kettle", 3, 4), row("s1", "Steel Pot", 10), row("s2", "Steel Pot", 10)]);
    expect(m.products.map((p) => p.name)).toEqual(["Copper kettle"]);
    expect(m.categories).toEqual([]);
  });

  it("a category is shown when what is left after its shown products is safe, or nothing", () => {
    const both = computeTrends([...evenly("Copper Kettle", 3, 4), ...evenly("Steel Pot", 3, 2)])[0];
    expect(both.categories).toEqual([expect.objectContaining({ key: "kitchen", units: 18 })]);
    // The rest is three different stores' own items, none shown alone, but together safe.
    const rest = computeTrends([...evenly("Copper Kettle", 3, 4), row("s4", "Clay Cup", 3), row("s5", "Wooden Spoon", 3), row("s6", "Tea Towel", 3)])[0];
    expect(rest.categories).toEqual([expect.objectContaining({ key: "kitchen", units: 21 })]);
  });

  it("the previous period's category figure is checked the same way", () => {
    const rows = [
      ...evenly("Copper Kettle", 3, 4),
      ...evenly("Steel Pot", 3, 4),
      ...evenly("Copper Kettle", 3, 2, "previous"),
      row("s1", "Steel Pot", 5, "previous"), // last period's pots: one store, so the pot is hidden
    ];
    const [m] = computeTrends(rows);
    expect(m.products.map((p) => p.name)).toEqual(["Copper kettle"]);
    // Kitchen last period minus the kettles shown would be that one store's pots: the category is hidden too.
    expect(m.categories).toEqual([]);
  });

  const seg = (r: ReturnType<typeof row>, segment: "recent" | "prior" | "older") => ({ ...r, segment });

  it("a 30-day figure is withheld when the days before the 7-day figure would be one store's", () => {
    const rows = [...evenly("Clay Cup", 3, 5).map((r) => seg(r, "recent")), seg(row("s1", "Clay Cup", 6), "older")];
    expect(computeTrends(rows)[0].products).toEqual([]);
  });

  it("and shown when those days are safe too, or when the 7-day figure is not shown at all", () => {
    const safe = [...evenly("Clay Cup", 3, 5).map((r) => seg(r, "recent")), ...evenly("Clay Cup", 3, 2).map((r) => seg(r, "older"))];
    expect(computeTrends(safe)[0].products[0]).toMatchObject({ units: 21 });
    // Last 7 days: only 2 stores, so no 7-day figure exists to take away.
    const noWeek = [...evenly("Clay Cup", 2, 5).map((r) => seg(r, "recent")), ...evenly("Clay Cup", 3, 5).map((r) => seg(r, "older"))];
    expect(computeTrends(noWeek)[0].products[0]).toMatchObject({ units: 25 });
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
