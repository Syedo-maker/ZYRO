/**
 * Reads a courier's cash-collected file and matches it against the store's COD orders (Part E).
 *
 * Couriers in Pakistan (TCS, Leopards, M&P, Trax) each send their own spreadsheet, but every one of
 * them has a column that names the order and a column with the money collected. Rather than write an
 * adapter per courier, the reader finds those two columns by their heading, accepting the names they
 * actually use. A merchant whose file uses something else can still be told exactly what was missing.
 *
 * Nothing here decides anything about money: it reports matched, mismatched and unknown lines, and
 * the merchant settles up. An AI is not involved at any point.
 */

export interface RemittanceRow {
  reference: string;
  amount: number;
  line: number;
}

export interface ParsedRemittance {
  rows: RemittanceRow[];
  /** The headings the reader settled on, so a merchant can see what it read. */
  referenceColumn: string;
  amountColumn: string;
}

export class RemittanceFileError extends Error {}

/** Headings couriers use for the order reference, lowercased and stripped of punctuation. */
const REFERENCE_HEADINGS = [
  "order",
  "order no",
  "order number",
  "order id",
  "orderid",
  "reference",
  "ref",
  "ref no",
  "consignment",
  "consignment no",
  "cn",
  "cn no",
  "cnno",
  "tracking",
  "tracking no",
  "booking no",
  "invoice",
  "invoice no",
];

/** Headings couriers use for the cash collected. */
const AMOUNT_HEADINGS = [
  "amount",
  "cod amount",
  "cod",
  "collected",
  "collected amount",
  "amount collected",
  "cash collected",
  "cod value",
  "value",
  "net amount",
  "payable",
  "remitted",
  "remitted amount",
];

const MAX_ROWS = 5000;

const normalise = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Splits one line of a comma or semicolon separated file, honouring double quotes. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Reads an amount the way couriers write them: "1,250.00", "Rs. 1250", "1250/-", "PKR 1,250".
 * Returns null for anything that is not a number, so a blank or a note is skipped rather than
 * silently counted as zero.
 */
export function parseAmount(raw: string): number | null {
  // The first run of digits wins, so "Rs." and a trailing "/-" are ignored rather than breaking it.
  const match = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls an order number out of whatever the courier wrote. Merchants hand couriers things like
 * "Order #1042", "ZYRO-1042" or "1042"; all of those are order 1042.
 */
export function parseOrderNumber(raw: string): number | null {
  const digits = raw.match(/\d+/g);
  if (!digits || digits.length === 0) return null;
  // The longest run of digits is the order number; a courier's own consignment id is handled by the
  // caller falling back to no match rather than guessing.
  const best = digits.reduce((a, b) => (b.length >= a.length ? b : a));
  const n = Number(best);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseRemittanceCsv(text: string): ParsedRemittance {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new RemittanceFileError("The file needs a heading row and at least one line of data.");

  // Semicolons are common in files saved from Excel in locales that use a comma for decimals.
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headings = cells(lines[0], sep);
  const normalised = headings.map(normalise);

  const findColumn = (names: string[]) => {
    const exact = normalised.findIndex((h) => names.includes(h));
    if (exact >= 0) return exact;
    // Then a heading that contains one of the names ("cod amount (pkr)").
    return normalised.findIndex((h) => names.some((n) => h.includes(n)));
  };

  const refIndex = findColumn(REFERENCE_HEADINGS);
  const amountIndex = findColumn(AMOUNT_HEADINGS);
  if (refIndex < 0 || amountIndex < 0) {
    const missing = [refIndex < 0 ? "the order or consignment number" : null, amountIndex < 0 ? "the amount collected" : null].filter(Boolean).join(" and ");
    throw new RemittanceFileError(`Could not find a column for ${missing}. The file's headings are: ${headings.filter(Boolean).join(", ")}.`);
  }
  if (refIndex === amountIndex) throw new RemittanceFileError("The same column seems to hold both the order number and the amount.");

  const rows: RemittanceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (rows.length >= MAX_ROWS) throw new RemittanceFileError(`The file has more than ${MAX_ROWS} rows; split it and import the parts.`);
    const row = cells(lines[i], sep);
    const reference = (row[refIndex] ?? "").trim();
    const amount = parseAmount(row[amountIndex] ?? "");
    // A line with no reference and no amount is a blank or a totals row; skip it quietly.
    if (!reference && amount === null) continue;
    if (!reference) throw new RemittanceFileError(`Line ${i + 1} has an amount but no order number.`);
    if (amount === null) throw new RemittanceFileError(`Line ${i + 1} ("${reference}") has no readable amount.`);
    rows.push({ reference, amount, line: i + 1 });
  }
  if (rows.length === 0) throw new RemittanceFileError("The file has headings but no rows with an order number and an amount.");

  return { rows, referenceColumn: headings[refIndex], amountColumn: headings[amountIndex] };
}

export type ItemStatus = "matched" | "amount_mismatch" | "unknown_order" | "duplicate_in_file" | "not_cod";

export interface ReconciledItem {
  reference: string;
  amount: number;
  orderId: string | null;
  status: ItemStatus;
  detail: string | null;
}

export interface OrderForMatching {
  id: string;
  orderNumber: number;
  total: number;
  isCod: boolean;
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Matches the file's rows against the store's orders. Pure, so the matching rules can be tested
 * against hand-made files without a database.
 */
export function reconcile(rows: RemittanceRow[], orders: OrderForMatching[], currency: string): ReconciledItem[] {
  const byNumber = new Map(orders.map((o) => [o.orderNumber, o]));
  const seen = new Set<number>();
  const money = (n: number) => `${currency} ${n.toFixed(2)}`;

  return rows.map((row) => {
    const number = parseOrderNumber(row.reference);
    const order = number === null ? undefined : byNumber.get(number);

    if (!order) {
      return { reference: row.reference, amount: row.amount, orderId: null, status: "unknown_order" as const, detail: "No order in your store matches this number." };
    }
    if (seen.has(order.orderNumber)) {
      return { reference: row.reference, amount: row.amount, orderId: order.id, status: "duplicate_in_file" as const, detail: `Order #${order.orderNumber} appears more than once in this file.` };
    }
    seen.add(order.orderNumber);

    if (!order.isCod) {
      return { reference: row.reference, amount: row.amount, orderId: order.id, status: "not_cod" as const, detail: `Order #${order.orderNumber} was not a cash-on-delivery order, so the courier should not have collected for it.` };
    }
    if (cents(row.amount) !== cents(order.total)) {
      const short = row.amount < order.total;
      const diff = Math.abs(order.total - row.amount);
      return {
        reference: row.reference,
        amount: row.amount,
        orderId: order.id,
        status: "amount_mismatch" as const,
        detail: `The courier collected ${money(row.amount)} but order #${order.orderNumber} comes to ${money(order.total)}: ${money(diff)} ${short ? "short" : "over"}.`,
      };
    }
    return { reference: row.reference, amount: row.amount, orderId: order.id, status: "matched" as const, detail: null };
  });
}
