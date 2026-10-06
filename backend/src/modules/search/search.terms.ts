import { prisma } from "../../lib/prisma";
import { normalise, tokenise } from "./search.query";

/**
 * Counting what shoppers search for, so the keyword source behind AI product suggestions can learn
 * from real demand rather than guesswork.
 *
 * **What is stored: the term, the shop, the category filter, and the day. Nothing else.** No user id,
 * no session id, no IP address, no timestamp finer than a day. A term is one row per shop per day
 * however many times it is searched, so even the count cannot be used to follow one person's
 * afternoon. Terms are only ever read back across many shops at once (keywords.sources.ts).
 *
 * A search box is a free text field, and people type things into it that do not belong in a log: a
 * phone number they meant to put somewhere else, an email address, an order number. Everything below
 * is about not keeping those.
 */

/** Shorter than this is noise ("a", "ok") and tells us nothing about demand. */
const MIN_TERM_LENGTH = 3;
/** Longer than this is a pasted sentence, not a search term. */
const MAX_TERM_LENGTH = 60;
/** More words than this is a sentence; the useful signal is one to three words. */
const MAX_WORDS = 5;

/**
 * Anything that looks like a way to contact or identify a person. Deliberately broad: it is far
 * better to drop a real search term than to keep somebody's phone number.
 *
 * - An email address anywhere in the text.
 * - A Pakistani mobile in any of the ways people write it (03xx xxxxxxx, +92 3xx, 0092 3xx).
 * - Any run of 7 or more digits, which covers foreign numbers, order numbers, card fragments and
 *   national id numbers without having to enumerate them.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LONG_DIGIT_RUN = /\d[\d\s-]{5,}\d/;

export function looksPersonal(raw: string): boolean {
  if (EMAIL.test(raw)) return true;
  const digits = raw.replace(/\D/g, "");
  // A Pakistani mobile is 10 digits after the leading 0 or country code; anything near that length
  // is treated as a number rather than a search.
  if (digits.length >= 7) return true;
  return LONG_DIGIT_RUN.test(raw);
}

/**
 * The term to store, or null when it should not be stored at all. Normalised the same way search
 * itself normalises, so what is counted is what was actually searched for.
 */
export function termToStore(raw: string): string | null {
  if (!raw || looksPersonal(raw)) return null;
  const term = normalise(raw);
  if (term.length < MIN_TERM_LENGTH || term.length > MAX_TERM_LENGTH) return null;
  if (tokenise(term).length > MAX_WORDS) return null;
  // Normalising strips punctuation, so a term made only of digits survives as digits; drop those
  // too, spaces and all ("12 34" is a number somebody half-typed, not a word anyone searches for).
  if (/^[\d\s]+$/.test(term)) return null;
  return term;
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Counts one search. Never awaited by the search path: a shopper's results must not wait on
 * analytics, and a failure here must never fail their search.
 */
export function recordSearchTerm(tenantId: string, raw: string, category: string | undefined, now = new Date()): void {
  const term = termToStore(raw);
  if (!term) return;
  const day = today(now);
  const cat = category?.trim() ? normalise(category) : "all";

  // One atomic INSERT ... ON CONFLICT, the same pattern Part B's counters use: two shoppers
  // searching the same word in the same instant both count. Raw SQL, so tenantId is written by hand
  // (the tenant-scoping layer does not see raw SQL).
  const id = `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  void prisma
    .$executeRaw`
      INSERT INTO "SearchTermDaily" ("id", "tenantId", "term", "category", "day", "count", "createdAt")
      VALUES (${id}, ${tenantId}, ${term}, ${cat}, ${day}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("tenantId", "term", "category", "day") DO UPDATE SET
        "count" = "SearchTermDaily"."count" + 1`
    .catch((err: Error) => {
      // Counting a search is never worth an error a shopper can see.
      console.error(`[search] could not count a term: ${err.message}`);
    });
}
