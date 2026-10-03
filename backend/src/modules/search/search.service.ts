import { Product } from "../../models/Product.model";
import { getRedis } from "../../lib/redis";
import { correct, expandAll, hasSynonym, normalise, toTextQuery, tokenise, type Correction } from "./search.query";

/**
 * The search ladder and the per-store vocabulary that makes typo correction possible (Part F).
 *
 * Nothing here touches the AI orchestrator, the Anthropic key or a store's AI allowance. Search is
 * the one thing a shop cannot do without, so it must keep working when every AI feature is off.
 *
 * The ladder, stopping at the first rung that finds anything:
 *   1. the words as typed            "ceramic mug"
 *   2. the words plus known meanings "ketli" also looks for "kettle"
 *   3. the words corrected           "ceramik" becomes "ceramic"
 *   4. a plain contains match        "cer" inside "Ceramic"
 * Each rung says what it did, so the shopper can be told "Showing results for ceramic" rather than
 * silently given something they did not ask for.
 */

/** How long a store's word list is kept. Short, because a merchant adding a product expects to find it. */
const VOCAB_TTL_SECONDS = 600;
/** Words shorter than this are not worth correcting against. */
const MIN_VOCAB_WORD = 3;
/** A ceiling so one enormous catalogue cannot make every search slow. */
const MAX_VOCAB_WORDS = 4000;

const vocabKey = (storeId: string) => `search:vocab:${storeId}`;

/**
 * Every distinct word in this store's own titles and categories. Typo correction is done against
 * this rather than an English dictionary, so "ceramik" maps to a word the store actually sells, and
 * a store selling Urdu-titled goods gets Urdu corrections for free.
 */
export async function vocabularyFor(storeId: string): Promise<string[]> {
  try {
    const cached = await getRedis().get(vocabKey(storeId));
    if (cached) return JSON.parse(cached) as string[];
  } catch {
    // Redis down: build it now. Slower, but search still works, which is the point.
  }

  const docs = await Product.find({ storeId }).select("title category").limit(5000);
  const words = new Set<string>();
  for (const d of docs) {
    for (const w of tokenise(`${d.title} ${d.category}`)) {
      if (w.length >= MIN_VOCAB_WORD) words.add(w);
    }
  }
  const list = [...words].sort().slice(0, MAX_VOCAB_WORDS);

  try {
    await getRedis().set(vocabKey(storeId), JSON.stringify(list), "EX", VOCAB_TTL_SECONDS);
  } catch {
    // Not being able to cache it is not a reason to fail the search.
  }
  return list;
}

/** Drops a store's cached word list, so a new product is findable by a typo straight away. */
export async function forgetVocabulary(storeId: string): Promise<void> {
  try {
    await getRedis().del(vocabKey(storeId));
  } catch {
    // The entry expires on its own soon enough.
  }
}

export type SearchStep = "exact" | "synonym" | "corrected" | "partial" | "semantic";

export interface SearchPlan {
  /** The rungs to try, in order. */
  attempts: { step: SearchStep; text: string }[];
  /** What correcting the query changed, when it did. */
  correction: Correction | null;
  /** The words searched for beyond the ones typed, for "we also looked for ...". */
  alsoSearched: string[];
}

/**
 * Works out what to search for, in order, without touching the database. Separated from running the
 * queries so the whole decision can be tested on its own.
 */
export function planSearch(raw: string, vocabulary: string[]): SearchPlan {
  const tokens = tokenise(raw);
  if (tokens.length === 0) return { attempts: [], correction: null, alsoSearched: [] };

  const attempts: { step: SearchStep; text: string }[] = [{ step: "exact", text: toTextQuery(tokens) }];

  const expanded = expandAll(tokens);
  const alsoSearched = expanded.filter((w) => !tokens.includes(w));
  if (hasSynonym(tokens)) attempts.push({ step: "synonym", text: toTextQuery(expanded) });

  // Correcting is tried against the typed words, and against their known meanings too, so
  // "ketlee" still reaches "kettle" by way of "ketli".
  const correction = correct(tokens, vocabulary);
  if (correction.changes.length > 0) {
    const correctedTokens = tokenise(correction.corrected);
    attempts.push({ step: "corrected", text: toTextQuery(expandAll(correctedTokens)) });
  }

  return { attempts, correction: correction.changes.length > 0 ? correction : null, alsoSearched };
}

export interface SearchOutcome {
  /** How the results were found; "none" when nothing matched at any rung. */
  step: SearchStep | "none";
  /** The Mongo filter to use, merged with the caller's own filters. */
  filter: Record<string, unknown> | null;
  /** True when results should be ranked by text score (only the `$text` rungs can be). */
  ranked: boolean;
  /** Set when the query was corrected: what to show as "Showing results for ...". */
  correctedTo: string | null;
  changes: { from: string; to: string }[];
  alsoSearched: string[];
}

/**
 * Walks the ladder against the store's catalogue and returns the first rung that matches anything.
 * `base` is the caller's own filtering (store, category, price, stock), so a rung only counts as a
 * match when it finds something the shopper could actually be shown.
 */
export async function runLadder(storeId: string, raw: string, base: Record<string, unknown>, opts: { exact?: boolean } = {}): Promise<SearchOutcome> {
  // "Take me literally": the words as typed and a contains match, and nothing interpreted.
  const vocabulary = opts.exact ? [] : await vocabularyFor(storeId);
  const plan = opts.exact ? { attempts: planSearch(raw, []).attempts.slice(0, 1), correction: null, alsoSearched: [] } : planSearch(raw, vocabulary);
  const empty: SearchOutcome = { step: "none", filter: null, ranked: false, correctedTo: null, changes: [], alsoSearched: [] };
  if (plan.attempts.length === 0) return empty;

  for (const attempt of plan.attempts) {
    const filter = { ...base, $text: { $search: attempt.text } };
    if ((await Product.countDocuments(filter)) > 0) {
      const corrected = attempt.step === "corrected";
      return {
        step: attempt.step,
        filter,
        ranked: true,
        correctedTo: corrected ? (plan.correction?.corrected ?? null) : null,
        changes: corrected ? (plan.correction?.changes ?? []) : [],
        alsoSearched: attempt.step === "synonym" ? plan.alsoSearched : [],
      };
    }
  }

  // Last rung: a plain contains match, which finds part of a word ("cer" in "Ceramic") where the
  // word index cannot. Escaped, so a query full of regex characters is plain text.
  const contains = new RegExp(escapeRegex(normalise(raw)), "i");
  const filter = { ...base, $or: [{ title: contains }, { category: contains }] };
  if ((await Product.countDocuments(filter)) > 0) {
    return { ...empty, step: "partial", filter, correctedTo: null };
  }
  return empty;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How many semantic matches are worth showing when the words themselves found nothing. */
const SEMANTIC_LIMIT = 24;

/**
 * The last resort, and the only part of search that leaves this process (Part F's stretch): when the
 * words found nothing at all, ask the recommendation service for products that *mean* something like
 * the query. "something to keep tea warm" finds a flask; no amount of spelling correction would.
 *
 * It runs only after every keyword rung has failed, so keyword search never waits on it and never
 * depends on it. If the service is slow, down, or not configured, this returns null and the shopper
 * simply gets the empty result they would have got anyway. It costs nothing from the store's AI
 * allowance: the embeddings are computed locally by the Python service, not by Anthropic.
 */
export async function semanticIds(storeId: string, raw: string): Promise<string[] | null> {
  const query = normalise(raw);
  if (!query) return null;
  try {
    const { getRecommendationClient } = await import("../../lib/recommendationClient");
    const hits = await getRecommendationClient().search(storeId, query, SEMANTIC_LIMIT);
    return hits.length > 0 ? hits.map((h) => h.productId) : null;
  } catch {
    // Not configured, unreachable, or too slow: keyword search has already had its say.
    return null;
  }
}
