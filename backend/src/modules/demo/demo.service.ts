import { getRedis } from "../../lib/redis";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { normaliseCategory } from "../trends/trends.aggregate";
import { trendingKeywords } from "../ideas/keywords.sources";
import { buildIdeasPrompt, creditedKeywords, parseSuggestions, SUGGESTION_COUNT } from "../ideas/ideas.service";
import { DEMO_EXAMPLES, findExample, nearestExample, normaliseDemoPhrase, type DemoExample } from "./demo.examples";

/**
 * The landing page's trending-suggestions demo.
 *
 * It has to show a stranger the real feature, with no login and no shop, and it must never spend a
 * merchant's AI allowance or run up an unbounded bill. Four layers do that, in order:
 *
 * 1. **Prepared examples**, generated once ahead of time by `scripts/seed-demo-ideas.ts` and kept in
 *    Redis. The page offers them as chips, so nearly every visitor costs nothing at all.
 * 2. **Cache first** for anything typed: an identical phrase is answered from Redis.
 * 3. **Two limits** on a cache miss: per visitor, and a **global daily cap across every visitor**.
 *    The global cap is the real cost ceiling and the thing that survives being scraped.
 * 4. **The platform pays** for the one call that gets through (`billedTo: "platform"`, the flag the
 *    Growth Advisor already uses), so no store's quota is touched, and the call has a timeout.
 *
 * When a live answer cannot be had, the demo shows the nearest prepared example and **says so**,
 * rather than failing or inventing something. The suggestions themselves come from the same prompt,
 * the same parser and the same keyword sources as the real "Write with AI" feature; only the way it
 * is paid for and rationed is different.
 */

/** How many suggestions the landing page shows. The real form shows four; three fits the hero. */
export const DEMO_SUGGESTIONS = 3;
/** A cached answer is good for a week: the keyword sources themselves only refresh daily. */
const CACHE_SECONDS = 7 * 24 * 60 * 60;
/** Live generations allowed per visitor per hour. */
const PER_VISITOR_PER_HOUR = 3;
/** Live generations allowed across every visitor per day. The actual ceiling on what this can cost. */
const GLOBAL_PER_DAY = 100;
/** A visitor should not watch a spinner longer than this; after it, they get a prepared example. */
const TIMEOUT_MS = 8_000;
/** The demo speaks to Pakistan, so keywords come from the PKR market. */
const DEMO_MARKET = "PKR";

const cacheKey = (phrase: string, category: string) => `demo:ideas:${category}:${phrase}`;
const visitorKey = (visitor: string) => `demo:rate:visitor:${visitor}`;
const globalKey = (day: string) => `demo:rate:day:${day}`;
const today = () => new Date().toISOString().slice(0, 10);

export interface DemoSuggestion {
  title: string;
  description: string;
  keywordsUsed: string[];
}

export interface DemoResult {
  phrase: string;
  category: string;
  suggestions: DemoSuggestion[];
  /** The keywords the suggestions were built from. Words only: never a volume or a score. */
  keywords: string[];
  trendDataAvailable: boolean;
  /**
   * How this answer was produced, so the page can be honest about it:
   * - `live`: generated just now for this phrase.
   * - `cached`: an identical phrase was generated before.
   * - `example`: a prepared example, because the demo could not generate live.
   */
  origin: "live" | "cached" | "example";
  /** Set when `origin` is `example`, in words the page can show. */
  note: string | null;
}

/** Reads a cached answer, or null. A Redis failure is a miss, never an error. */
async function readCache(phrase: string, category: string): Promise<DemoResult | null> {
  try {
    const hit = await getRedis().get(cacheKey(phrase, category));
    return hit ? (JSON.parse(hit) as DemoResult) : null;
  } catch {
    return null;
  }
}

async function writeCache(phrase: string, category: string, result: DemoResult): Promise<void> {
  try {
    await getRedis().set(cacheKey(phrase, category), JSON.stringify(result), "EX", CACHE_SECONDS);
  } catch {
    // Not caching it is not a reason to fail the request.
  }
}

/**
 * Whether one more live generation is allowed, counting it if so.
 *
 * Both counters are incremented with an expiry, so they clean themselves up. If Redis is
 * unreachable the answer is **no**: unlike a login limiter, where failing open keeps people able to
 * sign in, failing open here would mean an unbounded AI bill. A visitor then gets a prepared
 * example, which is a perfectly good demo.
 */
type Claim = "ok" | "visitor_spent" | "global_spent" | "unavailable";

async function claimLiveGeneration(visitor: string): Promise<Claim> {
  try {
    const redis = getRedis();
    const vKey = visitorKey(visitor);
    const gKey = globalKey(today());

    const visitorCount = await redis.incr(vKey);
    if (visitorCount === 1) await redis.expire(vKey, 60 * 60);
    if (visitorCount > PER_VISITOR_PER_HOUR) return "visitor_spent";

    const globalCount = await redis.incr(gKey);
    if (globalCount === 1) await redis.expire(gKey, 2 * 24 * 60 * 60);
    if (globalCount > GLOBAL_PER_DAY) return "global_spent";

    return "ok";
  } catch {
    return "unavailable";
  }
}

/** Why a visitor is seeing a saved example instead of a fresh one, in words, and accurately. */
const CLAIM_NOTES: Record<Exclude<Claim, "ok">, string> = {
  visitor_spent: "You have tried a few of your own ideas, so this one is a saved example. Sign up to use it on your own products with no limit like this.",
  global_spent: "The demo has a daily limit across all visitors, so this is a saved example. Sign up to try it on your own products.",
  unavailable: "The live demo is resting, so this is a saved example. Sign up to try it on your own products.",
};

/** The prepared example's answer: from the cache if seeded, otherwise generated and cached now. */
async function exampleResult(example: DemoExample, note: string | null): Promise<DemoResult> {
  const phrase = normaliseDemoPhrase(example.phrase);
  const category = normaliseCategory(example.category);
  const cached = await readCache(phrase, category);
  if (cached) return { ...cached, origin: "example", note };

  // Not seeded yet (a fresh deployment, or Redis was cleared). Generate it once, cache it, and from
  // then on this example costs nothing. Still paid for by the platform, never by a store.
  const generated = await generateLive(phrase, category);
  if (generated) {
    await writeCache(phrase, category, generated);
    return { ...generated, origin: "example", note };
  }

  // The AI is unavailable and nothing is cached: show the keywords alone rather than nothing, and
  // say plainly that the suggestions could not be written.
  const keywordSet = await trendingKeywords(DEMO_MARKET, category);
  return {
    phrase,
    category,
    suggestions: [],
    keywords: keywordSet.keywords.map((k) => k.word),
    trendDataAvailable: !keywordSet.empty,
    origin: "example",
    note: "The live demo is unavailable right now. Sign up to try it on your own products.",
  };
}

/** One AI call through the normal orchestrator, paid for by the platform. Null if it fails or times out. */
async function generateLive(phrase: string, category: string): Promise<DemoResult | null> {
  const keywordSet = await trendingKeywords(DEMO_MARKET, category);

  const { system, prompt } = buildIdeasPrompt();
  try {
    const result = await Promise.race([
      aiGenerate({
        // A platform-owned call: `billedTo: "platform"` means the orchestrator reserves no quota,
        // spends none, and records no tokens, so this id is only a label and nothing tenant-scoped
        // is ever written against it.
        tenantId: "platform-demo",
        promptType: "product_ideas",
        system,
        prompt: prompt({ title: phrase, category }, keywordSet, DEMO_MARKET),
        maxTokens: 1600,
        billedTo: "platform",
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("demo timeout")), TIMEOUT_MS)),
    ]);

    const suggestions = parseSuggestions(result.text)
      .slice(0, DEMO_SUGGESTIONS)
      .map((s) => ({
        title: s.title,
        description: s.description,
        keywordsUsed: keywordSet.empty ? [] : creditedKeywords(s, keywordSet.keywords),
      }));
    if (suggestions.length === 0) return null;

    return {
      phrase,
      category,
      suggestions,
      // Words only. The weights behind the ordering are never sent to a browser, here or in the
      // real feature: they are not search volumes and must not be read as any.
      keywords: keywordSet.keywords.map((k) => k.word),
      trendDataAvailable: !keywordSet.empty,
      origin: "live",
      note: null,
    };
  } catch (err) {
    console.error(`[demo] could not generate suggestions for ${phrase}: ${(err as Error).message}`);
    return null;
  }
}

export const demoService = {
  /** The chips the page offers. Answering one of these never costs anything once seeded. */
  examples: () => DEMO_EXAMPLES.map((e) => ({ phrase: e.phrase, category: e.category })),

  /**
   * Suggestions for whatever the visitor typed. Never throws for an ordinary reason: a spent limit,
   * a missing category or an AI outage all come back as a prepared example with a note.
   */
  async suggest(rawPhrase: string, rawCategory: string | undefined, visitor: string): Promise<DemoResult> {
    const phrase = normaliseDemoPhrase(rawPhrase);
    if (phrase.length < 2) return exampleResult(DEMO_EXAMPLES[0], "Type a product name to see suggestions for it.");

    // A prepared example: answered from the cache, costing nothing.
    const prepared = findExample(phrase);
    if (prepared) return exampleResult(prepared, null);

    const category = normaliseCategory(rawCategory ?? phrase);

    // Somebody has asked for this exact thing before.
    const cached = await readCache(phrase, category);
    if (cached) return { ...cached, origin: "cached", note: null };

    // Something new: only if there is room in both budgets.
    const claim = await claimLiveGeneration(visitor);
    if (claim !== "ok") return exampleResult(nearestExample(phrase), CLAIM_NOTES[claim]);

    const live = await generateLive(phrase, category);
    if (!live) {
      return exampleResult(nearestExample(phrase), "The live demo could not answer just now, so this is a saved example.");
    }

    await writeCache(phrase, category, live);
    return live;
  },
};

/** Used by the seed script and the tests. */
export const demoInternals = { cacheKey, generateLive, writeCache, readCache, DEMO_MARKET, GLOBAL_PER_DAY, PER_VISITOR_PER_HOUR, SUGGESTION_COUNT };
