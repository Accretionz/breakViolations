// Run with: npm test
// Uses an in-memory stand-in for the browser's folder API to check that signed waivers survive repeat runs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTimeEntries } from "../compliance/index.ts";
import { parseWallClock } from "../compliance/parseTimeEntries.ts";
import { signatureToMask } from "./signature.ts";
import { findSignedWaivers, saveSignedToFolder, writeWaiverFolder } from "./waiverFiles.ts";
import { buildWaiverFolder, renderWaiverFor, waiverKey, waiverLocation } from "./waiverFolder.ts";
import { parseWaiverMeta } from "./waiverMeta.ts";
import { payPeriodFromFileName, type PayPeriod } from "./payPeriod.ts";

// ---------- in-memory folder ----------
class MemFile {
  readonly kind = "file";
  name: string;
  data: Uint8Array;
  /** Simulates Windows locking the file (open in a PDF viewer / OneDrive syncing). */
  locked = false;
  constructor(name: string, data = new Uint8Array()) {
    this.name = name;
    this.data = data;
  }
  async getFile() {
    const data = this.data;
    return { arrayBuffer: async () => data.slice().buffer };
  }
  async createWritable() {
    let next = new Uint8Array();
    return {
      write: async (chunk: Uint8Array) => {
        next = new Uint8Array(chunk);
      },
      close: async () => {
        if (this.locked) {
          throw new DOMException(
            "An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.",
            "InvalidStateError",
          );
        }
        this.data = next;
      },
      abort: async () => {},
    };
  }
}

class MemDir {
  readonly kind = "directory";
  name: string;
  entries = new Map<string, MemDir | MemFile>();
  constructor(name: string) {
    this.name = name;
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    let e = this.entries.get(name);
    if (!e && opts.create) this.entries.set(name, (e = new MemDir(name)));
    if (!(e instanceof MemDir)) throw new DOMException(name, "NotFoundError");
    return e;
  }
  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    let e = this.entries.get(name);
    if (!e && opts.create) this.entries.set(name, (e = new MemFile(name)));
    if (!(e instanceof MemFile)) throw new DOMException(name, "NotFoundError");
    return e;
  }
  async removeEntry(name: string) {
    this.entries.delete(name);
  }
  async *values() {
    yield* this.entries.values();
  }
  file(folder: string, name: string): MemFile | undefined {
    const dir = this.entries.get(folder);
    return dir instanceof MemDir ? (dir.entries.get(name) as MemFile | undefined) : undefined;
  }
  names(folder: string): string[] {
    const dir = this.entries.get(folder);
    return dir instanceof MemDir ? [...dir.entries.keys()].sort() : [];
  }
  /** Follow a "a/b/c" path. */
  at(path: string): MemDir | MemFile | undefined {
    let cur: MemDir | MemFile | undefined = this;
    for (const part of path.split("/").filter(Boolean)) cur = cur instanceof MemDir ? cur.entries.get(part) : undefined;
    return cur;
  }
  list(path: string): string[] {
    const d = this.at(path);
    return d instanceof MemDir ? [...d.entries.keys()].sort() : [];
  }
}
const asHandle = (d: MemDir) => d as unknown as FileSystemDirectoryHandle;

// ---------- helpers ----------
const HEADERS = ["Employee", "Job Title", "In Date", "Out Date", "Total Hours", "Unpaid Break Time"];
function row(name: string, inDate: string, outDate: string) {
  const total = (parseWallClock(outDate)!.minutes - parseWallClock(inDate)!.minutes) / 60;
  return { Employee: name, "Job Title": "Server", "In Date": inDate, "Out Date": outDate, "Total Hours": total.toFixed(2), "Unpaid Break Time": "0" };
}
// 5.5 h with no break -> waiver candidate
const missed = (name: string, date: string) => row(name, `${date} 9:00 AM`, `${date} 2:30 PM`);

function signature() {
  const w = 120, h = 40, rgba = new Uint8ClampedArray(w * h * 4);
  for (let x = 10; x < 110; x++) rgba[(20 * w + x) * 4 + 3] = 255;
  return { employeeSignature: signatureToMask(rgba, w, h)! };
}

const P1 = payPeriodFromFileName("TimeEntries_2026_09_21-2026_10_04.csv")!;
const P2 = payPeriodFromFileName("TimeEntries_2026_10_05-2026_10_18.csv")!;
const F1 = "2026-09-21 to 2026-10-04";
const F2 = "2026-10-05 to 2026-10-18";

async function run(root: MemDir, rows: ReturnType<typeof row>[], period: PayPeriod = P1) {
  const result = analyzeTimeEntries(rows, HEADERS);
  const days = result.days.filter((d) => d.status === "waivable");
  const signed = await findSignedWaivers(asHandle(root), days);
  const counts = await writeWaiverFolder(asHandle(root), period, buildWaiverFolder(result), signed);
  return { days, signed, ...counts };
}

async function sign(
  root: MemDir,
  day: ReturnType<typeof analyzeTimeEntries>["days"][number],
  isoDate?: string,
  period: PayPeriod = P1,
) {
  const pdf = renderWaiverFor(day, signature(), isoDate);
  const { folderName, fileName } = waiverLocation(day, isoDate);
  return saveSignedToFolder(asHandle(root), period, folderName, fileName, pdf, waiverLocation(day).fileName);
}

describe("waivers persist across runs", () => {
  it("tags blank and signed PDFs so the app can tell them apart", () => {
    const day = analyzeTimeEntries([missed("Liu, Jacky", "10/4/26")], HEADERS).days[0];
    assert.equal(parseWaiverMeta(renderWaiverFor(day))?.status, "blank");
    const meta = parseWaiverMeta(renderWaiverFor(day, signature(), "2026-10-03"))!;
    assert.deepEqual(meta, { status: "signed", employee: "liu, jacky", flagged: "2026-10-04", mealBreak: "2026-10-03" });
  });

  it("never overwrites a signed waiver when the app is run again", async () => {
    const root = new MemDir("Meal Break Waivers");

    // Run 1: two blank forms
    const first = await run(root, [missed("Liu, Jacky", "10/4/26"), missed("Leon, Nicole", "10/4/26")]);
    assert.equal(first.written, 2);

    // Jacky signs
    const jacky = first.days.find((d) => d.workday.employeeKey === "liu, jacky")!;
    assert.equal(await sign(root, jacky), `${F1}/Jacky Liu/Jacky Liu 10-4.pdf`);
    const signedBytes = (root.at(`${F1}/Jacky Liu/Jacky Liu 10-4.pdf`) as MemFile).data;
    assert.equal(parseWaiverMeta(signedBytes)?.status, "signed");

    // Run 2: a new CSV that overlaps the same day, plus a new missed break
    const second = await run(root, [
      missed("Liu, Jacky", "10/4/26"),
      missed("Leon, Nicole", "10/4/26"),
      missed("Liu, Jacky", "10/9/26"),
    ]);
    assert.ok(second.signed.has(waiverKey(jacky)), "recognized as already signed");
    assert.equal(second.kept, 1);
    assert.equal(second.written, 2); // Nicole's blank refreshed + Jacky's new 10-9 form
    assert.equal((root.at(`${F1}/Jacky Liu/Jacky Liu 10-4.pdf`) as MemFile).data, signedBytes, "signed file untouched");
    assert.deepEqual(root.list(`${F1}/Jacky Liu`), ["Jacky Liu 10-4.pdf", "Jacky Liu 10-9.pdf"]);
  });

  it("treats a PDF it didn't make (e.g. a scanned paper waiver) as signed", async () => {
    const root = new MemDir("Meal Break Waivers");
    const scan = new TextEncoder().encode("%PDF-1.3 scanned paper waiver");
    const period = await root.getDirectoryHandle(F1, { create: true });
    (await period.getDirectoryHandle("Jacky Liu", { create: true })).entries.set("Jacky Liu 10-4.pdf", new MemFile("Jacky Liu 10-4.pdf", scan));

    const res = await run(root, [missed("Liu, Jacky", "10/4/26")]);
    assert.equal(res.kept, 1);
    assert.equal(res.written, 0);
    assert.equal((root.at(`${F1}/Jacky Liu/Jacky Liu 10-4.pdf`) as MemFile).data, scan);
  });

  it("re-signing keeps the earlier signed copy", async () => {
    const root = new MemDir("Meal Break Waivers");
    const { days } = await run(root, [missed("Liu, Jacky", "10/4/26")]);
    await sign(root, days[0]);
    assert.equal(await sign(root, days[0]), `${F1}/Jacky Liu/Jacky Liu 10-4 (2).pdf`);
    assert.deepEqual(root.list(`${F1}/Jacky Liu`), ["Jacky Liu 10-4 (2).pdf", "Jacky Liu 10-4.pdf"]);
  });

  it("signing for a different date replaces the blank form and is still recognized later", async () => {
    const root = new MemDir("Meal Break Waivers");
    const { days } = await run(root, [missed("Liu, Jacky", "10/4/26")]);
    assert.equal(await sign(root, days[0], "2026-10-03"), `${F1}/Jacky Liu/Jacky Liu 10-3.pdf`);
    assert.deepEqual(root.list(`${F1}/Jacky Liu`), ["Jacky Liu 10-3.pdf"], "blank 10-4 form removed");

    const again = await run(root, [missed("Liu, Jacky", "10/4/26")]);
    assert.equal(again.signed.get(waiverKey(days[0])), `${F1}/Jacky Liu/Jacky Liu 10-3.pdf`);
    assert.equal(again.written, 0);
    assert.deepEqual(root.list(`${F1}/Jacky Liu`), ["Jacky Liu 10-3.pdf"], "no new blank form recreated");
  });

});

describe("pay-period folders", () => {
  it("reads the pay period from the CSV file name", () => {
    assert.deepEqual(P1, { start: "2026-09-21", end: "2026-10-04" });
    assert.equal(payPeriodFromFileName("random.csv"), null);
  });

  it("files each pay period into its own folder", async () => {
    const root = new MemDir("Meal Break Waivers");
    await run(root, [missed("Liu, Jacky", "9/21/26"), missed("Liu, Jacky", "10/4/26")], P1);
    await run(root, [missed("Liu, Jacky", "10/9/26")], P2);
    assert.deepEqual(root.list(""), [F1, F2]);
    assert.deepEqual(root.list(`${F1}/Jacky Liu`), ["Jacky Liu 10-4.pdf", "Jacky Liu 9-21.pdf"]);
    assert.deepEqual(root.list(`${F2}/Jacky Liu`), ["Jacky Liu 10-9.pdf"]);
  });

  it("a mid-period export reuses the folder that starts on the same date", async () => {
    const root = new MemDir("Meal Break Waivers");
    const partial = payPeriodFromFileName("TimeEntries_2026_09_21-2026_09_28.csv")!;
    const { days } = await run(root, [missed("Liu, Jacky", "9/21/26")], partial);
    await sign(root, days[0], undefined, partial);
    // Later, the full pay-period export
    const full = await run(root, [missed("Liu, Jacky", "9/21/26"), missed("Leon, Nicole", "10/4/26")], P1);
    assert.deepEqual(root.list(""), ["2026-09-21 to 2026-09-28"], "no second folder for the same pay period");
    assert.equal(full.kept, 1);
    assert.deepEqual(root.list("2026-09-21 to 2026-09-28/Nicole Leon"), ["Nicole Leon 10-4.pdf"]);
  });

  it("a day signed in another pay-period folder isn't written again", async () => {
    const root = new MemDir("Meal Break Waivers");
    const { days } = await run(root, [missed("Liu, Jacky", "10/4/26")], P1);
    await sign(root, days[0]);
    // An overlapping export filed under the next period still sees it as signed
    const res = await run(root, [missed("Liu, Jacky", "10/4/26")], P2);
    assert.equal(res.written, 0);
    assert.deepEqual(root.list(F2), []);
  });

  it("still recognizes waivers saved before pay-period folders existed", async () => {
    const root = new MemDir("Meal Break Waivers");
    const day = analyzeTimeEntries([missed("Liu, Jacky", "10/4/26")], HEADERS).days[0];
    const legacy = await root.getDirectoryHandle("Jacky Liu", { create: true });
    legacy.entries.set("Jacky Liu 10-4.pdf", new MemFile("Jacky Liu 10-4.pdf", renderWaiverFor(day, signature())));
    const res = await run(root, [missed("Liu, Jacky", "10/4/26")], P1);
    assert.equal(res.signed.get(waiverKey(day)), "Jacky Liu/Jacky Liu 10-4.pdf");
    assert.equal(res.written, 0);
  });

});

describe("locked files (open in a PDF viewer / OneDrive syncing)", () => {
  it("signing still saves when the blank form is locked, under the next name", async () => {
    const root = new MemDir("Meal Break Waivers");
    const { days } = await run(root, [missed("Liu, Jacky", "10/4/26")]);
    (root.at(`${F1}/Jacky Liu/Jacky Liu 10-4.pdf`) as MemFile).locked = true;
    assert.equal(await sign(root, days[0]), `${F1}/Jacky Liu/Jacky Liu 10-4 (2).pdf`);
    const again = await run(root, [missed("Liu, Jacky", "10/4/26")]);
    assert.ok(again.signed.has(waiverKey(days[0])), "recognized as signed afterwards");
  });

  it("downloading the folder skips a locked file and reports it instead of failing", async () => {
    const root = new MemDir("Meal Break Waivers");
    await run(root, [missed("Liu, Jacky", "10/4/26"), missed("Leon, Nicole", "10/4/26")]);
    (root.at(`${F1}/Jacky Liu/Jacky Liu 10-4.pdf`) as MemFile).locked = true;
    const res = await run(root, [missed("Liu, Jacky", "10/4/26"), missed("Leon, Nicole", "10/4/26")]);
    assert.deepEqual(res.locked, ["Jacky Liu 10-4.pdf"]);
    assert.equal(res.written, 1);
  });
});
