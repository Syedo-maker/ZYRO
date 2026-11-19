import type { PlanTier } from "@prisma/client";
import { STORE_CURRENCY_CODES } from "../lib/currencies";

/**
 * Settings for paying the platform by hand for a plan (Pro plan payments, 2026-11). Read once at
 * startup; a malformed value stops the API with the variable's name (config/envCheck.ts), never its
 * value. All of it is optional: without prices, payment details and approvers the upgrade page says
 * payments by transfer are not set up.
 *
 *   PLAN_PRICES           {"PRO":{"PKR":3000,"USD":12}}   price per plan and currency, in whole units
 *   PLAN_PAYMENT_METHODS  {"PKR":[{"label":"Bank transfer","accountTitle":"...","accountNumber":"...","bank":"..."}],
 *                          "USD":[{"label":"Wise","accountTitle":"...","accountNumber":"...","notes":"..."}]}
 *   PLAN_APPROVER_EMAILS  a@example.com, b@example.com     who is asked to approve (platform admins)
 *   PLAN_REFUND_INSTRUCTIONS                               sent to an owner whose request is rejected
 *
 * The amounts are fixed: no exchange rate is ever applied, so an owner pays exactly what is shown.
 */

export type PlanPriceTable = Partial<Record<PlanTier, Record<string, number>>>;

export interface PaymentMethodDetails {
  label: string;
  accountTitle: string;
  accountNumber: string;
  bank?: string;
  notes?: string;
}

export interface PlanPaymentSettings {
  /** Price in hundredths (paisa, cents), per plan and currency. */
  pricesMinor: PlanPriceTable;
  methods: Record<string, PaymentMethodDetails[]>;
  approverEmails: string[];
  refundInstructions: string;
  periodDays: number;
  /** A screenshot dated longer ago than this is flagged. */
  proofMaxAgeDays: number;
  proofModel: string | null;
  provisional: {
    enabled: boolean;
    hours: number;
    dailyCap: number;
    aiGenerations: number;
    aiChatMessages: number;
    minConfidence: number;
  };
}

type Source = Record<string, string | undefined>;
export interface PlanPaymentProblem {
  name: string;
  problem: string;
}

const DEFAULT_REFUND =
  "Your payment will be returned to the account it came from. If you have not received it within 7 working days, reply to this email with your reference code.";
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const set = (v: string | undefined) => v !== undefined && v.trim() !== "";

function parseJson(source: Source, name: string, problems: PlanPaymentProblem[]): unknown {
  if (!set(source[name])) return undefined;
  try {
    return JSON.parse(source[name]!);
  } catch {
    problems.push({ name, problem: "is not valid JSON" });
    return undefined;
  }
}

function wholeNumber(source: Source, name: string, fallback: number, min: number, max: number, problems: PlanPaymentProblem[]): number {
  if (!set(source[name])) return fallback;
  const n = Number(source[name]);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push({ name, problem: `must be a whole number from ${min} to ${max}` });
    return fallback;
  }
  return n;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" && v.trim().length <= max ? v.trim() : null);

/** Reads and checks every setting; problems are reported by name only. */
export function readPlanPaymentSettings(source: Source): { settings: PlanPaymentSettings; problems: PlanPaymentProblem[] } {
  const problems: PlanPaymentProblem[] = [];
  const currencies = new Set<string>(STORE_CURRENCY_CODES);

  const pricesMinor: PlanPriceTable = {};
  const rawPrices = parseJson(source, "PLAN_PRICES", problems);
  if (rawPrices !== undefined) {
    if (typeof rawPrices !== "object" || rawPrices === null || Array.isArray(rawPrices)) problems.push({ name: "PLAN_PRICES", problem: 'must look like {"PRO":{"PKR":3000,"USD":12}}' });
    else {
      for (const [plan, row] of Object.entries(rawPrices)) {
        if (plan !== "PRO" && plan !== "BUSINESS") {
          problems.push({ name: "PLAN_PRICES", problem: "may only list PRO and BUSINESS" });
          continue;
        }
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          problems.push({ name: "PLAN_PRICES", problem: `${plan} must map currencies to prices` });
          continue;
        }
        const out: Record<string, number> = {};
        for (const [currency, price] of Object.entries(row as Record<string, unknown>)) {
          const code = currency.toUpperCase();
          if (!currencies.has(code)) problems.push({ name: "PLAN_PRICES", problem: `${currency} is not a supported currency` });
          else if (typeof price !== "number" || !(price > 0) || price > 10_000_000 || Math.round(price * 100) !== Math.round(price * 1e6) / 1e4) problems.push({ name: "PLAN_PRICES", problem: `${plan} ${code} must be a positive amount with at most 2 decimals` });
          else out[code] = Math.round(price * 100);
        }
        pricesMinor[plan] = out;
      }
    }
  }

  const methods: Record<string, PaymentMethodDetails[]> = {};
  const rawMethods = parseJson(source, "PLAN_PAYMENT_METHODS", problems);
  if (rawMethods !== undefined) {
    if (typeof rawMethods !== "object" || rawMethods === null || Array.isArray(rawMethods)) problems.push({ name: "PLAN_PAYMENT_METHODS", problem: "must map each currency to a list of payment details" });
    else {
      for (const [currency, list] of Object.entries(rawMethods)) {
        const code = currency.toUpperCase();
        if (!currencies.has(code)) {
          problems.push({ name: "PLAN_PAYMENT_METHODS", problem: `${currency} is not a supported currency` });
          continue;
        }
        if (!Array.isArray(list) || list.length === 0 || list.length > 5) {
          problems.push({ name: "PLAN_PAYMENT_METHODS", problem: `${code} must be a list of 1 to 5 payment details` });
          continue;
        }
        const out: PaymentMethodDetails[] = [];
        for (const item of list as Record<string, unknown>[]) {
          const label = text(item?.label, 40);
          const accountTitle = text(item?.accountTitle, 80);
          const accountNumber = text(item?.accountNumber, 64);
          if (!label || !accountTitle || !accountNumber) {
            problems.push({ name: "PLAN_PAYMENT_METHODS", problem: `every ${code} entry needs label, accountTitle and accountNumber` });
            continue;
          }
          out.push({ label, accountTitle, accountNumber, ...(text(item.bank, 80) ? { bank: text(item.bank, 80)! } : {}), ...(text(item.notes, 300) ? { notes: text(item.notes, 300)! } : {}) });
        }
        methods[code] = out;
      }
    }
  }
  for (const [plan, row] of Object.entries(pricesMinor)) {
    for (const code of Object.keys(row ?? {})) {
      if (rawMethods !== undefined && !methods[code]?.length) problems.push({ name: "PLAN_PAYMENT_METHODS", problem: `has no payment details for ${code}, which PLAN_PRICES charges for ${plan}` });
    }
  }

  const approverEmails = set(source.PLAN_APPROVER_EMAILS)
    ? source.PLAN_APPROVER_EMAILS!.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  if (approverEmails.some((e) => !EMAIL.test(e)) || approverEmails.length > 10) problems.push({ name: "PLAN_APPROVER_EMAILS", problem: "must be 1 to 10 email addresses, separated by commas" });

  const refund = set(source.PLAN_REFUND_INSTRUCTIONS) ? source.PLAN_REFUND_INSTRUCTIONS!.trim() : DEFAULT_REFUND;
  if (refund.length > 600) problems.push({ name: "PLAN_REFUND_INSTRUCTIONS", problem: "must be at most 600 characters" });

  const enabled = set(source.PLAN_PROVISIONAL_ENABLED) ? source.PLAN_PROVISIONAL_ENABLED!.trim().toLowerCase() : "false";
  if (enabled !== "true" && enabled !== "false") problems.push({ name: "PLAN_PROVISIONAL_ENABLED", problem: "must be true or false" });
  const minConfidence = set(source.PLAN_PROVISIONAL_MIN_CONFIDENCE) ? Number(source.PLAN_PROVISIONAL_MIN_CONFIDENCE) : 0.9;
  if (!(minConfidence >= 0.5 && minConfidence <= 1)) problems.push({ name: "PLAN_PROVISIONAL_MIN_CONFIDENCE", problem: "must be a number from 0.5 to 1" });

  const settings: PlanPaymentSettings = {
    pricesMinor,
    methods,
    approverEmails,
    refundInstructions: refund.slice(0, 600),
    periodDays: wholeNumber(source, "PLAN_PERIOD_DAYS", 30, 1, 366, problems),
    proofMaxAgeDays: wholeNumber(source, "PLAN_PROOF_MAX_AGE_DAYS", 7, 1, 60, problems),
    proofModel: set(source.PLAN_PROOF_MODEL) ? source.PLAN_PROOF_MODEL!.trim() : null,
    provisional: {
      enabled: enabled === "true",
      hours: wholeNumber(source, "PLAN_PROVISIONAL_HOURS", 48, 1, 168, problems),
      dailyCap: wholeNumber(source, "PLAN_PROVISIONAL_DAILY_CAP", 5, 0, 1000, problems),
      aiGenerations: wholeNumber(source, "PLAN_PROVISIONAL_AI_GENERATIONS", 40, 0, 100_000, problems),
      aiChatMessages: wholeNumber(source, "PLAN_PROVISIONAL_AI_CHAT", 150, 0, 100_000, problems),
      minConfidence: minConfidence >= 0.5 && minConfidence <= 1 ? minConfidence : 0.9,
    },
  };
  return { settings, problems };
}

/** The currencies an owner can pay a plan in: those the price table charges for that plan. */
export const billingCurrencies = (s: PlanPaymentSettings, plan: PlanTier = "PRO"): string[] => Object.keys(s.pricesMinor[plan] ?? {});

/** Manual plan payments work only with prices, payment details for each priced currency, and approvers. */
export function planPaymentsConfigured(s: PlanPaymentSettings): boolean {
  const priced = billingCurrencies(s);
  return priced.length > 0 && priced.every((c) => (s.methods[c]?.length ?? 0) > 0) && s.approverEmails.length > 0;
}
