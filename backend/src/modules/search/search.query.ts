/**
 * Understanding what a shopper typed (Part F). Pure functions, no database and no AI, so search keeps
 * working with no Anthropic key, no quota and no Python service: that is the part's own rule.
 *
 * Three things go wrong with search in a Pakistani shop, in order of how often they happen:
 *
 * 1. **Typos.** Most shoppers are on a phone. "ceramik", "kettel", "chai cpu" all find nothing in a
 *    plain word index, because `$text` matches whole words only.
 * 2. **Roman Urdu.** A shopper types what they say: "ketli", "piyali", "chaye", "joota". The product
 *    is titled "Kettle", "Cup", "Tea", "Shoes". Not one character matches.
 * 3. **Plurals and spelling variants.** "mugs", "colour" and "jewellery" against "mug", "color",
 *    "jewelry".
 *
 * None of that needs a model. It needs a dictionary and an edit distance, which is what this is.
 */

/** Arabic-Indic and Urdu digits, so "۲" and "٢" both read as "2". */
const EASTERN_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/**
 * What a query means as plain words: lowercase, eastern digits as Latin, punctuation gone, spaces
 * collapsed. Urdu and Arabic letters are kept, so a store whose titles are in Urdu still searches.
 */
export function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[٠-٩۰-۹]/g, (d) => EASTERN_DIGITS[d] ?? d)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export const tokenise = (raw: string): string[] => (normalise(raw) ? normalise(raw).split(" ") : []);

/**
 * Words a shopper is likely to type, and the catalogue words they mean. Roman Urdu has no fixed
 * spelling, so the common spellings are all listed rather than guessed at with a transliteration
 * algorithm, which would produce far more wrong answers than right ones.
 *
 * Each entry maps one typed word to the words to search for as well. It is one-way on purpose:
 * searching "kettle" should not drag in everything mapped to it, only the other way round.
 */
const SYNONYMS: Record<string, string[]> = {
  // Tea and kitchen: the biggest category in small Pakistani shops.
  ketli: ["kettle"], kettli: ["kettle"], kitli: ["kettle"],
  chaye: ["tea", "chai"], chai: ["tea"], chae: ["tea", "chai"],
  piyali: ["cup", "mug"], pyali: ["cup", "mug"], kappi: ["cup"],
  bartan: ["utensil", "dish", "pot", "cookware"],
  handi: ["pot", "cookware"], degchi: ["pot", "saucepan"], deg: ["pot"],
  chamach: ["spoon"], chamcha: ["spoon"], chammach: ["spoon"],
  thali: ["plate", "tray"], plait: ["plate"],
  glas: ["glass"], gilas: ["glass"],
  // Clothes and shoes.
  kapra: ["cloth", "fabric"], kapray: ["clothes", "clothing"], kapre: ["clothes", "clothing"],
  joota: ["shoe", "shoes"], jutay: ["shoes"], jootay: ["shoes"], jooti: ["shoe", "shoes"],
  chappal: ["slipper", "sandal"], chapal: ["slipper", "sandal"],
  kurta: ["shirt", "kurta"], shalwar: ["shalwar", "trouser"], dupatta: ["scarf", "dupatta"],
  // Everyday goods.
  kitab: ["book"], kitaab: ["book"], qalam: ["pen"], pencil: ["pencil"],
  ghari: ["watch", "clock"], gharri: ["watch", "clock"],
  batti: ["light", "bulb", "lamp"], bulb: ["bulb", "light"],
  pankha: ["fan"], panka: ["fan"],
  sabun: ["soap"], saboon: ["soap"], tel: ["oil"],
  // English spelling variants, both ways round, because both are written here.
  colour: ["color"], color: ["colour"], jewellery: ["jewelry"], jewelry: ["jewellery"],
};

/** The catalogue words a typed word could mean. The word itself always comes first. */
export function expand(token: string): string[] {
  const extra = SYNONYMS[token] ?? [];
  return [token, ...extra.filter((w) => w !== token)];
}

/** True when any word in the query has a known alternative, so expanding is worth a second query. */
export const hasSynonym = (tokens: string[]): boolean => tokens.some((t) => (SYNONYMS[t]?.length ?? 0) > 0);

/**
 * Levenshtein distance, stopping as soon as it passes `max`. Short-circuiting matters: this runs
 * against every word in a store's catalogue, and most of them are nothing like the query.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** How far a word of this length may be from a catalogue word and still be the same word. */
export function allowedDistance(word: string): number {
  if (word.length <= 3) return 0; // "cup" and "cap" are different products, not a typo
  if (word.length <= 6) return 1;
  return 2;
}

/**
 * The catalogue word a mistyped word most likely meant, or null. Ties are broken by the shorter
 * word and then alphabetically, so the same query always gives the same answer.
 */
export function closestWord(token: string, vocabulary: string[]): string | null {
  const max = allowedDistance(token);
  if (max === 0) return null;
  let best: { word: string; distance: number } | null = null;
  for (const word of vocabulary) {
    if (word === token) return null; // it is a real word; nothing to correct
    const d = editDistance(token, word, max);
    if (d > max) continue;
    if (!best || d < best.distance || (d === best.distance && (word.length < best.word.length || (word.length === best.word.length && word < best.word)))) {
      best = { word, distance: d };
    }
  }
  return best?.word ?? null;
}

export interface Correction {
  /** The query with mistyped words replaced. */
  corrected: string;
  /** What was changed, for "Showing results for ...". Empty when nothing was. */
  changes: { from: string; to: string }[];
}

/** Replaces words that are not in the store's catalogue with the closest ones that are. */
export function correct(tokens: string[], vocabulary: string[]): Correction {
  const known = new Set(vocabulary);
  const changes: { from: string; to: string }[] = [];
  const corrected = tokens.map((t) => {
    if (known.has(t)) return t;
    const fix = closestWord(t, vocabulary);
    if (!fix) return t;
    changes.push({ from: t, to: fix });
    return fix;
  });
  return { corrected: corrected.join(" "), changes };
}

/**
 * The words to hand MongoDB's `$text`. Words are space-separated, which `$text` reads as "any of
 * these", and the index's own weights (title above category above description) do the ranking.
 */
export const toTextQuery = (tokens: string[]): string => [...new Set(tokens)].join(" ");

/** Every word worth looking for, once the synonyms are added. */
export const expandAll = (tokens: string[]): string[] => [...new Set(tokens.flatMap(expand))];
