import { prisma } from "../../lib/prisma";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { normaliseCategory } from "../trends/trends.aggregate";
import { trendingKeywords, type TrendingKeyword } from "./keywords.sources";
import type { ProductIdeaInput } from "./ideas.validation";

/**
 * "Write with AI" on the add-product form (Issue 1).
 *
 * The merchant types whatever they have so far, asks for help, and gets four title and description
 * pairs built around keywords real shoppers really use. Three rules shape all of it:
 *
 * 1. **One request is one AI call and one generation off the quota**, not one per suggestion. The
 *    model returns all four in a single JSON reply.
 * 2. **No invented trends.** Keywords come from keywords.sources.ts, which reports real data or
 *    nothing, and a keyword the model claims to have used is only shown to the merchant if it is
 *    genuinely in the text it wrote (see `creditedKeywords`). The model cannot add to the list.
 * 3. **Nothing is saved.** This endpoint writes no product and no draft. The merchant picks one,
 *    edits it if they like, and saves it through the ordinary create-product endpoint.
 */

/** How many pairs the merchant gets. Four fits the form without scrolling and gives a real choice. */
const SUGGESTION_COUNT = 4;
const MAX_TITLE = 90;
const MAX_DESCRIPTION = 420;

const SYSTEM_PROMPT =
  "You help a small shop owner name and describe a product they are adding to their online shop. " +
  'Reply with only JSON: {"suggestions":[{"title":string,"description":string,"keywordsUsed":[string]}]} ' +
  `with exactly ${SUGGESTION_COUNT} suggestions. ` +
  `Each title is at most ${MAX_TITLE} characters and reads like a real listing, not a slogan. ` +
  "Each description is 2 to 4 plain sentences, no markdown, no headings, no bullet points. " +
  "You may be given a list of popular search words. Work the fitting ones into the title and " +
  "description naturally, the way a person would write them; never repeat a word to pad it out, " +
  "never list words, and never use one that does not fit the product. In keywordsUsed, name only " +
  "the given words you actually wrote into that suggestion. " +
  "Invent no facts: no sizes, materials, origins, prices, delivery promises or guarantees that you " +
  "were not told. If you know nothing about the product, write about it in general terms rather " +
  "than making something up. " +
  "Never claim anything is trending, best selling or popular: you do not know that.";

/** What the merchant had typed when they pressed the button; blank fields are simply left out. */
function describeDraft(input: ProductIdeaInput, currency: string): string {
  const lines: string[] = [];
  if (input.title?.trim()) lines.push(`Working title: ${input.title.trim()}`);
  if (input.category?.trim()) lines.push(`Category: ${input.category.trim()}`);
  if (input.description?.trim()) lines.push(`Notes from the shop owner: ${input.description.trim()}`);
  if (input.tags?.length) lines.push(`Tags: ${input.tags.join(", ")}`);
  if (typeof input.price === "number") lines.push(`Price: ${currency} ${input.price.toFixed(2)}`);
  return lines.length > 0 ? lines.join("\n") : "The shop owner has not filled in any details yet.";
}

interface RawSuggestion {
  title: string;
  description: string;
  keywordsUsed: string[];
}

/** Reads the model's JSON, keeping only entries of the right shape. A bad reply yields an empty list. */
export function parseSuggestions(text: string): RawSuggestion[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];

  const out: RawSuggestion[] = [];
  for (const item of list) {
    const o = item as Record<string, unknown>;
    const title = typeof o?.title === "string" ? o.title.trim().slice(0, MAX_TITLE) : "";
    const description = typeof o?.description === "string" ? o.description.trim().slice(0, MAX_DESCRIPTION) : "";
    if (!title || !description) continue;
    const claimed = Array.isArray(o.keywordsUsed) ? o.keywordsUsed.filter((k): k is string => typeof k === "string") : [];
    out.push({ title, description, keywordsUsed: claimed });
  }
  return out.slice(0, SUGGESTION_COUNT);
}

/**
 * Which keywords this suggestion may be credited with: the ones that came from our own keyword
 * sources AND are really in what the model wrote.
 *
 * The attribution shown to the merchant ("Uses popular searches: lawn suit, 3 piece") is a factual
 * claim, so it is checked rather than taken on trust. A model that pads its keywordsUsed list, or
 * names a word nobody searched for, gets no credit for it.
 */
export function creditedKeywords(suggestion: RawSuggestion, available: TrendingKeyword[]): string[] {
  const haystack = `${suggestion.title} ${suggestion.description}`.toLowerCase();
  const known = new Map(available.map((k) => [k.word.toLowerCase(), k.word]));
  const credited: string[] = [];
  for (const claim of suggestion.keywordsUsed) {
    const word = known.get(claim.trim().toLowerCase());
    if (word && haystack.includes(word.toLowerCase()) && !credited.includes(word)) credited.push(word);
  }
  // A keyword used but not claimed still counts: the merchant is being told what the text contains.
  for (const [lower, word] of known) {
    if (!credited.includes(word) && haystack.includes(lower)) credited.push(word);
  }
  return credited;
}

export interface ProductIdeas {
  suggestions: { title: string; description: string; keywordsUsed: string[] }[];
  /** False when no source had real data for this category; the merchant is told so plainly. */
  trendDataAvailable: boolean;
  /** Which sources contributed, so the merchant can judge where the words came from. */
  sources: string[];
  /** Shown when there is no trend data, instead of leaving the merchant to wonder. */
  notice: string | null;
  model: string;
}

export const ideasService = {
  /**
   * Four suggestions for one AI call. Throws the orchestrator's 402 when the store has no
   * generations left this month; the form then keeps working, by hand (the message says so).
   */
  async suggest(storeId: string, input: ProductIdeaInput): Promise<ProductIdeas> {
    const tenant = await prisma.tenant.findFirst({ where: { id: storeId }, select: { currency: true } });
    const market = tenant?.currency ?? "USD";
    const category = normaliseCategory(input.category);
    const keywordSet = await trendingKeywords(market, category);

    const keywordLines = keywordSet.empty
      ? "No popular search words are available for this category, so use none: write the best plain listing you can from the details above."
      : `Popular search words for this category, most used first: ${keywordSet.keywords.map((k) => k.word).join(", ")}`;

    const result = await aiGenerate({
      tenantId: storeId,
      promptType: "product_ideas",
      system: SYSTEM_PROMPT,
      // One call for all four, so the merchant is charged one generation however many they read.
      prompt: `${describeDraft(input, market)}\n\n${keywordLines}\n\nWrite ${SUGGESTION_COUNT} different title and description pairs.`,
      maxTokens: 1600,
    });

    const suggestions = parseSuggestions(result.text).map((s) => ({
      title: s.title,
      description: s.description,
      keywordsUsed: keywordSet.empty ? [] : creditedKeywords(s, keywordSet.keywords),
    }));

    return {
      suggestions,
      trendDataAvailable: !keywordSet.empty,
      sources: keywordSet.sourcesUsed,
      notice: keywordSet.empty
        ? "We do not have trend data for this category yet, so these suggestions are based only on the details you entered."
        : null,
      model: result.model,
    };
  },

  /** What the form can show before spending anything: the words themselves, and where they came from. */
  async keywords(storeId: string, category: string | undefined) {
    const tenant = await prisma.tenant.findFirst({ where: { id: storeId }, select: { currency: true } });
    const set = await trendingKeywords(tenant?.currency ?? "USD", normaliseCategory(category));
    return {
      keywords: set.keywords.map((k) => ({ word: k.word, source: k.source })),
      sources: set.sourcesUsed,
      trendDataAvailable: !set.empty,
    };
  },
};
