/**
 * Pro plan payments: the price table, payment details and approver settings are checked by name at
 * startup, amounts are kept in hundredths with no conversion, and the feature is off unless complete.
 */
import { billingCurrencies, planPaymentsConfigured, readPlanPaymentSettings } from "../../src/config/planPayments";

const complete = {
  PLAN_PRICES: '{"PRO":{"PKR":3000,"USD":12}}',
  PLAN_PAYMENT_METHODS: JSON.stringify({
    PKR: [{ label: "Bank transfer", accountTitle: "Zyro Demo", accountNumber: "PK00TEST0001", bank: "Test Bank" }],
    USD: [{ label: "Wise", accountTitle: "Zyro Demo", accountNumber: "WISE-0001" }],
  }),
  PLAN_APPROVER_EMAILS: "Owner@Example.com, second@example.com",
};
const names = (source: Record<string, string>) => readPlanPaymentSettings(source).problems.map((p) => p.name);

it("reads a complete setup: prices in hundredths, currencies from the price table, approvers in lower case", () => {
  const { settings, problems } = readPlanPaymentSettings(complete);
  expect(problems).toEqual([]);
  expect(settings.pricesMinor).toEqual({ PRO: { PKR: 300000, USD: 1200 } });
  expect(billingCurrencies(settings)).toEqual(["PKR", "USD"]);
  expect(settings.approverEmails).toEqual(["owner@example.com", "second@example.com"]);
  expect(planPaymentsConfigured(settings)).toBe(true);
});

it("is off, without errors, when nothing is set", () => {
  const { settings, problems } = readPlanPaymentSettings({});
  expect(problems).toEqual([]);
  expect(planPaymentsConfigured(settings)).toBe(false);
  expect(settings.provisional.enabled).toBe(false);
});

it("keeps provisional Pro off unless switched on, with safe defaults", () => {
  const { settings } = readPlanPaymentSettings(complete);
  expect(settings.provisional).toEqual({ enabled: false, hours: 48, dailyCap: 5, aiGenerations: 40, aiChatMessages: 150, minConfidence: 0.9 });
  expect(readPlanPaymentSettings({ ...complete, PLAN_PROVISIONAL_ENABLED: "true" }).settings.provisional.enabled).toBe(true);
});

it.each([
  ["malformed JSON", { PLAN_PRICES: "{PRO:" }, "PLAN_PRICES"],
  ["an unknown plan", { PLAN_PRICES: '{"GOLD":{"USD":5}}' }, "PLAN_PRICES"],
  ["an unsupported currency", { PLAN_PRICES: '{"PRO":{"XYZ":5}}' }, "PLAN_PRICES"],
  ["a zero price", { PLAN_PRICES: '{"PRO":{"USD":0}}' }, "PLAN_PRICES"],
  ["three decimals", { PLAN_PRICES: '{"PRO":{"USD":12.345}}' }, "PLAN_PRICES"],
  ["a priced currency without payment details", { ...complete, PLAN_PAYMENT_METHODS: JSON.stringify({ PKR: [{ label: "Bank", accountTitle: "Z", accountNumber: "1" }] }) }, "PLAN_PAYMENT_METHODS"],
  ["payment details without an account number", { PLAN_PAYMENT_METHODS: JSON.stringify({ PKR: [{ label: "Bank", accountTitle: "Z" }] }) }, "PLAN_PAYMENT_METHODS"],
  ["a bad approver address", { PLAN_APPROVER_EMAILS: "not-an-email" }, "PLAN_APPROVER_EMAILS"],
  ["provisional neither true nor false", { PLAN_PROVISIONAL_ENABLED: "yes" }, "PLAN_PROVISIONAL_ENABLED"],
  ["a negative daily cap", { PLAN_PROVISIONAL_DAILY_CAP: "-1" }, "PLAN_PROVISIONAL_DAILY_CAP"],
])("refuses %s, naming the setting", (_label, source, name) => {
  expect(names(source as Record<string, string>)).toContain(name);
});

it("never puts a value in a problem message", () => {
  const { problems } = readPlanPaymentSettings({ PLAN_APPROVER_EMAILS: "secret-value-123", PLAN_PRICES: "{secret-json" });
  expect(JSON.stringify(problems)).not.toMatch(/secret/);
});
