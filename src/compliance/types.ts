/**
 * Core domain types for break-compliance analysis.
 * All durations are decimal hours (e.g. 0.5 = 30 minutes).
 */

/** A raw CSV row as produced by PapaParse with `header: true`. */
export type RawRow = Record<string, string | undefined>;

/** A timestamp from the export, kept as local wall-clock time (no time zone). */
export interface WallClock {
  /** Minutes since 1970-01-01 00:00, computed from the wall-clock parts. Used for ordering and gaps. */
  minutes: number;
  /** Calendar date, ISO format: YYYY-MM-DD. */
  isoDate: string;
  /** The original text from the CSV, e.g. "9/29/26 9:08 AM". */
  text: string;
}

/** One clock-in/clock-out punch pair (one CSV row). */
export interface TimeEntry {
  /** 1-based line number in the CSV (header is line 1). */
  line: number;
  employeeKey: string;
  employeeName: string;
  jobTitle: string;
  start: WallClock;
  end: WallClock;
  /** Elapsed time between in and out, including unpaid breaks. */
  totalHours: number;
  unpaidBreakHours: number;
  paidBreakHours: number;
  /** Time actually worked: totalHours - unpaidBreakHours. */
  workedHours: number;
}

/** All of one employee's time entries that belong to one workday. */
export interface Workday {
  employeeKey: string;
  employeeName: string;
  /** ISO date of the workday (date of the first clock-in). */
  isoDate: string;
  /** Short display date, e.g. "9/29/26". */
  displayDate: string;
  entries: TimeEntry[];
  /** Sum of Total Hours across the day's punches (time on the clock, including unpaid breaks). */
  totalHours: number;
  /** Sum of Unpaid Break Time across the day's punches. */
  unpaidBreakHours: number;
  /** Time clocked out between punches, counting only gaps long enough to be a break. */
  clockOutBreakHours: number;
  /** unpaidBreakHours + clockOutBreakHours. */
  breakHours: number;
  jobTitles: string[];
}

export type MealIssueCode = "MISSED_FIRST_MEAL" | "MISSED_SECOND_MEAL";

export interface MealIssue {
  code: MealIssueCode;
  /** Which meal period: 1 = first, 2 = second. */
  meal: 1 | 2;
  /** True when the shift is too long for a meal waiver to cover the issue. */
  critical: boolean;
  message: string;
}

/**
 * - "critical": at least one issue that no waiver can cover.
 * - "waivable": every issue could be covered by a valid signed waiver.
 * - "compliant": nothing to report.
 */
export type DayStatus = "critical" | "waivable" | "compliant";

export interface DayResult {
  workday: Workday;
  status: DayStatus;
  issues: MealIssue[];
}

export interface AnalysisSummary {
  criticalDays: number;
  waivableDays: number;
}

export interface AnalysisResult {
  /** Every workday with its result, sorted by employee then date. */
  days: DayResult[];
  summary: AnalysisSummary;
}
