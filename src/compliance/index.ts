import { buildWorkdays } from "./buildWorkdays.ts";
import { CA_MEAL_RULES, type MealRules } from "./caMealRules.ts";
import { evaluateMeals } from "./evaluateMeals.ts";
import { parseTimeEntries } from "./parseTimeEntries.ts";
import type { AnalysisResult, RawRow } from "./types.ts";

export * from "./types.ts";
export { CA_MEAL_RULES } from "./caMealRules.ts";
export type { MealRules } from "./caMealRules.ts";

export class AnalysisError extends Error {}

/** Parse a time-entry export and evaluate every workday against the meal-period rules. */
export function analyzeTimeEntries(
  rows: RawRow[],
  headers: string[],
  rules: MealRules = CA_MEAL_RULES,
): AnalysisResult {
  const parsed = parseTimeEntries(rows, headers);
  if (parsed.errors.length) throw new AnalysisError(parsed.errors.join("\n"));

  const days = buildWorkdays(parsed.entries, rules).map((d) => evaluateMeals(d, rules));
  const count = (s: string) => days.filter((d) => d.status === s).length;

  return {
    days,
    summary: {
      criticalDays: count("critical"),
      waivableDays: count("waivable"),
    },
  };
}
