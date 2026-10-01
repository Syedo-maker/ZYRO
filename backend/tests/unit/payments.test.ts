/**
 * Unit tests for Part E's building blocks: the COD trust rules, the payment-screenshot checks, the
 * payment-failure helper, and the courier file reader and matcher. All pure functions, so the rules
 * that decide whether a merchant sends out goods unpaid can be read and argued with line by line.
 */
import { ALLOWED_INPUTS, assessCodRisk, bandFor, looksLikePhone, outcomeFor, type CodRiskInputs } from "../../src/modules/payments/cod.risk";
import { checkProof, hasProblem, summarise, type ExtractedProof, type ProofContext } from "../../src/modules/payments/proof.checks";
import { checkHelpSentence, fallbackHelp, knownHelp, KNOWN_FAILURE_CODES } from "../../src/modules/payments/payment.help";
import { parseAmount, parseOrderNumber, parseRemittanceCsv, reconcile, RemittanceFileError } from "../../src/modules/payments/remittance.csv";

// ---------------------------------------------------------------------------------------------
// The COD Trust Agent
// ---------------------------------------------------------------------------------------------

const baseInputs: CodRiskInputs = {
  orderTotal: 2000,
  storeAverageOrder: 2000,
  itemCount: 2,
  hasPhone: true,
  phoneLooksValid: true,
  addressComplete: true,
  storeHistory: { deliveredOrders: 0, refusedOrders: 0 },
  platformHistory: { delivered: 0, refused: 0 },
};

const score = (over: Partial<CodRiskInputs>) => assessCodRisk({ ...baseInputs, ...over });

describe("the COD trust score only looks at what it is allowed to", () => {
  it("the inputs it takes are exactly the ones on the allowed list", () => {
    expect(Object.keys(baseInputs).sort()).toEqual([...ALLOWED_INPUTS].sort());
  });

  it("nothing on the list is a name, an address, an area, a device or anything about the person", () => {
    // Compared as whole words, so "storeAverageOrder" is not caught by "age".
    const banned = ["name", "area", "city", "postcode", "postal", "zip", "gender", "age", "language", "device", "ip", "browser", "fingerprint", "religion", "caste", "ethnicity"];
    const wordsOf = (input: string) => input.replace(/([A-Z])/g, " $1").toLowerCase().split(" ");
    for (const input of ALLOWED_INPUTS) {
      for (const word of wordsOf(input)) expect(banned).not.toContain(word);
    }
    // "address" appears once, and only as addressComplete: whether an address was filled in, never what it says.
    expect(ALLOWED_INPUTS.filter((i) => i.toLowerCase().includes("address"))).toEqual(["addressComplete"]);
  });

  it("the reasons shown to the merchant add up to the score exactly", () => {
    const result = score({ hasPhone: false, addressComplete: false });
    expect(result.reasons.reduce((s, r) => s + r.points, 0)).toBe(result.score);
    expect(result.reasons.every((r) => r.detail.length > 0 && r.code.length > 0)).toBe(true);
  });
});

describe("what raises and lowers the score", () => {
  it("a first order from a reachable shopper is low risk", () => {
    const r = score({});
    expect(r.band).toBe("low");
    expect(r.reasons.map((x) => x.code)).toEqual(["no_history"]);
  });

  it("no phone number is the single biggest worry: the courier cannot call ahead", () => {
    const r = score({ hasPhone: false });
    expect(r.reasons.find((x) => x.code === "no_phone")?.points).toBe(30);
    expect(r.band).toBe("medium");
  });

  it("a phone that is not a real number, and an incomplete address, together make it high risk", () => {
    expect(score({ phoneLooksValid: false, addressComplete: false }).band).toBe("high");
  });

  it("a shopper who has refused this store's deliveries before is high risk, and it says how many", () => {
    const r = score({ storeHistory: { deliveredOrders: 1, refusedOrders: 2 } });
    expect(r.band).toBe("high");
    expect(r.reasons.find((x) => x.code === "store_refusals")?.detail).toMatch(/refused 2 cash deliveries from your store/);
  });

  it("a good customer stays low even on an unusually large order", () => {
    const r = score({ storeHistory: { deliveredOrders: 4, refusedOrders: 0 }, orderTotal: 20000 });
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(["store_good_history", "unusually_large"]));
    expect(r.band).toBe("low");
  });

  it("the platform's count of refusals for that number counts, but never twice with the store's own", () => {
    const platformOnly = score({ platformHistory: { delivered: 0, refused: 2 } });
    expect(platformOnly.reasons.find((x) => x.code === "platform_refusals")?.points).toBe(23);
    const both = score({ storeHistory: { deliveredOrders: 0, refusedOrders: 1 }, platformHistory: { delivered: 0, refused: 2 } });
    expect(both.reasons.map((x) => x.code)).not.toContain("platform_refusals");
  });

  it("the platform signal says only how many, never which shop", () => {
    const r = score({ platformHistory: { delivered: 0, refused: 3 } });
    const detail = r.reasons.find((x) => x.code === "platform_refusals")!.detail;
    expect(detail).toMatch(/at shops on ZYRO/);
    expect(detail).not.toMatch(/order|#\d|store "|shop "/i);
  });

  it("a score always carries at least one reason, even when nothing stands out", () => {
    // A shopper with a little clean history elsewhere fires no rule at all; the band still has to be
    // explainable, so the quiet case says so rather than showing a bare "Low risk".
    const quiet = score({ platformHistory: { delivered: 1, refused: 0 } });
    expect(quiet.reasons).toEqual([{ code: "nothing_of_concern", points: 0, detail: expect.any(String) }]);
    expect(quiet.score).toBe(0);
    for (const inputs of [{}, { hasPhone: false }, { storeHistory: { deliveredOrders: 2, refusedOrders: 0 } }, { platformHistory: { delivered: 5, refused: 0 } }]) {
      expect(score(inputs).reasons.length).toBeGreaterThan(0);
    }
  });

  it("a score never goes below 0 or above 100", () => {
    expect(score({ storeHistory: { deliveredOrders: 9, refusedOrders: 0 }, platformHistory: { delivered: 9, refused: 0 } }).score).toBeGreaterThanOrEqual(0);
    expect(score({ hasPhone: false, addressComplete: false, itemCount: 30, orderTotal: 99999, storeHistory: { deliveredOrders: 0, refusedOrders: 5 } }).score).toBe(100);
  });

  it("the bands start where they say they do", () => {
    expect([bandFor(0), bandFor(34), bandFor(35), bandFor(64), bandFor(65), bandFor(100)]).toEqual(["low", "low", "medium", "medium", "high", "high"]);
  });
});

describe("phone numbers", () => {
  it.each(["03001234567", "0300 123 4567", "+923001234567", "+92 300 1234567", "0092-300-1234567"])("%s is a Pakistani mobile", (n) => {
    expect(looksLikePhone(n)).toBe(true);
  });

  it.each(["", "   ", "123", "abcdefgh", "00", "notaphone"])("%j is not a usable number", (n) => {
    expect(looksLikePhone(n)).toBe(false);
  });

  it("a plausible foreign number is accepted, because stores sell abroad too", () => {
    expect(looksLikePhone("+44 20 7946 0958")).toBe(true);
  });
});

describe("what the store does with a band", () => {
  const settings = { codBlockBand: "high", codAdvancePercent: 0 };

  it("by default only high risk loses cash on delivery", () => {
    expect(outcomeFor("low", settings)).toBe("allowed");
    expect(outcomeFor("medium", settings)).toBe("allowed");
    expect(outcomeFor("high", settings)).toBe("blocked");
  });

  it("a stricter store can stop medium risk too", () => {
    expect(outcomeFor("medium", { ...settings, codBlockBand: "medium" })).toBe("blocked");
  });

  it("a store asking for a deposit gets 'advance required' instead of a flat refusal", () => {
    expect(outcomeFor("high", { codBlockBand: "high", codAdvancePercent: 30 })).toBe("advance_required");
  });

  it("a store that blocks nothing allows every band", () => {
    for (const band of ["low", "medium", "high"] as const) expect(outcomeFor(band, { codBlockBand: "none", codAdvancePercent: 0 })).toBe("allowed");
  });
});

// ---------------------------------------------------------------------------------------------
// The payment screenshot
// ---------------------------------------------------------------------------------------------

const ctx: ProofContext = {
  orderTotal: 4500,
  currency: "PKR",
  declaredAmount: 4500,
  declaredReference: "TRX123456",
  orderPlacedAt: new Date("2026-10-01T10:00:00Z"),
  referenceAlreadyUsed: false,
};

const good: ExtractedProof = { amount: 4500, currency: "PKR", date: "2026-10-01", reference: "TRX123456", bank: "HBL", sender: "Ali", readable: true, note: null };

const codes = (f: ReturnType<typeof checkProof>) => f.map((x) => x.code);

describe("checking a payment screenshot", () => {
  it("a matching screenshot raises no problem, and says what was actually checked", () => {
    const f = checkProof(good, ctx);
    expect(hasProblem(f)).toBe(false);
    expect(codes(f)).toEqual(expect.arrayContaining(["amount_matches", "reference_matches", "date_plausible"]));
    expect(summarise(f)).toMatch(/all match this order/);
  });

  it("a screenshot for less money than the order is a problem, and says by how much", () => {
    const f = checkProof({ ...good, amount: 450 }, ctx);
    expect(hasProblem(f)).toBe(true);
    expect(f.find((x) => x.code === "amount_mismatch")!.detail).toMatch(/PKR 450\.00, which is less than the PKR 4500\.00/);
  });

  it("a reference already used on another order is caught, even before the image is read", () => {
    const f = checkProof(null, { ...ctx, referenceAlreadyUsed: true });
    expect(codes(f)).toContain("reference_reused");
    expect(hasProblem(f)).toBe(true);
  });

  it("the amount the shopper typed is checked against the order on its own, with no AI", () => {
    expect(codes(checkProof(null, { ...ctx, declaredAmount: 100 }))).toContain("declared_amount_mismatch");
  });

  it("a receipt dated before the order was placed is a problem", () => {
    expect(codes(checkProof({ ...good, date: "2026-09-20" }, ctx))).toContain("receipt_too_old");
  });

  it("a receipt dated after the order is a warning, not a refusal", () => {
    const f = checkProof({ ...good, date: "2026-10-09" }, ctx);
    expect(codes(f)).toContain("receipt_future_dated");
    expect(hasProblem(f)).toBe(false);
  });

  it("the wrong currency is a problem", () => {
    expect(codes(checkProof({ ...good, currency: "USD" }, ctx))).toContain("currency_mismatch");
  });

  it("a reference on the image that differs from the typed one is a warning for the merchant to read", () => {
    expect(codes(checkProof({ ...good, reference: "TRX999999" }, ctx))).toContain("reference_mismatch");
  });

  it("an image that is not a receipt is a problem, with the AI's own note as the reason", () => {
    const f = checkProof({ ...good, readable: false, note: "This is a photo of a shoe." }, ctx);
    expect(f.find((x) => x.code === "unreadable")!.detail).toBe("This is a photo of a shoe.");
    expect(hasProblem(f)).toBe(true);
  });

  it("with no AI answer at all the merchant is told to look themselves, and the server's own checks still run", () => {
    const f = checkProof(null, ctx);
    expect(codes(f)).toEqual(["not_read"]);
    expect(hasProblem(f)).toBe(false);
  });

  it("nothing the checks produce ever accepts a payment: they only describe", () => {
    const everything = [checkProof(good, ctx), checkProof({ ...good, amount: 1 }, ctx), checkProof(null, ctx)].flat();
    for (const f of everything) expect(f.severity).toMatch(/^(ok|warning|problem)$/);
  });
});

// ---------------------------------------------------------------------------------------------
// The payment-failure helper
// ---------------------------------------------------------------------------------------------

describe("the payment-failure helper", () => {
  it("every known reason has a written answer in English, Urdu and Roman Urdu", () => {
    for (const code of KNOWN_FAILURE_CODES) {
      for (const lang of ["en", "ur", "roman"] as const) {
        const help = knownHelp(code, lang)!;
        expect(help.reason.length).toBeGreaterThan(0);
        expect(help.nextStep.length).toBeGreaterThan(0);
        expect(help.source).toBe("known");
      }
    }
  });

  it("the Urdu answer is in Urdu script and the Roman one is not", () => {
    expect(knownHelp("insufficient_funds", "ur")!.reason).toMatch(/[؀-ۿ]/);
    expect(knownHelp("insufficient_funds", "roman")!.reason).not.toMatch(/[؀-ۿ]/);
  });

  it("not enough money suggests another method; a wrong PIN does not", () => {
    expect(knownHelp("insufficient_funds", "en")!.tryAnotherMethod).toBe(true);
    expect(knownHelp("wrong_pin", "en")!.tryAnotherMethod).toBe(false);
  });

  it("a timed-out or cancelled payment tells the shopper nothing was charged", () => {
    expect(knownHelp("expired_session", "en")!.nextStep).toMatch(/nothing was charged/i);
  });

  it("an unknown code falls back to a written answer, never to silence", () => {
    expect(knownHelp("some_new_bank_code", "en")).toBeNull();
    expect(fallbackHelp("ur").reason).toMatch(/[؀-ۿ]/);
  });

  it.each([
    ["claims the payment worked", "Your payment was successful, please wait."],
    ["promises money back", "The bank will refund you shortly."],
    ["says it in Roman Urdu", "Aapki payment kamyab ho gayi."],
    ["carries an account number", "Send the money to account 03001234567 instead."],
    ["rambles", "x".repeat(400)],
    ["is empty", "   "],
  ])("an AI sentence that %s is thrown away", (_name, text) => {
    expect(checkHelpSentence(text)).toBeNull();
  });

  it("a plain explanation is kept, with its quotes trimmed", () => {
    expect(checkHelpSentence('"The bank said there was not enough balance."')).toBe("The bank said there was not enough balance.");
  });
});

// ---------------------------------------------------------------------------------------------
// The courier file
// ---------------------------------------------------------------------------------------------

describe("reading a courier's cash-collected file", () => {
  it("finds the order and amount columns whatever the courier calls them", () => {
    const f = parseRemittanceCsv("Consignment No,Destination,COD Amount (PKR)\nORDER-1042,Lahore,\"4,500.00\"\n1043,Karachi,Rs. 1250\n");
    expect(f.referenceColumn).toBe("Consignment No");
    expect(f.amountColumn).toBe("COD Amount (PKR)");
    expect(f.rows).toEqual([
      { reference: "ORDER-1042", amount: 4500, line: 2 },
      { reference: "1043", amount: 1250, line: 3 },
    ]);
  });

  it("reads a semicolon file saved from Excel", () => {
    expect(parseRemittanceCsv("Order No;Amount\n1042;4500\n1043;1250\n").rows).toHaveLength(2);
  });

  it.each([
    ["1,250.00", 1250],
    ["Rs. 1250", 1250],
    ["PKR 1,250.50", 1250.5],
    ["1250/-", 1250],
    ["", null],
    ["pending", null],
  ])("an amount written %j reads as %s", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each([
    ["Order #1042", 1042],
    ["ZYRO-1042", 1042],
    ["1042", 1042],
    ["no digits here", null],
  ])("an order reference %j reads as %s", (raw, expected) => {
    expect(parseOrderNumber(raw)).toBe(expected);
  });

  it("says which column it could not find, rather than failing silently", () => {
    expect(() => parseRemittanceCsv("Name,City\nAli,Lahore\n")).toThrow(/order or consignment number.*amount collected/s);
  });

  it.each([
    ["an empty file", "Order No,Amount\n"],
    ["only headings and blanks", "Order No,Amount\n,\n"],
    ["a row with no amount", "Order No,Amount\n1042,pending\n"],
  ])("refuses %s with a clear reason", (_name, text) => {
    expect(() => parseRemittanceCsv(text)).toThrow(RemittanceFileError);
  });
});

describe("matching a courier file against the store's orders", () => {
  const orders = [
    { id: "o1", orderNumber: 1042, total: 4500, isCod: true },
    { id: "o2", orderNumber: 1043, total: 1250, isCod: true },
    { id: "o3", orderNumber: 1044, total: 900, isCod: false },
  ];
  const run = (rows: { reference: string; amount: number }[]) => reconcile(rows.map((r, i) => ({ ...r, line: i + 2 })), orders, "PKR");

  it("a line that matches the order's total exactly is matched", () => {
    expect(run([{ reference: "Order #1042", amount: 4500 }])[0]).toMatchObject({ status: "matched", orderId: "o1", detail: null });
  });

  it("a short payment is reported with how much is missing", () => {
    const item = run([{ reference: "1042", amount: 4000 }])[0];
    expect(item.status).toBe("amount_mismatch");
    expect(item.detail).toMatch(/collected PKR 4000\.00 but order #1042 comes to PKR 4500\.00: PKR 500\.00 short/);
  });

  it("an over-payment is reported too, not quietly accepted", () => {
    expect(run([{ reference: "1042", amount: 5000 }])[0].detail).toMatch(/PKR 500\.00 over/);
  });

  it("an order the store does not have is flagged, not matched to the nearest one", () => {
    expect(run([{ reference: "9999", amount: 100 }])[0]).toMatchObject({ status: "unknown_order", orderId: null });
  });

  it("the same order twice in one file is caught the second time", () => {
    const items = run([
      { reference: "1042", amount: 4500 },
      { reference: "1042", amount: 4500 },
    ]);
    expect(items.map((i) => i.status)).toEqual(["matched", "duplicate_in_file"]);
  });

  it("a courier collecting for an order that was not cash on delivery is flagged", () => {
    expect(run([{ reference: "1044", amount: 900 }])[0].status).toBe("not_cod");
  });

  it("a hand-made file of mixed lines comes out exactly as expected", () => {
    const parsed = parseRemittanceCsv("CN No,COD Amount\nOrder #1042,4500\n1043,1200\n1042,4500\n1044,900\n7777,50\n");
    expect(reconcile(parsed.rows, orders, "PKR").map((i) => i.status)).toEqual(["matched", "amount_mismatch", "duplicate_in_file", "not_cod", "unknown_order"]);
  });
});
