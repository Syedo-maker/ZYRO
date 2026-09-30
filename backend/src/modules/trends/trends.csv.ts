/**
 * Reads the CSV that trends.google.com's "Download" button gives for an "Interest over time" chart.
 * Google Trends has no self-serve API (the official one is an invite-only alpha), so a platform
 * administrator downloads this file and imports it; nothing is scraped.
 *
 * The file has looked like this for years, and the parser is lenient about the details:
 *
 *   Category: All categories
 *
 *   Week,chai cup: (Pakistan),kettle: (Pakistan)
 *   2025-10-05,45,12
 *   2025-10-12,<1,14
 *
 * The date column may be called Week, Month, Day or Time; dates may be "YYYY-MM-DD" or "YYYY-MM"
 * (monthly data, read as the 1st); "<1" means under 1 and is read as 0.5. Newer exports sometimes
 * quote every cell and drop the ": (Region)" suffix; both are handled.
 */

export interface TrendSeries {
  term: string;
  points: { date: string; value: number }[];
}

export interface ParsedTrendsFile {
  /** The region named in the column headers ("Pakistan"), or null when the file does not say. */
  geo: string | null;
  series: TrendSeries[];
  /** The last date the file covers, "YYYY-MM-DD". */
  periodEnd: string;
}

export class TrendsFileError extends Error {}

const MAX_TERMS = 5; // Google Trends compares at most five terms
const MAX_ROWS = 2000;

/** Splits one CSV line, honouring double quotes (terms can contain commas). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function toIsoDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ].*)?$/.exec(raw.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3] ?? "01"}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

function toValue(raw: string): number | null {
  const s = raw.trim();
  if (s === "<1") return 0.5;
  if (!/^\d{1,3}(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

export function parseGoogleTrendsCsv(text: string): ParsedTrendsFile {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /^"?(week|month|day|time)"?\s*,/i.test(l.trim()));
  if (headerAt < 0) throw new TrendsFileError("This does not look like a Google Trends 'Interest over time' CSV: no Week, Month, Day or Time column was found.");

  const header = cells(lines[headerAt]).slice(1);
  if (header.length === 0 || header.every((h) => !h)) throw new TrendsFileError("The file has no search terms in its header row.");
  if (header.length > MAX_TERMS) throw new TrendsFileError(`Google Trends compares at most ${MAX_TERMS} terms; this file has ${header.length} columns.`);

  let geo: string | null = null;
  const terms = header.map((h) => {
    const m = /^(.*?):\s*\((.+)\)\s*$/.exec(h);
    if (m) {
      geo ??= m[2].trim();
      return m[1].trim();
    }
    return h.trim();
  });
  if (terms.some((t) => !t || t.length > 100)) throw new TrendsFileError("A search term in the header row is empty or too long.");

  const series: TrendSeries[] = terms.map((term) => ({ term, points: [] }));
  let rows = 0;
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.trim()) continue;
    const row = cells(line);
    const date = toIsoDate(row[0] ?? "");
    if (!date) throw new TrendsFileError(`Could not read the date "${(row[0] ?? "").slice(0, 20)}".`);
    if (++rows > MAX_ROWS) throw new TrendsFileError(`The file has more than ${MAX_ROWS} rows.`);
    terms.forEach((_, i) => {
      const v = toValue(row[i + 1] ?? "");
      if (v === null) throw new TrendsFileError(`Could not read the value "${(row[i + 1] ?? "").slice(0, 10)}" for ${date}; values are 0 to 100 or "<1".`);
      series[i].points.push({ date, value: v });
    });
  }
  if (rows < 2) throw new TrendsFileError("The file needs at least two dates to show a trend.");

  for (const s of series) s.points.sort((a, b) => a.date.localeCompare(b.date));
  return { geo, series, periodEnd: series[0].points[series[0].points.length - 1].date };
}

/**
 * The movement a series shows at its end: the average of the last `recent` points against the average of
 * the `earlier` points before them. Null when there are too few points, or nothing to compare with.
 */
export function seriesChange(points: { date: string; value: number }[], recent = 4, earlier = 12) {
  if (points.length < recent + 2) return null;
  const last = points.slice(-recent);
  const before = points.slice(-(recent + earlier), -recent);
  const avg = (xs: { value: number }[]) => xs.reduce((s, p) => s + p.value, 0) / xs.length;
  const a = avg(last);
  const b = avg(before);
  if (b <= 0) return null;
  return {
    recentAverage: Math.round(a),
    earlierAverage: Math.round(b),
    changePercent: Math.round(((a - b) / b) * 100),
    from: last[0].date,
    to: last[last.length - 1].date,
    earlierFrom: before[0].date,
    recentPoints: last.length,
    earlierPoints: before.length,
  };
}
