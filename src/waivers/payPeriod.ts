import type { DayResult } from "../compliance/index.ts";

/** A pay period as ISO dates (YYYY-MM-DD), inclusive. */
export interface PayPeriod {
  start: string;
  end: string;
}

/** Pay-period folders are named "2026-09-21 to 2026-10-04" so they sort by date. */
export const PAY_PERIOD_FOLDER_RE = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/;

export const payPeriodFolderName = (p: PayPeriod) => `${p.start} to ${p.end}`;

export function parsePayPeriodFolderName(name: string): PayPeriod | null {
  const m = name.match(PAY_PERIOD_FOLDER_RE);
  return m ? { start: m[1], end: m[2] } : null;
}

/** "TimeEntries_2026_09_21-2026_10_04.csv" -> 2026-09-21 to 2026-10-04 */
export function payPeriodFromFileName(fileName: string): PayPeriod | null {
  const m = fileName.match(/(\d{4})[_-](\d{2})[_-](\d{2})\s*-\s*(\d{4})[_-](\d{2})[_-](\d{2})/);
  if (!m) return null;
  const start = `${m[1]}-${m[2]}-${m[3]}`;
  const end = `${m[4]}-${m[5]}-${m[6]}`;
  return start <= end ? { start, end } : null;
}

/** Fallback when the file name has no dates: first to last workday in the CSV. */
export function payPeriodFromDays(days: DayResult[]): PayPeriod | null {
  if (!days.length) return null;
  const dates = days.map((d) => d.workday.isoDate).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

export const isInPayPeriod = (isoDate: string, p: PayPeriod) => isoDate >= p.start && isoDate <= p.end;

/** "9/21/26 – 10/4/26" */
export function payPeriodLabel(p: PayPeriod): string {
  const short = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}/${d}/${String(y).slice(-2)}`;
  };
  return `${short(p.start)} – ${short(p.end)}`;
}
