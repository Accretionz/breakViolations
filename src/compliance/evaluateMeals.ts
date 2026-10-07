import type { MealRules } from "./caMealRules.ts";
import type { DayResult, DayStatus, MealIssue, Workday } from "./types.ts";

const EPS = 1e-6;
const hrs = (h: number) => `${h.toFixed(2)} h`;
const mins = (h: number) => `${Math.round(h * 60)} min`;

function describeBreak(day: Workday): string {
  if (day.breakHours <= EPS) return "no break recorded";
  if (day.clockOutBreakHours <= EPS) return `only ${mins(day.breakHours)} of break`;
  return `only ${mins(day.breakHours)} of break (${mins(day.unpaidBreakHours)} unpaid + ${mins(day.clockOutBreakHours)} clocked out)`;
}

/**
 * Meal-break check for one workday, based on total hours on the clock and total break time
 * (Unpaid Break Time plus clock-outs of 30+ min between punches).
 *
 *   First meal  : total > 5 h  and break < 30 min  -> waiver candidate; critical if total > 6 h
 *   Second meal : total > 10 h and break < 60 min  -> waiver candidate; critical if total > 12 h
 */
export function evaluateMeals(day: Workday, rules: MealRules): DayResult {
  const total = day.totalHours;
  const breakTime = day.breakHours;
  const issues: MealIssue[] = [];

  if (total > rules.firstMealAfterHours + EPS && breakTime + EPS < rules.firstMealMinBreakHours) {
    const critical = total > rules.firstMealCriticalAfterHours + EPS;
    issues.push({
      code: "MISSED_FIRST_MEAL",
      meal: 1,
      critical,
      message: `${hrs(total)} on the clock with ${describeBreak(day)}. A 30-min meal is required after 5 h${
        critical ? " and can't be waived past 6 h" : ""
      }.`,
    });
  }

  if (total > rules.secondMealAfterHours + EPS && breakTime + EPS < rules.secondMealMinBreakHours) {
    const critical = total > rules.secondMealCriticalAfterHours + EPS;
    issues.push({
      code: "MISSED_SECOND_MEAL",
      meal: 2,
      critical,
      message: `${hrs(total)} on the clock with ${describeBreak(day)}. 60 min of meal breaks are required after 10 h${
        critical ? " and can't be waived past 12 h" : ""
      }.`,
    });
  }

  let status: DayStatus = "compliant";
  if (issues.some((i) => i.critical)) status = "critical";
  else if (issues.length) status = "waivable";

  return { workday: day, status, issues };
}
