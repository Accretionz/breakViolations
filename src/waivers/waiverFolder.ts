import type { AnalysisResult, DayResult } from "../compliance/index.ts";
import { buildWaiverKeywords } from "./waiverMeta.ts";
import { renderWaiverForm, type WaiverSignatures } from "./waiverForm.ts";

/** The one folder all waivers live in, reused every time the app runs. */
export const WAIVER_ROOT_FOLDER = "Meal Break Waivers";

export interface WaiverFile {
  /** waiverKey of the flagged day this file is for. */
  key: string;
  name: string;
  content: Uint8Array<ArrayBuffer>;
}

/** A folder to write to disk: subfolders per employee, each with one PDF waiver form per flagged day. */
export interface WaiverFolder {
  name: string;
  employees: { folderName: string; files: WaiverFile[] }[];
}

/** Make a string safe to use as a file or folder name on Windows and macOS. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100) || "unnamed"
  );
}

const capitalize = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** "Liu, Jacky" -> "Jacky Liu";  "martinez, Aldo" -> "Aldo Martinez". Names without a comma are kept. */
export function personDisplayName(name: string): string {
  const [last, ...rest] = name.split(",");
  const first = rest.join(",").trim();
  const full = first ? `${first} ${last.trim()}` : last.trim();
  return full.split(" ").map(capitalize).join(" ");
}

/** "2026-10-04" -> "10/4/26" */
export function isoToShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(-2)}`;
}

/** "Jacky Liu" + "2026-09-21" -> "Jacky Liu 9-21.pdf" */
export function waiverFileName(displayName: string, isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${safeFileName(`${displayName} ${m}-${d}`)}.pdf`;
}

/** A waiver signed in the app. Its file name follows the meal break date chosen when signing. */
export interface SignedWaiver {
  fileName: string;
  pdf: Uint8Array<ArrayBuffer>;
}

/** Identifies one waiver (one employee, one workday). */
export const waiverKey = (day: DayResult) => `${day.workday.employeeKey}|${day.workday.isoDate}`;

/**
 * Where a waiver lives inside the waiver folder. The meal break date defaults to the flagged
 * workday but can be changed when signing.
 */
export function waiverLocation(day: DayResult, mealBreakIsoDate = day.workday.isoDate) {
  const employeeName = personDisplayName(day.workday.employeeName);
  return {
    employeeName,
    folderName: safeFileName(employeeName),
    fileName: waiverFileName(employeeName, mealBreakIsoDate),
  };
}

/** The waiver PDF for one day: blank when no signatures are given, otherwise signed. */
export function renderWaiverFor(
  day: DayResult,
  signatures?: WaiverSignatures,
  mealBreakIsoDate = day.workday.isoDate,
) {
  return renderWaiverForm({
    employeeName: personDisplayName(day.workday.employeeName),
    mealBreakDate: isoToShortDate(mealBreakIsoDate),
    signatures,
    keywords: buildWaiverKeywords({
      status: signatures ? "signed" : "blank",
      employee: day.workday.employeeKey,
      flagged: day.workday.isoDate,
      mealBreak: mealBreakIsoDate,
    }),
  });
}

/**
 * Folder layout (waiver candidates only — critical days can't be waived):
 *   Meal Break Waivers/
 *     <pay period>/        (added when saving; see waiverFiles.ts)
 *     Jacky Liu/
 *       Jacky Liu 10-4.pdf      <- Meal Break Waiver Agreement filled in for Jacky Liu
 */
export function buildWaiverFolder(
  result: AnalysisResult,
  /** Waivers signed this session, by waiverKey; these replace the blank forms. */
  signed: ReadonlyMap<string, SignedWaiver> = new Map(),
): WaiverFolder {
  const byEmployee = new Map<string, WaiverFolder["employees"][number]>();
  for (const day of result.days) {
    if (day.status !== "waivable") continue;
    const { folderName, fileName } = waiverLocation(day);
    const folder = byEmployee.get(folderName) ?? { folderName, files: [] };
    const key = waiverKey(day);
    const s = signed.get(key);
    folder.files.push(s ? { key, name: s.fileName, content: s.pdf } : { key, name: fileName, content: renderWaiverFor(day) });
    byEmployee.set(folderName, folder);
  }
  return {
    name: WAIVER_ROOT_FOLDER,
    employees: [...byEmployee.values()].sort((a, b) => a.folderName.localeCompare(b.folderName)),
  };
}
