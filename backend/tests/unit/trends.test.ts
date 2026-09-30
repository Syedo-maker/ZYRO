/**
 * Unit tests for the Trend Scout's building blocks (Part D): the anonymising aggregation, the Google
 * Trends file reader, the numbered facts and the line-by-line check of the AI's report.
 */
import { aggregate, normaliseCategory, safeToPublish, storeBand, titleKeywords, type SalesRow } from "../../src/modules/trends/trends.aggregate";
import { parseGoogleTrendsCsv, seriesChange, TrendsFileError } from "../../src/modules/trends/trends.csv";
import { buildFacts, checkLines, reportWeek, templateLines } from "../../src/modules/trends/trends.report";

const OPTS = { minStores: 5, maxShare: 0.6, baselineWeeks: 4 };

/** `n` stores each selling `units` of a title this week and `base` over the 4 weeks before. */
function stores(n: number, units: number, base: number, title = "Clay Chai Cup", category = "kitchen", market = "PKR", prefix = "s"): SalesRow[] {
  return Array.from({ length: n }, (_, i) => [
    { tenantId: `${prefix}${i}`, market, category, title, period: "current" as const, units },
    { tenantId: `${prefix}${i}`, market, category, title, period: "baseline" as const, units: base },
  ]).flat();
}

describe("category names are the same across stores", () => {
  it.each([
    ["Home & Kitchen", "home and kitchen"],
    ["  home   and kitchen ", "home and kitchen"],
    ["HOME-AND-KITCHEN!", "home and kitchen"],
    ["", "uncategorised"],
  ])("%j becomes %j", (raw, expected) => {
    expect(normaliseCategory(raw)).toBe(expected);
  });

  it("title keywords are lowercase words of 3+ letters, once each, without filler", () => {
    expect(titleKeywords("Clay Chai Cup - Set of 2, clay")).toEqual(["clay", "chai", "cup"]);
  });
});

describe("the privacy rules", () => {
  it("5 stores with an even share may be published", () => {
    expect(safeToPublish(new Map([["a", 10], ["b", 10], ["c", 10], ["d", 10], ["e", 10]]), OPTS)).toBe(true);
  });

  it("4 stores may not: too few to hide one", () => {
    expect(safeToPublish(new Map([["a", 10], ["b", 10], ["c", 10], ["d", 10]]), OPTS)).toBe(false);
  });

  it("5 stores where one sells most of the units may not: the figure would describe that one store", () => {
    expect(safeToPublish(new Map([["a", 95], ["b", 1], ["c", 1], ["d", 1], ["e", 2]]), OPTS)).toBe(false);
  });

  it("a category needs enough stores in BOTH the week and the weeks before, or its figures are withheld (zeroed)", () => {
    const rows = [...stores(5, 0, 8), { tenantId: "s0", market: "PKR", category: "kitchen", title: "Clay Chai Cup", period: "current" as const, units: 30 }];
    const [t] = aggregate(rows, OPTS);
    expect(t.publishable).toBe(false);
    expect(t).toMatchObject({ currentUnits: 0, baselineWeeklyUnits: 0, changePercent: null, rising: [], falling: [] });
  });

  it("an evenly spread category is published with its change on the weekly average", () => {
    const [t] = aggregate(stores(6, 3, 8), OPTS); // this week 18, weeks before 48 over 4 = 12 a week
    expect(t).toMatchObject({ publishable: true, storeCount: 6, currentUnits: 18, baselineWeeklyUnits: 12, changePercent: 50 });
  });

  it("markets are never mixed: the same category in PKR and GBP stores is two separate figures", () => {
    const out = aggregate([...stores(5, 2, 8, "Mug", "kitchen", "PKR", "p"), ...stores(5, 2, 8, "Mug", "kitchen", "GBP", "g")], OPTS);
    expect(out.map((t) => `${t.market}/${t.category}`)).toEqual(["GBP/kitchen", "PKR/kitchen"]);
  });

  it("a rising keyword needs the same privacy rules on its own: sold by enough stores, none dominating", () => {
    const rows = [
      ...stores(5, 4, 8, "Clay Chai Cup"), // chai, cup: 20 units this week against 10 a week before, from 5 stores evenly
      ...stores(1, 40, 4, "Clay Pot", "kitchen", "PKR", "x"), // one store selling a lot of "clay"
      ...stores(5, 10, 40, "Steel Kettle", "kitchen", "PKR", "k"), // enough other sales that the category as a whole is not dominated
    ];
    const [t] = aggregate(rows, OPTS);
    expect(t.publishable).toBe(true);
    const rising = t.rising.map((k) => k.keyword);
    expect(rising).toEqual(expect.arrayContaining(["chai", "cup"]));
    // "pot" is sold by one store only; "clay" is in 6 stores but one of them sells 40 of its 60 units this week.
    expect(rising).not.toContain("pot");
    expect(rising).not.toContain("clay");
  });

  it("the output carries no store ids, only totals and a count", () => {
    expect(JSON.stringify(aggregate(stores(6, 3, 8), OPTS))).not.toMatch(/"s\d"/);
  });

  it("merchants see a band, never the exact number of stores", () => {
    expect(storeBand(6, 5)).toBe("5 or more stores");
    expect(storeBand(12, 5)).toBe("10 to 24 stores");
    expect(storeBand(40, 5)).toBe("25 or more stores");
  });
});

describe("reading a Google Trends file", () => {
  const FILE = "Category: All categories\n\nWeek,chai cup: (Pakistan),kettle: (Pakistan)\n2026-08-02,40,10\n2026-08-09,<1,12\n2026-08-16,50,11\n";

  it("reads the terms, the region, each week's values ('<1' as 0.5) and the last date", () => {
    const f = parseGoogleTrendsCsv(FILE);
    expect(f.geo).toBe("Pakistan");
    expect(f.series.map((s) => s.term)).toEqual(["chai cup", "kettle"]);
    expect(f.series[0].points).toEqual([
      { date: "2026-08-02", value: 40 },
      { date: "2026-08-09", value: 0.5 },
      { date: "2026-08-16", value: 50 },
    ]);
    expect(f.periodEnd).toBe("2026-08-16");
  });

  it("also reads a quoted export without the region suffix, and monthly dates", () => {
    const f = parseGoogleTrendsCsv('"Month","chai cup"\n"2026-06","30"\n"2026-07","45"\n');
    expect(f.geo).toBeNull();
    expect(f.series[0].points.map((p) => p.date)).toEqual(["2026-06-01", "2026-07-01"]);
  });

  it.each([
    ["not a trends file", "hello,world\n1,2\n"],
    ["a value above 100", "Week,a\n2026-01-04,120\n2026-01-11,3\n"],
    ["an unreadable date", "Week,a\nyesterday,1\n2026-01-11,3\n"],
    ["only one date", "Week,a\n2026-01-04,1\n"],
    ["six terms", "Week,a,b,c,d,e,f\n2026-01-04,1,1,1,1,1,1\n2026-01-11,1,1,1,1,1,1\n"],
  ])("refuses %s with a clear reason", (_name, text) => {
    expect(() => parseGoogleTrendsCsv(text)).toThrow(TrendsFileError);
  });

  it("the movement at the end of a series: the last 4 readings against the 12 before", () => {
    const points = [...Array(12)].map((_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value: 40 })).concat(
      [...Array(4)].map((_, i) => ({ date: `2026-02-0${i + 1}`, value: 60 }))
    );
    expect(seriesChange(points)).toMatchObject({ recentAverage: 60, earlierAverage: 40, changePercent: 50, from: "2026-02-01", to: "2026-02-04", earlierPoints: 12 });
    expect(seriesChange(points.slice(0, 5))).toBeNull();
  });
});

describe("facts and the check on the AI's report", () => {
  const trend = aggregate(stores(6, 3, 8), OPTS)[0];
  const facts = buildFacts(trend, [{ text: 'Google Trends (Pakistan): search interest in "chai cup" averaged 62 out of 100, up 35% on the 12 readings before (average 46).', source: "Google Trends, Pakistan", date: "2026-09-20" }], "2026-09-28", OPTS);

  it("a report covers the 7 days before its Monday", () => {
    expect(reportWeek("2026-09-28")).toEqual(["2026-09-21", "2026-09-27"]);
  });

  it("every fact is numbered and carries a source and a date", () => {
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `F${i + 1}`));
    for (const f of facts) {
      expect(f.source).toBeTruthy();
      expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(facts[0].text).toMatch(/18 units .* up 50% .*\(12\)/);
    expect(facts[0].text).toMatch(/5 or more stores/);
  });

  it("words from the same product that move together are one fact, not three", () => {
    const words = facts.filter((f) => /in the title/.test(f.text));
    expect(words).toHaveLength(1);
    expect(words[0].text).toMatch(/^Products with "chai", "clay" or "cup" in the title sold 18 units/);
  });

  it("a withheld category contributes no platform facts at all (external facts may still stand)", () => {
    const withheld = { ...trend, publishable: false };
    expect(buildFacts(withheld, [], "2026-09-28", OPTS)).toEqual([]);
    expect(buildFacts(withheld, [{ text: "x 1", source: "s", date: "2026-09-20" }], "2026-09-28", OPTS).map((f) => f.kind)).toEqual(["external"]);
  });

  const external = facts.find((f) => f.kind === "external")!.id;

  it("accepts lines that each cite real facts and use only their numbers", () => {
    const lines = checkLines(`Kitchen products sold 18 units last week, up 50% on the usual 12. [F1]\nSearches for chai cups were up 35%. [${external}]`, facts);
    expect(lines).toEqual([
      { text: "Kitchen products sold 18 units last week, up 50% on the usual 12.", cites: ["F1"] },
      { text: "Searches for chai cups were up 35%.", cites: [external] },
    ]);
  });

  it.each([
    ["a line without a citation", "Kitchen sales rose 50%."],
    ["a citation to a fact that does not exist", "Kitchen sales rose 50%. [F99]"],
    ["a number not in the cited fact (invented)", "Kitchen sales rose 70%. [F1]"],
    ["a number from a fact the line does not cite", "Kitchen sales rose 35%. [F1]"],
    ["the no-data answer while facts exist", "NO_DATA"],
    ["an empty answer", "   "],
  ])("rejects %s", (_name, answer) => {
    expect(checkLines(answer, facts)).toBeNull();
  });

  it("the template report is the facts themselves, and always passes the check", () => {
    const t = templateLines(facts);
    expect(t.map((l) => l.cites[0])).toEqual(facts.map((f) => f.id));
    expect(checkLines(t.map((l) => `${l.text} [${l.cites.join(", ")}]`).join("\n"), facts)).toEqual(t);
  });
});
