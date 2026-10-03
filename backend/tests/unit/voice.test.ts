/**
 * Part G's voice drafts. The property these tests exist to prove: **a voice note only ever produces
 * a draft the merchant must confirm**, and a misheard number can never slip into the catalogue
 * unseen. Everything doubtful is either refused with a reason or flagged for the merchant to read.
 */
import { buildDraft, describeDraft, DRAFT_KINDS, LOW_CONFIDENCE, MAX_SPOKEN_PRICE, MAX_SPOKEN_STOCK, parseRawDraft, type RawDraft } from "../../src/modules/voice/voice.draft";

const raw = (over: Partial<RawDraft> = {}): RawDraft => ({ kind: "set_price", product: "chai cup", price: 450, stock: null, title: null, category: null, note: null, ...over });
const cup = { id: "p1", title: "Clay Chai Cup", price: 400 };

describe("reading the model's answer", () => {
  it("takes the fields it knows and ignores anything else it was sent", () => {
    const parsed = parseRawDraft('{"kind":"set_price","product":"cup","price":450,"stock":null,"title":null,"category":null,"note":null,"applied":true,"confirm":true}');
    expect(parsed).toEqual({ kind: "set_price", product: "cup", price: 450, stock: null, title: null, category: null, note: null });
    expect(parsed).not.toHaveProperty("applied");
  });

  it("finds the JSON even when the model wrapped it in words", () => {
    expect(parseRawDraft('Sure! {"kind":"set_stock","product":"cup","price":null,"stock":50,"title":null,"category":null,"note":null} hope that helps')?.stock).toBe(50);
  });

  it.each([["not json at all"], [""], ["{broken"]])("an unreadable answer (%j) becomes nothing", (text) => {
    expect(parseRawDraft(text)).toBeNull();
  });

  it("a negative or non-numeric price is dropped rather than used", () => {
    expect(parseRawDraft('{"kind":"set_price","price":-5,"product":"x","stock":null,"title":null,"category":null,"note":null}')?.price).toBeNull();
    expect(parseRawDraft('{"kind":"set_price","price":"four hundred","product":"x","stock":null,"title":null,"category":null,"note":null}')?.price).toBeNull();
  });
});

describe("a draft is only ever a proposal", () => {
  it("every kind a voice note may propose is on a short, fixed list", () => {
    expect([...DRAFT_KINDS]).toEqual(["set_price", "set_stock", "add_product"]);
  });

  it("a draft carries no field that could apply it", () => {
    const { draft } = buildDraft(raw(), cup, 0.9);
    expect(Object.keys(draft!).sort()).toEqual(["confidence", "kind", "price", "productId", "productName", "warnings"]);
    expect(JSON.stringify(draft)).not.toMatch(/apply|applied|confirm|execute/i);
  });

  it("a price change is drafted against the product that was matched", () => {
    const { draft } = buildDraft(raw(), cup, 0.9);
    expect(draft).toMatchObject({ kind: "set_price", productId: "p1", productName: "Clay Chai Cup", price: 450 });
  });

  it("a stock change is drafted as a whole number", () => {
    const { draft } = buildDraft(raw({ kind: "set_stock", price: null, stock: 49.6 }), cup, 0.9);
    expect(draft).toMatchObject({ kind: "set_stock", stock: 50 });
  });
});

describe("what is refused outright", () => {
  it.each([
    ["an instruction that is not about price, stock or a new product", raw({ kind: "unclear", note: "They asked about the weather." })],
    ["a price change with no price heard", raw({ price: null })],
    ["a stock change with no amount heard", raw({ kind: "set_stock", price: null, stock: null })],
    ["a new product with no name", raw({ kind: "add_product", title: null, product: null })],
    ["a new product with no price", raw({ kind: "add_product", title: "New Cup", price: null })],
  ])("%s is refused with a reason", (_name, input) => {
    const { draft, problem } = buildDraft(input, cup, 0.9);
    expect(draft).toBeNull();
    expect(problem).toBeTruthy();
  });

  it("an unreadable recording is refused, not guessed at", () => {
    expect(buildDraft(null, cup, 0.9).draft).toBeNull();
  });

  it("a price change for a product the shop does not have is refused, and names what was heard", () => {
    const { draft, problem } = buildDraft(raw({ product: "telescope" }), null, 0.9);
    expect(draft).toBeNull();
    expect(problem).toMatch(/No product in your shop matched "telescope"/);
  });

  it("an absurd price or stock is refused rather than flagged, because it is certainly a mishearing", () => {
    expect(buildDraft(raw({ price: MAX_SPOKEN_PRICE + 1 }), cup, 0.9).draft).toBeNull();
    expect(buildDraft(raw({ kind: "set_stock", price: null, stock: MAX_SPOKEN_STOCK + 1 }), cup, 0.9).draft).toBeNull();
  });
});

describe("what is flagged for the merchant to read", () => {
  it("a poor recording is flagged even when the words happened to parse", () => {
    const { draft } = buildDraft(raw(), cup, LOW_CONFIDENCE - 0.1);
    expect(draft!.warnings.join(" ")).toMatch(/not very clear/);
  });

  it("a big jump in price is flagged with the current price, not refused", () => {
    const { draft } = buildDraft(raw({ price: 4000 }), cup, 0.95);
    expect(draft).not.toBeNull();
    expect(draft!.warnings.join(" ")).toMatch(/big change from the current price of 400\.00/);
  });

  it("a small, ordinary change is not flagged at all", () => {
    expect(buildDraft(raw({ price: 450 }), cup, 0.95).draft!.warnings).toEqual([]);
  });

  it("a new product with a huge stock figure is flagged rather than refused", () => {
    const { draft } = buildDraft(raw({ kind: "add_product", title: "Cup", price: 100, stock: MAX_SPOKEN_STOCK + 1 }), null, 0.95);
    expect(draft!.warnings.join(" ")).toMatch(/stock sounds high/);
  });
});

describe("what the merchant reads before confirming", () => {
  it.each([
    [raw(), cup, /Change the price of "Clay Chai Cup" to PKR 450\.00/],
    [raw({ kind: "set_stock", price: null, stock: 50 }), cup, /Set the stock of "Clay Chai Cup" to 50/],
    [raw({ kind: "add_product", title: "Steel Kettle", price: 1200, stock: 4, category: "kitchen" }), null, /Add a new product "Steel Kettle" at PKR 1200\.00, with 4 in stock, in kitchen/],
  ])("describes the change in plain words", (input, matched, expected) => {
    const { draft } = buildDraft(input, matched, 0.95);
    expect(describeDraft(draft!, "PKR")).toMatch(expected);
  });
});
