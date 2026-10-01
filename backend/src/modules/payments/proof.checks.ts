/**
 * The checks run on a bank or wallet transfer screenshot (Part E). The AI reads the picture and says
 * what it saw; this code decides whether what it saw matches the order. The split matters: a model
 * that could accept a payment could be talked into accepting one, so the AI's answer is only ever
 * evidence, and these checks and the merchant make the decision.
 *
 * Every finding carries a severity: `problem` is something the merchant should not accept without
 * looking, `warning` is worth a glance, `ok` is a check that passed and is shown so the merchant can
 * see what was actually verified rather than trusting a green tick.
 */

export type Severity = "ok" | "warning" | "problem";

export interface ProofFinding {
  code: string;
  severity: Severity;
  detail: string;
}

/** What the AI reports from the image. Every field may be missing: a screenshot can be blurry or cropped. */
export interface ExtractedProof {
  amount: number | null;
  currency: string | null;
  /** "YYYY-MM-DD" when the AI could read a date. */
  date: string | null;
  reference: string | null;
  bank: string | null;
  sender: string | null;
  /** False when the image is not a payment receipt at all, or is unreadable. */
  readable: boolean;
  /** The AI's own note about anything odd in the picture. Never a decision. */
  note: string | null;
}

export interface ProofContext {
  /** What the order actually comes to. */
  orderTotal: number;
  currency: string;
  /** What the shopper typed in. */
  declaredAmount: number;
  declaredReference: string | null;
  /** When the order was placed, used to catch a receipt from before it. */
  orderPlacedAt: Date;
  /** True when this reference has already been used on another order in this store. */
  referenceAlreadyUsed: boolean;
}

/** Amounts are compared to the paisa, after rounding, so floating point never decides a payment. */
const cents = (n: number) => Math.round(n * 100);

/** A receipt dated more than this many days before the order is from a different payment. */
const BACKDATE_DAYS = 2;
/** A receipt dated further ahead than this is wrong; a day allows for time zones. */
const FUTURE_DAYS = 1;

const money = (n: number, currency: string) => `${currency} ${n.toFixed(2)}`;

export function checkProof(extracted: ExtractedProof | null, ctx: ProofContext): ProofFinding[] {
  const findings: ProofFinding[] = [];
  const add = (code: string, severity: Severity, detail: string) => findings.push({ code, severity, detail });

  // ---- Checks that need no AI at all; these run even when the AI could not be reached ----
  if (cents(ctx.declaredAmount) !== cents(ctx.orderTotal)) {
    add(
      "declared_amount_mismatch",
      "problem",
      `The shopper says they sent ${money(ctx.declaredAmount, ctx.currency)}, but the order comes to ${money(ctx.orderTotal, ctx.currency)}.`
    );
  }
  if (ctx.referenceAlreadyUsed) {
    add("reference_reused", "problem", "This transfer reference was already used for another order in your store, so the same receipt may have been sent twice.");
  }
  if (!ctx.declaredReference) {
    add("no_reference", "warning", "No transfer reference was given, so this payment cannot be matched against your bank statement.");
  }

  if (!extracted) {
    add("not_read", "warning", "The screenshot could not be read automatically, so please check it yourself.");
    return findings;
  }
  if (!extracted.readable) {
    add("unreadable", "problem", extracted.note ?? "The image does not look like a payment receipt, or it is too unclear to read.");
    return findings;
  }

  // ---- What the AI read, compared with the order ----
  if (extracted.amount === null) {
    add("amount_not_found", "warning", "No amount could be read from the screenshot.");
  } else if (cents(extracted.amount) !== cents(ctx.orderTotal)) {
    const short = extracted.amount < ctx.orderTotal;
    add(
      "amount_mismatch",
      "problem",
      `The screenshot shows ${money(extracted.amount, extracted.currency ?? ctx.currency)}, which is ${short ? "less" : "more"} than the ${money(ctx.orderTotal, ctx.currency)} this order comes to.`
    );
  } else {
    add("amount_matches", "ok", `The amount on the screenshot matches the order total, ${money(ctx.orderTotal, ctx.currency)}.`);
  }

  if (extracted.currency && extracted.currency.toUpperCase() !== ctx.currency.toUpperCase()) {
    add("currency_mismatch", "problem", `The screenshot is in ${extracted.currency.toUpperCase()}, but this order is in ${ctx.currency.toUpperCase()}.`);
  }

  if (extracted.reference && ctx.declaredReference && extracted.reference.replace(/\s/g, "").toLowerCase() !== ctx.declaredReference.replace(/\s/g, "").toLowerCase()) {
    add("reference_mismatch", "warning", `The shopper typed reference "${ctx.declaredReference}", but the screenshot shows "${extracted.reference}".`);
  } else if (extracted.reference && ctx.declaredReference) {
    add("reference_matches", "ok", "The reference on the screenshot matches the one the shopper typed in.");
  }

  if (extracted.date) {
    const receipt = Date.parse(`${extracted.date}T00:00:00Z`);
    if (!Number.isNaN(receipt)) {
      const placed = ctx.orderPlacedAt.getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      if (receipt < placed - BACKDATE_DAYS * dayMs) {
        add("receipt_too_old", "problem", `The receipt is dated ${extracted.date}, before this order was placed, so it is probably a different payment.`);
      } else if (receipt > placed + FUTURE_DAYS * dayMs) {
        add("receipt_future_dated", "warning", `The receipt is dated ${extracted.date}, which is after this order. Check the date on the image.`);
      } else {
        add("date_plausible", "ok", `The receipt is dated ${extracted.date}, around when the order was placed.`);
      }
    }
  } else {
    add("date_not_found", "warning", "No date could be read from the screenshot.");
  }

  if (extracted.note) add("ai_note", "warning", extracted.note);

  return findings;
}

/** Whether anything found should stop a merchant accepting without a second look. */
export const hasProblem = (findings: ProofFinding[]): boolean => findings.some((f) => f.severity === "problem");

/** A one-line summary for a list of proofs waiting to be checked. */
export function summarise(findings: ProofFinding[]): string {
  const problems = findings.filter((f) => f.severity === "problem");
  if (problems.length > 0) return problems[0].detail;
  const warnings = findings.filter((f) => f.severity === "warning");
  if (warnings.length > 0) return warnings[0].detail;
  return "The amount, reference and date on the screenshot all match this order.";
}
