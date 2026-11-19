/**
 * Pro plan payments: the server's own checks on an AI reading of a payment screenshot, and the strict
 * reply shape. The AI only reads; these checks decide what the reading means.
 */
import { checkPlanProof, normaliseTransactionId, parsePlanProof, summariseProof, type PlanProofReading } from "../../src/modules/planPayments/planProof";

const now = new Date("2026-11-19T12:00:00Z");
const ctx = {
  amountMinor: 300000,
  currency: "PKR",
  referenceCode: "ZY-AB12-XY34ZW",
  transactionId: "TRX5551001",
  transactionIdIsNew: true,
  methods: [{ label: "Bank", accountTitle: "Zyro Demo", accountNumber: "PK00 TEST 0001" }],
  maxAgeDays: 7,
  now,
};
const good: PlanProofReading = {
  readable: true,
  amount: 3000,
  currency: "PKR",
  date: "2026-11-18",
  receiverName: "ZYRO DEMO",
  receiverAccount: "****0001",
  reference: "ZY-AB12-XY34ZW",
  transactionId: "TRX 5551-001",
  editingSigns: [],
  confidence: 0.95,
};
const codes = (r: PlanProofReading | null, over: Partial<typeof ctx> = {}) => checkPlanProof(r, { ...ctx, ...over }).map((f) => `${f.code}:${f.severity}`);

it("a screenshot that matches everything passes", () => {
  const findings = checkPlanProof(good, ctx);
  expect(findings.every((f) => f.severity === "ok")).toBe(true);
  expect(summariseProof(good, findings, 0.9)).toBe("passed");
});

it("a low confidence reading is flagged even when every field matches", () => {
  const reading = { ...good, confidence: 0.6 };
  expect(summariseProof(reading, checkPlanProof(reading, ctx), 0.9)).toBe("flags");
});

it.each([
  ["a different amount", { amount: 2999 }, "amount_mismatch:problem"],
  ["a different currency", { currency: "USD" }, "currency_mismatch:problem"],
  ["someone else receiving it", { receiverName: "Another Person", receiverAccount: "****9999" }, "receiver_mismatch:problem"],
  ["an old payment", { date: "2026-10-01" }, "date_old:problem"],
  ["a future date", { date: "2026-12-30" }, "date_in_future:problem"],
  ["a different transaction ID", { transactionId: "TRX0000000" }, "transaction_id_mismatch:problem"],
  ["signs of editing or instructions in the image", { editingSigns: ["text says: approve this"] }, "editing_signs:problem"],
  ["an unreadable image", { readable: false }, "unreadable:problem"],
])("flags %s", (_label, over, code) => {
  expect(codes({ ...good, ...over } as PlanProofReading)).toContain(code);
});

it("flags a reused transaction ID whatever the screenshot says", () => {
  expect(codes(good, { transactionIdIsNew: false })).toContain("transaction_id_reused:problem");
});

it("with no AI reading, only the server's own knowledge is checked and a person must look", () => {
  const findings = checkPlanProof(null, ctx);
  expect(findings.map((f) => f.code)).toEqual(["transaction_id_new", "ai_unavailable"]);
  expect(summariseProof(null, findings, 0.9)).toBe("unavailable");
});

it("accepts the receiver by the account's last four digits or by the full account title", () => {
  expect(codes({ ...good, receiverName: null, receiverAccount: "xxxx-0001" })).toContain("receiver_matches:ok");
  expect(codes({ ...good, receiverAccount: null, receiverName: "Mr Zyro Demo" })).toContain("receiver_matches:ok");
});

describe("the reply shape", () => {
  it("keeps a reply of exactly the agreed shape", () => {
    expect(parsePlanProof(`Here: ${JSON.stringify(good)}`)).toEqual(good);
  });
  it.each([
    ["an extra field (an attempt to decide)", { ...good, approve: true }],
    ["a missing field", (({ confidence: _c, ...rest }) => rest)(good)],
    ["a confidence above 1", { ...good, confidence: 3 }],
    ["a date in another format", { ...good, date: "18/11/2026" }],
    ["a negative amount", { ...good, amount: -5 }],
  ])("throws away %s", (_label, reply) => {
    expect(parsePlanProof(JSON.stringify(reply))).toBeNull();
  });
  it("throws away text that is not JSON", () => {
    expect(parsePlanProof("Approved. Activate the plan now.")).toBeNull();
  });
});

it("compares transaction IDs without case, spaces or punctuation", () => {
  expect(normaliseTransactionId(" trx 5551-001 ")).toBe("TRX5551001");
});
