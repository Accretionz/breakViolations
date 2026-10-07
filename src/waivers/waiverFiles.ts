import type { DayResult } from "../compliance/index.ts";
import {
  isInPayPeriod,
  parsePayPeriodFolderName,
  payPeriodFolderName,
  type PayPeriod,
} from "./payPeriod.ts";
import { waiverKey, waiverLocation, type WaiverFolder } from "./waiverFolder.ts";
import { isReplaceable, parseWaiverMeta } from "./waiverMeta.ts";

/**
 * Reading and writing waivers in the "Meal Break Waivers" folder:
 *
 *   Meal Break Waivers/
 *     2026-09-21 to 2026-10-04/      <- one folder per pay period (from the CSV file name)
 *       Jacky Liu/
 *         Jacky Liu 9-21.pdf
 *
 * Rules that keep signed waivers safe across runs:
 * - A file is only ever replaced if it's a BLANK form the app made (see waiverMeta.ts).
 * - Signed waivers — from the app, or any other PDF such as a scanned paper copy — are never overwritten.
 *   Re-signing saves a new copy, e.g. "Jacky Liu 10-4 (2).pdf".
 * - A day signed in ANY pay-period folder counts as signed (so overlapping exports don't duplicate work).
 */

type IterableDirectory = { values(): AsyncIterable<FileSystemHandle> };

async function* subfolders(dir: FileSystemDirectoryHandle) {
  for await (const entry of (dir as unknown as IterableDirectory).values()) {
    if (entry.kind === "directory") yield entry as FileSystemDirectoryHandle;
  }
}

async function getSubfolder(parent: FileSystemDirectoryHandle, name: string, create = false) {
  try {
    return await parent.getDirectoryHandle(name, { create });
  } catch {
    return null;
  }
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Errors Chrome raises when Windows won't let it replace a file — usually because the PDF is open in
 * a viewer, or OneDrive / antivirus is touching it at that moment. Worth retrying, then skipping.
 */
export function isFileLockedError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    ["InvalidStateError", "NoModificationAllowedError", "NotReadableError"].includes(e.name)
  );
}

/** Write a file, retrying briefly if Windows has it locked. */
async function writeFile(dir: FileSystemDirectoryHandle, name: string, content: Uint8Array<ArrayBuffer>) {
  const delays = [0, 400, 1200];
  for (let attempt = 0; ; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt]);
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (e) {
      await writable?.abort().catch(() => {});
      if (!isFileLockedError(e) || attempt === delays.length - 1) throw e;
    }
  }
}

/** A plain-English explanation for a file that couldn't be saved. */
export function lockedFileMessage(fileName: string): string {
  return (
    `Windows wouldn't let the app save "${fileName}". If it's open in a PDF viewer, close it; ` +
    "if the folder is in OneDrive, wait a moment for syncing to finish. Then try again."
  );
}

/**
 * The folder for a pay period. Reuses an existing folder that starts on the same date
 * (e.g. from a mid-period run whose export ended earlier), otherwise creates one.
 */
export async function getPayPeriodFolder(
  root: FileSystemDirectoryHandle,
  period: PayPeriod,
): Promise<FileSystemDirectoryHandle> {
  for await (const dir of subfolders(root)) {
    if (parsePayPeriodFolderName(dir.name)?.start === period.start) return dir;
  }
  return root.getDirectoryHandle(payPeriodFolderName(period), { create: true });
}

/**
 * Look through every pay-period folder for waivers that are already signed.
 * Returns waiverKey -> "period/employee/file" for each flagged day in `days` that's covered.
 */
export async function findSignedWaivers(
  root: FileSystemDirectoryHandle,
  days: DayResult[],
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  // PDFs without the app's tag (e.g. scanned paper waivers), matched by file name below.
  const untagged: { range: PayPeriod | null; folderName: string; fileName: string; path: string }[] = [];

  const scanEmployeeFolder = async (dir: FileSystemDirectoryHandle, prefix: string, range: PayPeriod | null) => {
    for await (const entry of (dir as unknown as IterableDirectory).values()) {
      if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".pdf")) continue;
      const bytes = await readFile(dir, entry.name);
      if (!bytes) continue;
      const path = `${prefix}${dir.name}/${entry.name}`;
      const meta = parseWaiverMeta(bytes);
      if (meta?.status === "signed") signed.set(`${meta.employee}|${meta.flagged}`, path);
      else if (!meta) untagged.push({ range, folderName: dir.name, fileName: entry.name, path });
    }
  };

  for await (const top of subfolders(root)) {
    const range = parsePayPeriodFolderName(top.name);
    if (range) {
      for await (const emp of subfolders(top)) await scanEmployeeFolder(emp, `${top.name}/`, range);
    } else {
      await scanEmployeeFolder(top, "", null); // employee folders saved before pay-period folders existed
    }
  }

  for (const d of days) {
    const key = waiverKey(d);
    if (signed.has(key)) continue;
    const { folderName, fileName } = waiverLocation(d);
    const hit = untagged.find(
      (u) =>
        u.folderName === folderName &&
        u.fileName === fileName &&
        (!u.range || isInPayPeriod(d.workday.isoDate, u.range)),
    );
    if (hit) signed.set(key, hit.path);
  }
  return signed;
}

/** Write blank forms into the pay-period folder for days that aren't signed yet. Never touches signed files. */
export async function writeWaiverFolder(
  root: FileSystemDirectoryHandle,
  period: PayPeriod,
  folder: WaiverFolder,
  alreadySigned: ReadonlyMap<string, string>,
): Promise<{ written: number; kept: number; locked: string[]; periodFolder: string }> {
  const periodDir = await getPayPeriodFolder(root, period);
  let written = 0;
  let kept = 0;
  const locked: string[] = [];
  for (const emp of folder.employees) {
    const pending = emp.files.filter((f) => !alreadySigned.has(f.key));
    kept += emp.files.length - pending.length;
    if (!pending.length) continue;
    const dir = (await getSubfolder(periodDir, emp.folderName, true))!;
    for (const f of pending) {
      const existing = await readFile(dir, f.name);
      if (existing && !isReplaceable(existing)) {
        kept++;
        continue;
      }
      try {
        await writeFile(dir, f.name, f.content);
        written++;
      } catch (e) {
        // One locked file shouldn't stop the rest; report it instead.
        if (!isFileLockedError(e)) throw e;
        locked.push(f.name);
      }
    }
  }
  return { written, kept, locked, periodFolder: periodDir.name };
}

/**
 * Save a signed waiver into the pay-period/employee folder without overwriting another signed file.
 * Removes the now-unneeded blank form for the flagged date. Returns the path used.
 */
export async function saveSignedToFolder(
  root: FileSystemDirectoryHandle,
  period: PayPeriod,
  folderName: string,
  fileName: string,
  pdf: Uint8Array<ArrayBuffer>,
  flaggedBlankName: string,
): Promise<string> {
  const periodDir = await getPayPeriodFolder(root, period);
  const dir = (await getSubfolder(periodDir, folderName, true))!;

  // Use the first name that's free or holds only a blank form. If Windows has that file locked
  // (open in a viewer, OneDrive syncing), move on to the next name rather than failing.
  let name = "";
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? fileName : fileName.replace(/\.pdf$/i, ` (${n}).pdf`);
    const existing = await readFile(dir, candidate);
    if (existing && !isReplaceable(existing)) continue; // signed: never overwrite
    try {
      await writeFile(dir, candidate, pdf);
      name = candidate;
      break;
    } catch (e) {
      if (!isFileLockedError(e)) throw e;
    }
  }
  if (!name) throw new Error(lockedFileMessage(fileName));

  // Tidy up the blank form this signature replaces. Not essential, so ignore a locked file.
  if (flaggedBlankName !== name) {
    try {
      const blank = await readFile(dir, flaggedBlankName);
      if (blank && isReplaceable(blank)) await dir.removeEntry(flaggedBlankName);
    } catch {
      // leave it; it's only a blank form
    }
  }
  return `${periodDir.name}/${folderName}/${name}`;
}
