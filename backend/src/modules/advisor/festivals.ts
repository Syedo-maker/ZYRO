/**
 * Pakistan's big shopping moments, for the Growth Advisor (Part C). Islamic dates come from Node's
 * built-in Umm al-Qura calendar (Intl, no library). Pakistan follows its own moon sighting, which
 * can put a festival a day or two after the calculated date, so every Islamic date is marked
 * approximate and tips say "around". Fixed dates (14 August, the wedding season) are exact.
 */

export interface Festival {
  key: string;
  name: string;
  /** The day it starts, "YYYY-MM-DD" (UTC). */
  date: string;
  daysAway: number;
  approximate: boolean;
  /** What merchants usually do for it: plain advice, never a claim about this store. */
  advice: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });

function hijriParts(d: Date): { month: number; day: number } {
  const parts = Object.fromEntries(hijri.formatToParts(d).map((p) => [p.type, p.value]));
  return { month: Number(parts.month), day: Number(parts.day) };
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The next day on or after `from` that falls on the given Hijri month and day (within 400 days). */
function nextHijri(from: Date, month: number, day: number): Date | null {
  for (let i = 0; i <= 400; i++) {
    const d = new Date(from.getTime() + i * DAY_MS);
    const p = hijriParts(d);
    if (p.month === month && p.day === day) return d;
  }
  return null;
}

/** The next time a fixed day of the year comes round, on or after `from`. */
function nextFixed(from: Date, month: number, day: number): Date {
  const thisYear = new Date(Date.UTC(from.getUTCFullYear(), month - 1, day));
  return thisYear >= from ? thisYear : new Date(Date.UTC(from.getUTCFullYear() + 1, month - 1, day));
}

const ISLAMIC = [
  { key: "ramzan", name: "Ramzan", month: 9, day: 1, advice: "Shoppers buy food, dates, prayer items and Eid clothes through the month; stock up early and plan an Iftar-time or Ramzan offer." },
  { key: "eid-ul-fitr", name: "Eid ul Fitr", month: 10, day: 1, advice: "The biggest buying rush of the year is in the last two weeks before it: clothes, shoes, gifts and sweets." },
  { key: "eid-ul-adha", name: "Eid ul Adha", month: 12, day: 10, advice: "Demand rises for kitchen items, spices, clothes and gifts; order stock well before couriers get busy." },
];

const FIXED = [
  { key: "independence-day", name: "Independence Day (14 August)", month: 8, day: 14, advice: "Green and white items, flags and themed offers sell in the week before." },
  { key: "wedding-season", name: "the wedding season", month: 11, day: 1, advice: "November to February is wedding season: formal wear, jewellery, gifts and home items sell more." },
];

/** Festivals starting between `minDays` and `maxDays` from `now`, soonest first: far enough ahead to act, near enough to matter. */
export function upcomingFestivals(now: Date, minDays = 14, maxDays = 42): Festival[] {
  const today = startOfDay(now);
  const out: Festival[] = [];
  for (const f of ISLAMIC) {
    const d = nextHijri(today, f.month, f.day);
    if (d) out.push({ key: f.key, name: f.name, date: iso(d), daysAway: Math.round((d.getTime() - today.getTime()) / DAY_MS), approximate: true, advice: f.advice });
  }
  for (const f of FIXED) {
    const d = nextFixed(today, f.month, f.day);
    out.push({ key: f.key, name: f.name, date: iso(d), daysAway: Math.round((d.getTime() - today.getTime()) / DAY_MS), approximate: false, advice: f.advice });
  }
  return out.filter((f) => f.daysAway >= minDays && f.daysAway <= maxDays).sort((a, b) => a.daysAway - b.daysAway);
}
