/**
 * The prepared examples behind the landing page's trending-suggestions demo.
 *
 * The demo has to show a stranger what the real "Write with AI" feature does, without a login, a
 * shop, or any store's AI allowance being spent. These phrases are the ones the page offers as
 * clickable chips, so almost every visitor is answered from a cache that was filled once, ahead of
 * time, by `scripts/seed-demo-ideas.ts`.
 *
 * They are chosen to be things people in Pakistan actually sell, so the demo reads as real rather
 * than as a toy, and spread across categories so the keyword sources have something to say about
 * each one.
 */

export interface DemoExample {
  /** What the visitor sees on the chip, and what fills the input when they click it. */
  phrase: string;
  /** The category the suggestions are generated for; must match how the real form sends one. */
  category: string;
}

export const DEMO_EXAMPLES: DemoExample[] = [
  { phrase: "lawn suit", category: "clothing" },
  { phrase: "handmade khussa", category: "footwear" },
  { phrase: "clay chai cups", category: "home and kitchen" },
  { phrase: "phone cover", category: "mobile accessories" },
  { phrase: "chocolate fudge cake", category: "bakery" },
  { phrase: "silver jhumka earrings", category: "jewellery" },
];

/**
 * Normalises what a visitor typed so two spellings of the same thing share one cached answer, and
 * so a phrase can be used inside a Redis key. Deliberately strict: anything left is lowercase
 * letters, digits and single spaces.
 */
export function normaliseDemoPhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

/** The prepared example for a phrase, if it is one of them. */
export function findExample(phrase: string): DemoExample | undefined {
  const wanted = normaliseDemoPhrase(phrase);
  return DEMO_EXAMPLES.find((e) => normaliseDemoPhrase(e.phrase) === wanted);
}

/**
 * The example to fall back on when a typed phrase cannot be answered live (the daily cap is spent,
 * the AI is down, or it took too long). Picks the one sharing the most words with what they typed,
 * so somebody who typed "cotton lawn kurta" is shown the lawn suit example rather than a cake.
 * Falls back to the first example when nothing overlaps at all.
 */
export function nearestExample(phrase: string): DemoExample {
  const words = new Set(normaliseDemoPhrase(phrase).split(" ").filter(Boolean));
  let best = DEMO_EXAMPLES[0];
  let bestScore = 0;
  for (const example of DEMO_EXAMPLES) {
    const score = normaliseDemoPhrase(`${example.phrase} ${example.category}`)
      .split(" ")
      .filter((w) => words.has(w)).length;
    if (score > bestScore) {
      best = example;
      bestScore = score;
    }
  }
  return best;
}
