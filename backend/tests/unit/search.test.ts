/**
 * Unit tests for Part F's query understanding: normalising what was typed, Roman Urdu and spelling
 * alternatives, typo correction against a store's own words, and the ladder that decides what to
 * search for. All pure functions, and none of them touches the AI: search is the one thing a shop
 * cannot do without, so it has to work with no key, no quota and no Python service.
 */
import { allowedDistance, closestWord, correct, editDistance, expand, expandAll, hasSynonym, normalise, toTextQuery, tokenise } from "../../src/modules/search/search.query";
import { planSearch } from "../../src/modules/search/search.service";

describe("what the shopper typed, as plain words", () => {
  it.each([
    ["  Ceramic   MUG  ", "ceramic mug"],
    ["Ceramic-Mug!", "ceramic mug"],
    ["Mug (large)", "mug large"],
    ["", ""],
  ])("%j reads as %j", (raw, expected) => {
    expect(normalise(raw)).toBe(expected);
  });

  it("Urdu and Arabic digits read as ordinary numbers, so '۲ cup' finds '2 cup'", () => {
    expect(normalise("۲ cup")).toBe("2 cup");
    expect(normalise("٣ plates")).toBe("3 plates");
  });

  it("Urdu letters are kept, so a shop with Urdu titles can still be searched", () => {
    expect(normalise("چائے کپ")).toBe("چائے کپ");
  });

  it("an empty or punctuation-only query has no words at all", () => {
    expect(tokenise("   ")).toEqual([]);
    expect(tokenise("!!! ???")).toEqual([]);
  });
});

describe("Roman Urdu and spelling alternatives", () => {
  it.each([
    ["ketli", "kettle"],
    ["chaye", "tea"],
    ["piyali", "cup"],
    ["joota", "shoe"],
    ["bartan", "utensil"],
    ["kitab", "book"],
    ["ghari", "watch"],
  ])("%j also looks for %j", (typed, expected) => {
    expect(expand(typed)).toContain(expected);
  });

  it("the word typed always comes first, so it is never outranked by a guess", () => {
    expect(expand("ketli")[0]).toBe("ketli");
    expect(expand("chai")[0]).toBe("chai");
  });

  it("a word with no alternative is left exactly as it is", () => {
    expect(expand("ceramic")).toEqual(["ceramic"]);
    expect(hasSynonym(["ceramic", "mug"])).toBe(false);
  });

  it("British and American spellings find each other, because both are written here", () => {
    expect(expand("colour")).toContain("color");
    expect(expand("jewelry")).toContain("jewellery");
  });

  it("expanding a whole query keeps every word once", () => {
    expect(expandAll(["ketli", "ketli"])).toEqual(["ketli", "kettle"]);
    expect(toTextQuery(["mug", "mug", "cup"])).toBe("mug cup");
  });

  it("the mapping is one way: searching the catalogue word does not drag the slang back in", () => {
    expect(expand("kettle")).toEqual(["kettle"]);
  });
});

describe("how far a word may be from the one meant", () => {
  it.each([
    ["ceramic", "ceramik", 1],
    ["kettle", "kettel", 2],
    ["mug", "mug", 0],
    ["cup", "cap", 1],
  ])("%j and %j are %i apart", (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
  });

  it("stops counting once a word is clearly a different word", () => {
    expect(editDistance("mug", "telescope", 2)).toBeGreaterThan(2);
  });

  it("a short word is never corrected: 'cup' and 'cap' are different products, not a typo", () => {
    expect(allowedDistance("cup")).toBe(0);
    expect(closestWord("cap", ["cup", "cot"])).toBeNull();
  });

  it("a longer word may be one or two letters out", () => {
    expect(allowedDistance("kettle")).toBe(1);
    expect(allowedDistance("ceramic")).toBe(2);
  });
});

describe("correcting against the store's own words", () => {
  const vocabulary = ["ceramic", "mug", "kettle", "kitchen", "travel", "notebook", "grinder"];

  it("a mistyped word becomes the closest word the store actually sells", () => {
    expect(closestWord("ceramik", vocabulary)).toBe("ceramic");
    expect(closestWord("notebok", vocabulary)).toBe("notebook");
  });

  it("a word the store does sell is never 'corrected' to something else", () => {
    expect(closestWord("mug", vocabulary)).toBeNull();
    expect(correct(["ceramic", "mug"], vocabulary).changes).toEqual([]);
  });

  it("a word nothing is close to is left alone rather than forced onto a wrong match", () => {
    expect(closestWord("telescope", vocabulary)).toBeNull();
  });

  it("correcting says exactly what it changed, so the shopper can be told", () => {
    const result = correct(["ceramik", "mug"], vocabulary);
    expect(result.corrected).toBe("ceramic mug");
    expect(result.changes).toEqual([{ from: "ceramik", to: "ceramic" }]);
  });

  it("the same query always corrects the same way, whatever order the words are stored in", () => {
    const a = closestWord("kittle", ["kettle", "kitchen"]);
    const b = closestWord("kittle", ["kitchen", "kettle"]);
    expect(a).toBe(b);
  });

  it("a store with no products corrects nothing, and does not crash", () => {
    expect(correct(["ceramik"], []).changes).toEqual([]);
  });
});

describe("the search ladder", () => {
  const vocabulary = ["ceramic", "mug", "kettle", "kitchen"];
  const steps = (q: string, v = vocabulary) => planSearch(q, v).attempts.map((a) => a.step);

  it("words the store knows are searched as typed, and nothing more is tried", () => {
    expect(steps("ceramic mug")).toEqual(["exact"]);
  });

  it("a Roman Urdu word adds a second rung that also looks for the catalogue word", () => {
    const plan = planSearch("ketli", vocabulary);
    // No "corrected" rung: "ketli" is 2 letters from "kettle", and a 5-letter word may only be 1 out,
    // which is exactly why the dictionary is needed rather than leaving it to edit distance.
    expect(plan.attempts.map((a) => a.step)).toEqual(["exact", "synonym"]);
    expect(plan.attempts[1].text).toContain("kettle");
    expect(plan.alsoSearched).toContain("kettle");
  });

  it("a typo adds a rung with the word corrected, and says what it changed", () => {
    const plan = planSearch("ceramik", vocabulary);
    expect(plan.attempts.map((a) => a.step)).toEqual(["exact", "corrected"]);
    expect(plan.correction).toEqual({ corrected: "ceramic", changes: [{ from: "ceramik", to: "ceramic" }] });
  });

  it("the words typed are always tried first, before any interpretation of them", () => {
    for (const q of ["ketli", "ceramik", "ceramic"]) expect(planSearch(q, vocabulary).attempts[0].step).toBe("exact");
  });

  it("an empty query plans nothing at all, so browsing is not treated as a search", () => {
    expect(planSearch("   ", vocabulary)).toEqual({ attempts: [], correction: null, alsoSearched: [] });
  });

  it("nothing in the plan depends on the AI: it is a dictionary and an edit distance", () => {
    // A guard against a future change quietly adding a model call to the query path. Comments are
    // stripped first, because this file's own notes talk about the AI it deliberately does not use.
    const source: string = require("node:fs").readFileSync(require.resolve("../../src/modules/search/search.query.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/orchestrator|anthropic|aiGenerate|openai|ai\.quota/i);
    expect(code).not.toMatch(/^\s*import\b/m);
  });
});
