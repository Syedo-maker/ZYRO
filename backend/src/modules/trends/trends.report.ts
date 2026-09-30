import { displayCategory, storeBand, type AggregateOptions, type CategoryTrend } from "./trends.aggregate";
import type { ExternalFact } from "./trends.sources";

/**
 * Turning the week's figures into a report (Part D). The AI is given numbered facts only, each with
 * its source and date, and must end every line with the ids of the facts it used. Its answer is then
 * checked, line by line: every line cites real facts, and every number in a line appears in the facts
 * it cites. One failed check and the whole report is written from the facts themselves instead, so
 * nothing unchecked reaches a merchant. No facts at all means "no data", with no AI call.
 */

export interface Fact {
  id: string;
  kind: "platform" | "external";
  text: string;
  source: string;
  /** The last date the fact covers, "YYYY-MM-DD". */
  date: string;
  url?: string;
}

export interface ReportLine {
  text: string;
  cites: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PLATFORM_SOURCE = "ZYRO sales across stores (anonymised)";

const shortDate = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** The 7 days a report covers: the week before its Monday, as ["YYYY-MM-DD", "YYYY-MM-DD"]. */
export function reportWeek(weekStart: string): [string, string] {
  const monday = Date.parse(`${weekStart}T00:00:00Z`);
  return [new Date(monday - 7 * DAY_MS).toISOString().slice(0, 10), new Date(monday - DAY_MS).toISOString().slice(0, 10)];
}

const movement = (pct: number | null) => (pct === null ? "with nothing to compare against in" : pct === 0 ? "the same as" : `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on`);

/** The numbered facts for one market and category: the platform's own (only if publishable), then each external source's. */
export function buildFacts(trend: CategoryTrend | null, external: ExternalFact[], weekStart: string, opts: AggregateOptions): Fact[] {
  const facts: Omit<Fact, "id">[] = [];
  const [from, to] = reportWeek(weekStart);
  const week = `${shortDate(from)} to ${shortDate(to, true)}`;

  if (trend?.publishable) {
    facts.push({
      kind: "platform",
      text:
        `In the ${trend.market} market, ${displayCategory(trend.category).toLowerCase()} products sold ${trend.currentUnits} units in the week ${week} ` +
        `across ${storeBand(trend.storeCount, opts.minStores)}, ${movement(trend.changePercent)} the weekly average of the ${opts.baselineWeeks} weeks before (${trend.baselineWeeklyUnits}).`,
      source: PLATFORM_SOURCE,
      date: to,
    });
    // Words from the same products move together ("clay", "chai" and "cup" in "Clay Chai Cup"): keywords
    // with exactly the same figures are one fact, not three lines saying the same thing.
    const groups = new Map<string, { words: string[]; k: (typeof trend.rising)[number] }>();
    for (const k of [...trend.rising, ...trend.falling]) {
      const key = `${k.currentUnits}|${k.baselineWeeklyUnits}|${k.changePercent}`;
      const g = groups.get(key);
      if (g) g.words.push(k.keyword);
      else groups.set(key, { words: [k.keyword], k });
    }
    for (const { words, k } of groups.values()) {
      const quoted = words.map((w) => `"${w}"`);
      const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
      facts.push({
        kind: "platform",
        text: `Products with ${list} in the title sold ${k.currentUnits} units in the week ${week}, ${movement(k.changePercent)} their weekly average of the ${opts.baselineWeeks} weeks before (${k.baselineWeeklyUnits}).`,
        source: PLATFORM_SOURCE,
        date: to,
      });
    }
  }
  for (const e of external) facts.push({ kind: "external", text: e.text, source: e.source, date: e.date, ...(e.url ? { url: e.url } : {}) });

  return facts.map((f, i) => ({ id: `F${i + 1}`, ...f }));
}

export const SYSTEM_PROMPT =
  "You write a short weekly market trend report for owners of small shops, in plain English. " +
  "Use ONLY the numbered facts you are given. Write 2 to 4 lines. Each line is one sentence and ends with the ids " +
  "of the facts it uses in square brackets, for example [F1] or [F1, F3]. Every number you write must appear in a " +
  "fact you cite. Do not add any trend, cause, prediction, advice, product, place or number that is not in the facts, " +
  "and do not guess why something changed. If there are no facts, reply exactly: NO_DATA. No markdown, no greeting.";

export function buildPrompt(market: string, category: string, facts: Fact[]): string {
  return (
    `Market: ${market}. Category: ${displayCategory(category)}.\nFacts:\n` +
    (facts.length ? facts.map((f) => `${f.id} (source: ${f.source}; date: ${f.date}): ${f.text}`).join("\n") : "(none)")
  );
}

const numbersIn = (s: string) => (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/**
 * Checks the AI's answer and returns its lines, or null if any line fails: no citation, a cited id that
 * does not exist, or a number that is not in the facts that line cites. Also null for "NO_DATA", an empty
 * answer, or more than 6 lines.
 */
export function checkLines(answer: string, facts: Fact[]): ReportLine[] | null {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const raw = answer
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (raw.length === 0 || raw.length > 6 || raw.some((l) => /^NO_DATA$/i.test(l))) return null;

  const lines: ReportLine[] = [];
  for (const l of raw) {
    const m = /^(.*\S)\s*\[\s*(F\d+(?:\s*,\s*F\d+)*)\s*\]\s*\.?$/.exec(l);
    if (!m) return null;
    const cites = [...new Set(m[2].split(",").map((c) => c.trim()))];
    if (cites.some((c) => !byId.has(c))) return null;
    const allowed = new Set(cites.flatMap((c) => numbersIn(byId.get(c)!.text)));
    if (numbersIn(m[1]).some((n) => !allowed.has(n))) return null;
    lines.push({ text: m[1].replace(/\s+$/, ""), cites });
  }
  return lines;
}

/** The report without the AI: each fact as its own line, citing itself. Always passes checkLines. */
export function templateLines(facts: Fact[]): ReportLine[] {
  return facts.map((f) => ({ text: f.text, cites: [f.id] }));
}
