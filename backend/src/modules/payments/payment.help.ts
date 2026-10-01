/**
 * The payment-failure helper (Part E). When a payment does not go through, the shopper usually sees
 * a bank's code, in English, and gives up. This turns the code into a short, plain explanation and
 * one thing to try next, in English, Urdu or Roman Urdu.
 *
 * Every known reason has a written answer in all three languages, so the helper works with no AI at
 * all. The AI is only asked to soften the wording for a reason we have no written answer for, and
 * even then the suggested step comes from this table, never from the model: a model must not invent
 * banking advice, and must never tell a shopper a payment went through.
 */

export type HelpLanguage = "en" | "ur" | "roman";

export interface PaymentHelp {
  /** What went wrong, in the shopper's words. */
  reason: string;
  /** The one thing to try next. */
  nextStep: string;
  /** True when the shopper should try a different payment method rather than the same one again. */
  tryAnotherMethod: boolean;
  source: "known" | "ai" | "fallback";
}

interface Entry {
  tryAnotherMethod: boolean;
  en: [string, string];
  ur: [string, string];
  roman: [string, string];
}

/**
 * The failure reasons worth telling apart. The codes are ours: each gateway's own codes are mapped
 * onto these by its adapter, so adding a provider never means adding new messages here.
 */
const KNOWN: Record<string, Entry> = {
  insufficient_funds: {
    tryAnotherMethod: true,
    en: ["There was not enough money in the account to pay for this order.", "Add money to the account, or pay with another method such as cash on delivery."],
    ur: ["اس اکاؤنٹ میں اس آرڈر کی ادائیگی کے لیے رقم کم تھی۔", "اکاؤنٹ میں رقم ڈالیں، یا کسی اور طریقے سے ادائیگی کریں، جیسے کیش آن ڈیلیوری۔"],
    roman: ["Account mein is order ki adaegi ke liye paise kam the.", "Account mein paise daalen, ya kisi aur tareeqay se adaegi karen, jaise cash on delivery."],
  },
  wrong_pin: {
    tryAnotherMethod: false,
    en: ["The PIN or password entered was not correct.", "Try again carefully. If you have forgotten it, reset it in your bank or wallet app first."],
    ur: ["درج کیا گیا پن یا پاس ورڈ درست نہیں تھا۔", "دوبارہ احتیاط سے کوشش کریں۔ اگر بھول گئے ہیں تو پہلے اپنی بینک یا والٹ ایپ میں اسے دوبارہ بنائیں۔"],
    roman: ["Jo PIN ya password daala gaya wo sahi nahi tha.", "Dobara dhyan se koshish karen. Agar bhool gaye hain to pehle apni bank ya wallet app mein reset karen."],
  },
  expired_session: {
    tryAnotherMethod: false,
    en: ["The payment page was open too long and timed out.", "Go back to your cart and start the payment again; nothing was charged."],
    ur: ["ادائیگی کا صفحہ بہت دیر کھلا رہا اور وقت ختم ہو گیا۔", "اپنی ٹوکری پر واپس جائیں اور دوبارہ ادائیگی شروع کریں؛ کوئی رقم نہیں کٹی۔"],
    roman: ["Payment ka page bohat der khula raha aur waqt khatam ho gaya.", "Apni cart par wapas jayen aur dobara payment shuru karen; koi paisa nahi kata."],
  },
  cancelled_by_user: {
    tryAnotherMethod: false,
    en: ["The payment was cancelled before it finished.", "Start the payment again when you are ready; your cart is still saved."],
    ur: ["ادائیگی مکمل ہونے سے پہلے منسوخ کر دی گئی۔", "جب تیار ہوں تو دوبارہ ادائیگی شروع کریں؛ آپ کی ٹوکری محفوظ ہے۔"],
    roman: ["Payment mukammal hone se pehle cancel kar di gayi.", "Jab tayyar hon to dobara payment shuru karen; aapki cart mehfooz hai."],
  },
  limit_exceeded: {
    tryAnotherMethod: true,
    en: ["This payment is above the daily limit on the account.", "Try a smaller amount, wait until tomorrow, or pay with another method."],
    ur: ["یہ ادائیگی اکاؤنٹ کی روزانہ حد سے زیادہ ہے۔", "کم رقم کی کوشش کریں، کل تک انتظار کریں، یا کسی اور طریقے سے ادائیگی کریں۔"],
    roman: ["Ye payment account ki rozana limit se zyada hai.", "Kam raqam ki koshish karen, kal tak intezar karen, ya kisi aur tareeqay se adaegi karen."],
  },
  bank_declined: {
    tryAnotherMethod: true,
    en: ["The bank refused the payment without saying why.", "Call your bank to ask, or pay with another method such as cash on delivery."],
    ur: ["بینک نے وجہ بتائے بغیر ادائیگی سے انکار کر دیا۔", "اپنے بینک سے رابطہ کریں، یا کسی اور طریقے سے ادائیگی کریں، جیسے کیش آن ڈیلیوری۔"],
    roman: ["Bank ne wajah bataye baghair payment se inkaar kar diya.", "Apne bank se raabta karen, ya kisi aur tareeqay se adaegi karen, jaise cash on delivery."],
  },
  network_error: {
    tryAnotherMethod: false,
    en: ["The connection dropped before the payment finished.", "Check your internet and try again; nothing was charged."],
    ur: ["ادائیگی مکمل ہونے سے پہلے رابطہ منقطع ہو گیا۔", "اپنا انٹرنیٹ دیکھ کر دوبارہ کوشش کریں؛ کوئی رقم نہیں کٹی۔"],
    roman: ["Payment mukammal hone se pehle connection toot gaya.", "Apna internet check kar ke dobara koshish karen; koi paisa nahi kata."],
  },
};

const UNKNOWN: Record<HelpLanguage, [string, string]> = {
  en: ["The payment did not go through, and the bank did not say why.", "Try again, or pay with another method such as cash on delivery. Nothing was charged."],
  ur: ["ادائیگی مکمل نہیں ہوئی، اور بینک نے وجہ نہیں بتائی۔", "دوبارہ کوشش کریں، یا کسی اور طریقے سے ادائیگی کریں، جیسے کیش آن ڈیلیوری۔ کوئی رقم نہیں کٹی۔"],
  roman: ["Payment mukammal nahi hui, aur bank ne wajah nahi batai.", "Dobara koshish karen, ya kisi aur tareeqay se adaegi karen, jaise cash on delivery. Koi paisa nahi kata."],
};

export const KNOWN_FAILURE_CODES = Object.keys(KNOWN);

/** The written answer for a code, when there is one. No AI, no network, always available. */
export function knownHelp(code: string, language: HelpLanguage): PaymentHelp | null {
  const entry = KNOWN[code];
  if (!entry) return null;
  const [reason, nextStep] = entry[language];
  return { reason, nextStep, tryAnotherMethod: entry.tryAnotherMethod, source: "known" };
}

/** What a shopper is told when the code means nothing to us and the AI cannot be reached. */
export function fallbackHelp(language: HelpLanguage): PaymentHelp {
  const [reason, nextStep] = UNKNOWN[language];
  return { reason, nextStep, tryAnotherMethod: true, source: "fallback" };
}

export const SYSTEM_PROMPT =
  "You explain a failed online payment to a shopper in Pakistan, kindly and in one short sentence. " +
  "You are given the bank's own failure text. Say only what it means, in plain words. " +
  "Never say the payment succeeded, never promise a refund, never mention an amount, an order, a date or a bank " +
  "account number, and never tell the shopper to send money anywhere. Do not add advice: a next step is added " +
  "separately. Reply with the one sentence and nothing else.";

export function buildPrompt(providerMessage: string, language: HelpLanguage): string {
  const lang = language === "ur" ? "Urdu script" : language === "roman" ? "Roman Urdu (Urdu written in English letters)" : "English";
  return `Language: ${lang}.\nThe bank or gateway said: ${providerMessage}`;
}

/**
 * Checks the AI's sentence before a shopper sees it. Anything that claims success, promises money
 * back, or carries a number that could be mistaken for an amount or an account is thrown away and
 * the written fallback is used instead.
 */
export function checkHelpSentence(text: string): string | null {
  const t = text.trim().replace(/^["']|["']$/g, "");
  if (!t || t.length > 300) return null;
  if (t.split(/\n/).length > 2) return null;
  const forbidden = /\b(succeed|successful|paid|complete[d]?|refund|reversed|credited|kaamyab|kamyab|wapas|واپس|کامیاب|کٹ گئ)/i;
  if (forbidden.test(t)) return null;
  // A long run of digits is an account or card number; short ones (a "3" in "try 3 times") are harmless.
  if (/\d{5,}/.test(t)) return null;
  return t;
}
