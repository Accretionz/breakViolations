import type { MealRules } from "./caMealRules.ts";
import type { TimeEntry, Workday } from "./types.ts";

function displayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(-2)}`;
}

/**
 * Group time entries into workdays per employee.
 * A workday is keyed by the date of its first clock-in. An entry that starts on a later date
 * still joins the open workday when it begins within `overnightJoinGapMinutes` of the previous
 * clock-out, so shifts that run past midnight aren't split in two.
 */
export function buildWorkdays(entries: TimeEntry[], rules: MealRules): Workday[] {
  const byEmployee = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const list = byEmployee.get(e.employeeKey) ?? [];
    list.push(e);
    byEmployee.set(e.employeeKey, list);
  }

  const workdays: Workday[] = [];
  for (const list of byEmployee.values()) {
    list.sort((a, b) => a.start.minutes - b.start.minutes);
    let current: TimeEntry[] = [];
    const flush = () => {
      if (current.length) workdays.push(toWorkday(current, rules));
      current = [];
    };
    for (const e of list) {
      const prev = current[current.length - 1];
      const sameDate = prev && e.start.isoDate === current[0].start.isoDate;
      const continues = prev && e.start.minutes - prev.end.minutes <= rules.overnightJoinGapMinutes;
      if (prev && !sameDate && !continues) flush();
      current.push(e);
    }
    flush();
  }

  return workdays.sort(
    (a, b) => a.employeeName.localeCompare(b.employeeName) || a.isoDate.localeCompare(b.isoDate),
  );
}

function toWorkday(entries: TimeEntry[], rules: MealRules): Workday {
  const first = entries[0];
  const sum = (f: (e: TimeEntry) => number) => entries.reduce((s, e) => s + f(e), 0);
  const unpaidBreakHours = sum((e) => e.unpaidBreakHours);
  let clockOutBreakHours = 0;
  for (let i = 1; i < entries.length; i++) {
    const gapMinutes = entries[i].start.minutes - entries[i - 1].end.minutes;
    if (gapMinutes >= rules.clockOutBreakMinMinutes) clockOutBreakHours += gapMinutes / 60;
  }
  return {
    employeeKey: first.employeeKey,
    employeeName: first.employeeName,
    isoDate: first.start.isoDate,
    displayDate: displayDate(first.start.isoDate),
    entries,
    totalHours: sum((e) => e.totalHours),
    unpaidBreakHours,
    clockOutBreakHours,
    breakHours: unpaidBreakHours + clockOutBreakHours,
    jobTitles: [...new Set(entries.map((e) => e.jobTitle).filter(Boolean))],
  };
}
