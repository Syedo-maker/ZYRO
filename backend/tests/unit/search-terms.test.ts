/**
 * What shoppers search for is counted so AI product suggestions can be built on real demand
 * (Issue 1). The property these tests exist to prove: **the log cannot hold anything that
 * identifies a person.** No user id is stored at all, and anything that looks like a way to contact
 * somebody is dropped before it is ever written.
 *
 * These are the rules as the project agreed them: log only the term, the shop, the category and the
 * day; ignore very short terms; and filter out anything that looks like a phone number or an email
 * address.
 */
import { looksPersonal, termToStore, today } from "../../src/modules/search/search.terms";

describe("nothing that could identify a person is kept", () => {
  it.each([
    ["an email address", "ali@example.com"],
    ["an email with words around it", "send to ali@example.com please"],
    ["a Pakistani mobile", "03001234567"],
    ["a mobile written with a space", "0300 1234567"],
    ["a mobile written with dashes", "0300-123-4567"],
    ["a mobile with the country code", "+92 300 1234567"],
    ["a landline", "042 35881234"],
    ["a foreign number", "+44 7700 900123"],
    ["an order or card-like number", "4242424242424242"],
    ["a national id number", "35202-1234567-1"],
  ])("%s is refused (%j)", (_label, raw) => {
    expect(looksPersonal(raw)).toBe(true);
    expect(termToStore(raw)).toBeNull();
  });

  it("a real search is not mistaken for a number, even when it contains a small one", () => {
    expect(looksPersonal("3 piece lawn suit")).toBe(false);
    expect(termToStore("3 piece lawn suit")).toBe("3 piece lawn suit");
  });

  it("a size or a model number is still searchable", () => {
    expect(termToStore("size 42 shoes")).toBe("size 42 shoes");
    expect(termToStore("iphone 15 case")).toBe("iphone 15 case");
  });
});

describe("only terms worth counting are kept", () => {
  it("drops anything shorter than three characters", () => {
    expect(termToStore("a")).toBeNull();
    expect(termToStore("ok")).toBeNull();
    expect(termToStore("mug")).toBe("mug");
  });

  it("drops a pasted sentence rather than counting it as a search", () => {
    expect(termToStore("i am looking for a nice gift for my sister her birthday is next week")).toBeNull();
  });

  it("drops a term made only of digits, which is a number and not a word", () => {
    expect(termToStore("500")).toBeNull();
    expect(termToStore("12 34")).toBeNull();
  });

  it("normalises the same way search itself does, so what is counted is what was searched for", () => {
    expect(termToStore("  Lawn   Suit!  ")).toBe("lawn suit");
    expect(termToStore("LAWN SUIT")).toBe(termToStore("lawn suit"));
  });

  it("an empty search is not a search", () => {
    expect(termToStore("")).toBeNull();
    expect(termToStore("   ")).toBeNull();
  });
});

describe("the timestamp is a day and nothing finer", () => {
  it("two searches in the same afternoon cannot be told apart", () => {
    const morning = new Date("2026-10-05T06:12:45.123Z");
    const evening = new Date("2026-10-05T21:58:02.987Z");
    expect(today(morning)).toBe("2026-10-05");
    expect(today(evening)).toBe(today(morning));
  });
});
