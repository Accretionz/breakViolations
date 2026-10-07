// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTimeEntries } from "../compliance/index.ts";
import { parseWallClock } from "../compliance/parseTimeEntries.ts";
import { signatureToMask } from "./signature.ts";
import {
  buildWaiverFolder,
  personDisplayName,
  renderWaiverFor,
  safeFileName,
  waiverKey,
  waiverLocation,
} from "./waiverFolder.ts";

const HEADERS = ["Employee", "Job Title", "In Date", "Out Date", "Total Hours", "Unpaid Break Time"];
function row(name: string, inDate: string, outDate: string, unpaid = 0) {
  const total = (parseWallClock(outDate)!.minutes - parseWallClock(inDate)!.minutes) / 60;
  return {
    Employee: name,
    "Job Title": "Server",
    "In Date": inDate,
    "Out Date": outDate,
    "Total Hours": total.toFixed(2),
    "Unpaid Break Time": unpaid.toFixed(2),
  };
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

describe("waiver folder", () => {
  it("formats names as First Last", () => {
    assert.equal(personDisplayName("Liu, Jacky"), "Jacky Liu");
    assert.equal(personDisplayName("Ochoa Ramirez, Estefani"), "Estefani Ochoa Ramirez");
    assert.equal(personDisplayName("martinez, Aldo"), "Aldo Martinez");
    assert.equal(personDisplayName("Cher"), "Cher");
  });

  it("strips characters Windows doesn't allow", () => {
    assert.equal(safeFileName('a/b:c*?"<>|'), "a-b-c------");
  });

  it("includes only waiver candidates, one folder per person, files named 'First Last M-D'", () => {
    const result = analyzeTimeEntries(
      [
        row("Liu, Jacky ", "9/21/26 9:00 AM", "9/21/26 2:30 PM"), // 5.5 h, no break -> waiver
        row("Liu, Jacky", "10/4/26 9:00 AM", "10/4/26 2:30 PM"), // waiver
        row("Leon, Nicole", "10/4/26 9:00 AM", "10/4/26 2:20 PM"), // waiver
        row("Garza, Julio", "10/4/26 9:00 AM", "10/4/26 6:00 PM"), // 9 h, no break -> critical (excluded)
        row("Cai, Raquel", "10/4/26 9:00 AM", "10/4/26 6:00 PM", 0.5), // compliant (excluded)
      ],
      HEADERS,
    );
    const folder = buildWaiverFolder(result);
    assert.equal(folder.name, "Meal Break Waivers");
    assert.deepEqual(
      folder.employees.map((e) => [e.folderName, e.files.map((f) => f.name)]),
      [
        ["Jacky Liu", ["Jacky Liu 9-21.pdf", "Jacky Liu 10-4.pdf"]],
        ["Nicole Leon", ["Nicole Leon 10-4.pdf"]],
      ],
    );
    const pdf = latin1(folder.employees[0].files[0].content);
    assert.ok(pdf.startsWith("%PDF-1.4"));
    assert.ok(pdf.includes("(Jacky Liu) Tj"), "employee name is filled in");
    assert.ok(pdf.includes("(KZST) Tj"), "store is filled in");
    assert.equal(pdf.split("(9/21/26) Tj").length - 1, 2, "meal break date pre-filled next to both signatures");
    assert.ok(!pdf.includes("/ImageMask"), "blank form has no signatures");
    assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  });
});

/** A fake "drawn" signature: a diagonal stroke on a transparent canvas. */
function fakeSignaturePixels(w = 200, h = 60) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let x = 20; x < 180; x++) {
    const y = 10 + Math.floor((x - 20) / 4);
    rgba[(y * w + x) * 4 + 3] = 255;
  }
  return { rgba, w, h };
}

describe("signing", () => {
  it("returns no signature for an empty pad", () => {
    assert.equal(signatureToMask(new Uint8ClampedArray(50 * 20 * 4), 50, 20), null);
  });

  it("crops the signature to the ink and packs it into 1-bit rows", () => {
    const { rgba, w, h } = fakeSignaturePixels();
    const mask = signatureToMask(rgba, w, h)!;
    assert.equal(mask.widthPx, 160 + 8); // ink width + 4 px padding each side
    assert.equal(mask.bits.length, Math.ceil(mask.widthPx / 8) * mask.heightPx);
    assert.ok(mask.bits.some((b) => b !== 0xff), "has ink");
  });

  it("puts signatures, supervisor name and the meal break date on the PDF", () => {
    const result = analyzeTimeEntries([row("Liu, Jacky", "10/4/26 9:00 AM", "10/4/26 2:30 PM")], HEADERS);
    const day = result.days[0];
    const { rgba, w, h } = fakeSignaturePixels();
    const sig = signatureToMask(rgba, w, h)!;
    const pdf = latin1(
      renderWaiverFor(day, {
        employeeSignature: sig,
        supervisorName: "Matthew Li",
        supervisorSignature: sig,
      }),
    );
    assert.ok(pdf.includes("(Matthew Li) Tj"));
    assert.equal(pdf.split("(10/4/26) Tj").length - 1, 2, "meal break date next to both signatures");
    assert.equal(pdf.split("/ImageMask true").length - 1, 2, "both signatures");
  });

  it("uses the signed PDF in the folder instead of the blank form", () => {
    const result = analyzeTimeEntries([row("Liu, Jacky", "10/4/26 9:00 AM", "10/4/26 2:30 PM")], HEADERS);
    const signedPdf = new Uint8Array([1, 2, 3]);
    const folder = buildWaiverFolder(
      result,
      new Map([[waiverKey(result.days[0]), { fileName: "Jacky Liu 10-3.pdf", pdf: signedPdf }]]),
    );
    assert.equal(folder.employees[0].files[0].content, signedPdf);
    assert.equal(folder.employees[0].files[0].name, "Jacky Liu 10-3.pdf");
  });

  it("uses a meal break date chosen at signing for the form and file name", () => {
    const result = analyzeTimeEntries([row("Liu, Jacky", "10/4/26 9:00 AM", "10/4/26 2:30 PM")], HEADERS);
    const day = result.days[0];
    const pdf = latin1(renderWaiverFor(day, {}, "2026-10-03"));
    assert.equal(pdf.split("(10/3/26) Tj").length - 1, 2);
    assert.ok(!pdf.includes("(10/4/26) Tj"));
    assert.equal(waiverLocation(day, "2026-10-03").fileName, "Jacky Liu 10-3.pdf");
    assert.equal(waiverLocation(day).fileName, "Jacky Liu 10-4.pdf");
  });
});
