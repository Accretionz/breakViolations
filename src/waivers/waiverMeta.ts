/**
 * Every waiver PDF the app writes carries a small tag in its Keywords property, e.g.
 *   kizuki-waiver;status=signed;employee=liu, jacky;flagged=2026-10-04;mealbreak=2026-10-03
 * The tag lets the app recognize its own files on later runs:
 * - status=blank  -> an unsigned form the app made; safe to replace.
 * - status=signed -> signed in the app; never overwritten.
 * Files without the tag (e.g. a scanned paper waiver) are also treated as signed and never overwritten.
 */
export interface WaiverMeta {
  status: "blank" | "signed";
  /** Employee key from the CSV (lower-case "last, first"). */
  employee: string;
  /** The workday the app flagged, YYYY-MM-DD. */
  flagged: string;
  /** The meal break date printed on the form, YYYY-MM-DD. */
  mealBreak: string;
}

const TAG = "kizuki-waiver";

export function buildWaiverKeywords(meta: WaiverMeta): string {
  return [TAG, `status=${meta.status}`, `employee=${meta.employee}`, `flagged=${meta.flagged}`, `mealbreak=${meta.mealBreak}`]
    .map((part) => part.replace(/[;()\\]/g, " "))
    .join(";");
}

/** Read the tag back from PDF bytes. Returns null for files the app didn't make. */
export function parseWaiverMeta(bytes: Uint8Array): WaiverMeta | null {
  // The Info dictionary sits near the end of the files we write; scan the last 4 KB.
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
  let text = "";
  for (const b of tail) text += String.fromCharCode(b);
  const match = text.match(/\/Keywords \((kizuki-waiver;[^)]*)\)/);
  if (!match) return null;
  const fields = Object.fromEntries(
    match[1]
      .split(";")
      .slice(1)
      .map((kv) => {
        const i = kv.indexOf("=");
        return [kv.slice(0, i), kv.slice(i + 1)];
      }),
  );
  if (fields.status !== "blank" && fields.status !== "signed") return null;
  return {
    status: fields.status,
    employee: fields.employee ?? "",
    flagged: fields.flagged ?? "",
    mealBreak: fields.mealbreak ?? "",
  };
}

/** A file is safe to replace only if it's a blank form the app generated. */
export const isReplaceable = (bytes: Uint8Array) => parseWaiverMeta(bytes)?.status === "blank";
