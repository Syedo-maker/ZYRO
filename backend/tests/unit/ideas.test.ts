/**
 * AI product suggestions (Issue 1). Two properties these tests exist to prove:
 *
 * 1. **The AI cannot invent a trend.** The keywords it may use come from our own sources, and the
 *    "Uses popular searches: ..." line shown to the merchant is checked against both that list and
 *    the text the model actually wrote. A model that claims a keyword it did not use, or names a
 *    word nobody searched for, gets no credit for it.
 * 2. **A malformed or hostile answer cannot reach the merchant as if it were a suggestion.**
 */
import { creditedKeywords, parseSuggestions } from "../../src/modules/ideas/ideas.service";
import type { TrendingKeyword } from "../../src/modules/ideas/keywords.sources";

const keywords = (...words: string[]): TrendingKeyword[] => words.map((word) => ({ word, source: "shopper_searches", weight: 1 }));

const suggestion = (title: string, description: string, keywordsUsed: string[] = []) => ({ title, description, keywordsUsed });

describe("reading the model's answer", () => {
  it("takes four suggestions of the right shape", () => {
    const text = JSON.stringify({
      suggestions: [
        { title: "Lawn Suit", description: "A light three piece for summer.", keywordsUsed: ["lawn suit"] },
        { title: "Summer Lawn", description: "Cool cotton for hot days.", keywordsUsed: [] },
      ],
    });
    const parsed = parseSuggestions(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Lawn Suit");
  });

  it("finds the JSON even when the model wrapped it in words", () => {
    const text = 'Here you go! {"suggestions":[{"title":"Clay Mug","description":"Hand thrown and glazed.","keywordsUsed":[]}]} hope that helps';
    expect(parseSuggestions(text)[0].title).toBe("Clay Mug");
  });

  it.each([["not json at all"], [""], ["{broken"], ['{"suggestions":"a string"}'], ["{}"]])("an unusable answer (%j) yields nothing rather than a bad suggestion", (text) => {
    expect(parseSuggestions(text)).toEqual([]);
  });

  it("drops an entry missing a title or a description instead of showing a half-empty card", () => {
    const text = JSON.stringify({
      suggestions: [
        { title: "", description: "No title here.", keywordsUsed: [] },
        { title: "No description here", description: "", keywordsUsed: [] },
        { title: "Good one", description: "This one is complete.", keywordsUsed: [] },
      ],
    });
    expect(parseSuggestions(text).map((s) => s.title)).toEqual(["Good one"]);
  });

  it("never returns more than the four suggestions that were asked for", () => {
    const text = JSON.stringify({ suggestions: Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, description: `D${i}`, keywordsUsed: [] })) });
    expect(parseSuggestions(text)).toHaveLength(4);
  });

  it("ignores any extra field the model sends, so it cannot smuggle one through", () => {
    const text = JSON.stringify({ suggestions: [{ title: "Mug", description: "A mug.", keywordsUsed: [], price: 9999, published: true, storeId: "other-store" }] });
    const parsed = parseSuggestions(text);
    expect(Object.keys(parsed[0]).sort()).toEqual(["description", "keywordsUsed", "title"]);
  });

  it("keeps a keywordsUsed list of strings only", () => {
    const text = JSON.stringify({ suggestions: [{ title: "Mug", description: "A mug.", keywordsUsed: ["clay", 42, null, { word: "mug" }] }] });
    expect(parseSuggestions(text)[0].keywordsUsed).toEqual(["clay"]);
  });
});

describe("the keyword attribution is checked, not trusted", () => {
  it("credits a keyword the suggestion really uses", () => {
    const s = suggestion("Summer Lawn Suit", "A light three piece lawn suit for hot afternoons.", ["lawn suit", "3 piece"]);
    expect(creditedKeywords(s, keywords("lawn suit", "summer"))).toEqual(expect.arrayContaining(["lawn suit", "summer"]));
  });

  it("refuses a keyword the model claims but never wrote", () => {
    const s = suggestion("Clay Mug", "Hand thrown in Multan.", ["lawn suit", "3 piece", "summer"]);
    expect(creditedKeywords(s, keywords("lawn suit", "3 piece", "summer"))).toEqual([]);
  });

  it("refuses a keyword that came from the model rather than from our own data", () => {
    // "best seller" is not in our keyword list, so it is not a popular search and cannot be shown
    // to the merchant as one, however confidently the model names it.
    const s = suggestion("Best Seller Mug", "Our best seller mug.", ["best seller"]);
    expect(creditedKeywords(s, keywords("clay", "mug"))).toEqual(["mug"]);
  });

  it("credits a keyword that is in the text even when the model forgot to claim it", () => {
    const s = suggestion("Clay Mug", "A clay mug for chai.", []);
    expect(creditedKeywords(s, keywords("clay", "chai")).sort()).toEqual(["chai", "clay"]);
  });

  it("names each keyword once, however many times it appears", () => {
    const s = suggestion("Lawn Lawn Lawn", "Lawn lawn lawn lawn.", ["lawn", "lawn"]);
    expect(creditedKeywords(s, keywords("lawn"))).toEqual(["lawn"]);
  });

  it("matches regardless of the case the model wrote it in", () => {
    const s = suggestion("Summer LAWN SUIT", "A Lawn Suit for summer.", ["Lawn Suit"]);
    expect(creditedKeywords(s, keywords("lawn suit"))).toEqual(["lawn suit"]);
  });

  it("credits nothing when there were no keywords to use", () => {
    const s = suggestion("Clay Mug", "A clay mug.", ["clay"]);
    expect(creditedKeywords(s, [])).toEqual([]);
  });
});
