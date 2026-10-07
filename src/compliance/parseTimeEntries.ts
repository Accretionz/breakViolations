import type { RawRow, TimeEntry, WallClock } from "./types.ts";

/** Columns the analysis needs, with the header names we accept for each. */
const COLUMN_ALIASES = {
  employee: ["employee", "employee name", "name"],
  jobTitle: ["job title", "job", "position"],
  inDate: ["in date", "clock in", "in"],
  outDate: ["out date", "clock out", "out"],
  totalHours: ["total hours"],
  unpaidBreak: ["unpaid break time", "unpaid break", "unpaid break hours"],
  paidBreak: ["paid break time", "paid break", "paid break hours"],
  payableHours: ["payable hours"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;
const REQUIRED: ColumnKey[] = ["employee", "inDate", "outDate", "totalHours", "unpaidBreak"];

export type ColumnMap = Partial<Record<ColumnKey, string>>;

const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Match CSV headers to the columns we need. Exact (case-insensitive) matches only, to avoid guessing wrong. */
export function mapColumns(headers: string[]): { columns: ColumnMap; missing: ColumnKey[] } {
  const byNorm = new Map(headers.map((h) => [normHeader(h), h]));
  const columns: ColumnMap = {};
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    const hit = COLUMN_ALIASES[key].find((alias) => byNorm.has(alias));
    if (hit) columns[key] = byNorm.get(hit);
  }
  const missing = REQUIRED.filter((k) => !columns[k]);
  return { columns, missing };
}

/** "Bryant , Devon " -> "Bryant, Devon" */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Parse "9/29/26 9:08 AM" (also 4-digit years, seconds, and 24-hour times). */
export function parseWallClock(text: string): WallClock | null {
  const m = text
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ampm] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || Number(mi) > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, Number(mi), Number(s ?? 0));
  return { minutes: ms / 60000, isoDate: `${year}-${pad(month)}-${pad(day)}`, text: text.trim() };
}

/** Parse a decimal-hours cell. Also accepts "h:mm" in case another export uses it. */
export function parseHours(text: string | undefined): number | null {
  const t = (text ?? "").trim();
  if (t === "") return 0;
  const hm = t.match(/^(\d+):(\d{2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface ParseResult {
  entries: TimeEntry[];
  errors: string[];
}

/** Rows that are blank, unreadable or zero-length (e.g. job-switch punches) are skipped. */
export function parseTimeEntries(rows: RawRow[], headers: string[]): ParseResult {
  const { columns, missing } = mapColumns(headers);
  if (missing.length) {
    return {
      entries: [],
      errors: [`Missing required column(s): ${missing.join(", ")}. Found: ${headers.join(", ")}`],
    };
  }

  const entries: TimeEntry[] = [];
  const get = (row: RawRow, key: ColumnKey) => (columns[key] ? (row[columns[key]] ?? "") : "");

  rows.forEach((row, i) => {
    const name = normalizeName(get(row, "employee"));
    const start = parseWallClock(get(row, "inDate"));
    const end = parseWallClock(get(row, "outDate"));
    const totalHours = parseHours(get(row, "totalHours"));
    const unpaid = parseHours(get(row, "unpaidBreak"));
    if (!name || !start || !end || totalHours === null || unpaid === null || totalHours <= 0) return;

    entries.push({
      line: i + 2,
      employeeKey: name.toLowerCase(),
      employeeName: name,
      jobTitle: get(row, "jobTitle").trim(),
      start,
      end,
      totalHours,
      unpaidBreakHours: unpaid,
      paidBreakHours: parseHours(get(row, "paidBreak")) ?? 0,
      workedHours: Math.max(0, totalHours - unpaid),
    });
  });

  return { entries, errors: [] };
}
