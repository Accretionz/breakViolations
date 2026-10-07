/**
 * California meal-break rules, measured against TOTAL hours on the clock
 * (Total Hours column, which includes unpaid break time) for the workday.
 * Kept as data so thresholds can be tuned or other states added later.
 *
 * "After" thresholds are strict: a flag needs MORE than the number of hours.
 */
export interface MealRules {
  /** First meal: flag when total hours exceed this and break time is under `firstMealMinBreakHours`. */
  firstMealAfterHours: number;
  /** First meal: the same shortfall past this many hours is critical (can't be waived). */
  firstMealCriticalAfterHours: number;
  firstMealMinBreakHours: number;

  /** Second meal: flag when total hours exceed this and break time is under `secondMealMinBreakHours`. */
  secondMealAfterHours: number;
  /** Second meal: the same shortfall past this many hours is critical (can't be waived). */
  secondMealCriticalAfterHours: number;
  secondMealMinBreakHours: number;

  /** A clock-out between punches of at least this many minutes counts as break time. */
  clockOutBreakMinMinutes: number;
  /** A clock-in on the next calendar day joins the previous workday if the gap is at most this. */
  overnightJoinGapMinutes: number;
}

export const CA_MEAL_RULES: MealRules = {
  firstMealAfterHours: 5,
  firstMealCriticalAfterHours: 6,
  firstMealMinBreakHours: 0.5,

  secondMealAfterHours: 10,
  secondMealCriticalAfterHours: 12,
  secondMealMinBreakHours: 1,

  clockOutBreakMinMinutes: 30,
  overnightJoinGapMinutes: 60,
};
