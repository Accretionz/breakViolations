import { saveAs } from "file-saver";
import JSZip from "jszip";
import { WAIVER_ROOT_FOLDER, type WaiverFolder } from "../waivers/waiverFolder";
import { idbGet, idbSet } from "./handleStore";

/**
 * Connecting to the persistent "Meal Break Waivers" folder (Chrome/Edge), remembering it between
 * visits, and download fallbacks for other browsers. File read/write rules live in waivers/waiverFiles.ts.
 */
export { findSignedWaivers, saveSignedToFolder, writeWaiverFolder } from "../waivers/waiverFiles";


type Mode = { mode: "readwrite" };
type PermissionedHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: Mode) => Promise<PermissionState>;
  requestPermission?: (o: Mode) => Promise<PermissionState>;
};
type DirectoryPicker = (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;

const HANDLE_KEY = "waiverRoot";
const RW: Mode = { mode: "readwrite" };

/** Chrome and Edge can read and write a real folder; other browsers can't. */
export const canUseFolders = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/** Name of the folder remembered from a previous visit (even if access needs re-approving). */
export async function getRememberedFolderName(): Promise<string | null> {
  return (await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY))?.name ?? null;
}

/** The remembered folder, if the browser still allows access without asking. */
export async function getConnectedRoot(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<PermissionedHandle>(HANDLE_KEY);
  if (!handle) return null;
  try {
    return (await handle.queryPermission?.(RW)) === "granted" ? handle : null;
  } catch {
    return null;
  }
}

/**
 * Get the waiver folder. Call from a click: it may ask the browser for permission, or show a
 * folder picker the first time (or when `choose` is true). Returns null if cancelled/unsupported.
 */
export async function connectRoot({ choose = false } = {}): Promise<FileSystemDirectoryHandle | null> {
  if (!canUseFolders()) return null;

  if (!choose) {
    const saved = await idbGet<PermissionedHandle>(HANDLE_KEY);
    if (saved) {
      try {
        const state = (await saved.queryPermission?.(RW)) ?? "granted";
        if (state === "granted" || (await saved.requestPermission?.(RW)) === "granted") return saved;
      } catch {
        // Folder moved or deleted: fall through to the picker.
      }
    }
  }

  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker!;
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await picker.call(window, { id: "meal-break-waivers", mode: "readwrite" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
  // Use the picked folder if it IS "Meal Break Waivers"; otherwise create/reuse one inside it.
  const root =
    picked.name === WAIVER_ROOT_FOLDER
      ? picked
      : await picked.getDirectoryHandle(WAIVER_ROOT_FOLDER, { create: true });
  await idbSet(HANDLE_KEY, root);
  return root;
}

/** Browsers without folder access: download the whole folder as a .zip. */
export async function downloadWaiverZip(folder: WaiverFolder, payPeriodFolder: string) {
  const zip = new JSZip();
  const root = zip.folder(folder.name)!.folder(payPeriodFolder)!;
  for (const emp of folder.employees) {
    const dir = root.folder(emp.folderName)!;
    for (const f of emp.files) dir.file(f.name, f.content);
  }
  saveAs(await zip.generateAsync({ type: "blob" }), `${folder.name} ${payPeriodFolder}.zip`);
}

/** Browsers without folder access: download one signed PDF. */
export function downloadPdf(fileName: string, pdf: Uint8Array<ArrayBuffer>) {
  saveAs(new Blob([pdf], { type: "application/pdf" }), fileName);
}
