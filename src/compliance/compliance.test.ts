// Run with: npm test   (uses Node's built-in test runner; Node 22.6+)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnalysisError, analyzeTimeEntries, type DayResult } from "./index.ts";
import { normalizeName, parseHours, parseWallClock } from "./parseTimeEntries.ts";

const HEADERS = [
  "Employee",
  "Job Title",
  "In Date",
  "Out Date",
  "Total Hours",
  "Unpaid Break Time",
  "Paid Break Time",
  "Payable Hours",
];

/** Build a row. Times are "M/D/YY h:mm AM". Total Hours is derived from the times. */
function row(name: string, inDate: string, outDate: string, unpaid = 0, job = "Server") {
  const a = parseWallClock(inDate)!;
  const b = parseWallClock(outDate)!;
  const total = (b.minutes - a.minutes) / 60;
  return {
    Employee: name,
    "Job Title": job,
    "In Date": inDate,
    "Out Date": outDate,
    "Total Hours": total.toFixed(2),
    "Unpaid Break Time": unpaid.toFixed(2),
    "Paid Break Time": "0.17",
    "Payable Hours": (total - unpaid).toFixed(2),
  };
}

function analyzeOne(...rows: ReturnType<typeof row>[]): DayResult {
  const { days } = analyzeTimeEntries(rows, HEADERS);
  assert.equal(days.length, 1, "expected exactly one workday");
  return days[0];
}
const codes = (d: DayResult) => d.issues.map((i) => i.code);

describe("parsing", () => {
  it("parses Toast-style timestamps", () => {
    const t = parseWallClock("9/29/26 12:05 AM")!;
    assert.equal(t.isoDate, "2026-09-29");
    assert.equal(t.minutes % (24 * 60), 5);
    assert.equal(parseWallClock("10/6/26 12:30 PM")!.minutes % (24 * 60), 12 * 60 + 30);
    assert.equal(parseWallClock("not a date"), null);
  });

  it("parses decimal and h:mm hours", () => {
    assert.equal(parseHours("0.50"), 0.5);
    assert.equal(parseHours("0:30"), 0.5);
    assert.equal(parseHours(""), 0);
    assert.equal(parseHours("abc"), null);
  });

  it("normalizes messy names so the same person groups together", () => {
    assert.equal(normalizeName("Bryant , Devon "), "Bryant, Devon");
    assert.equal(normalizeName("Liu,  Jacky"), "Liu, Jacky");
  });

  it("rejects files missing required columns", () => {
    assert.throws(() => analyzeTimeEntries([{ Name: "x" }], ["Name"]), AnalysisError);
  });

  it("skips zero-length job-switch punches", () => {
    const res = analyzeTimeEntries(
      [row("A", "10/1/26 11:36 AM", "10/1/26 11:36 AM"), row("A", "10/1/26 11:36 AM", "10/1/26 2:30 PM")],
      HEADERS,
    );
    assert.equal(res.days.length, 1);
    assert.equal(res.days[0].workday.entries.length, 1);
  });
});

describe("first meal: total > 5 h needs 30 min of break", () => {
  it("exactly 5.00 total hours is not flagged", () => {
    assert.equal(analyzeOne(row("A", "10/1/26 9:00 AM", "10/1/26 2:00 PM")).status, "compliant");
  });

  it("5.02 h with no break is a waiver candidate", () => {
    const d = analyzeOne(row("A", "10/6/26 9:00 AM", "10/6/26 2:01 PM"));
    assert.deepEqual(codes(d), ["MISSED_FIRST_MEAL"]);
    assert.equal(d.status, "waivable");
  });

  it("uses total hours, not payable hours", () => {
    // 5.40 h on the clock with a 25-min break = 4.98 payable; total is what counts.
    const d = analyzeOne(row("A", "10/1/26 9:00 AM", "10/1/26 2:24 PM", 25 / 60));
    assert.equal(d.status, "waivable");
  });

  it("5.5 h with a 30-min break is fine", () => {
    assert.equal(analyzeOne(row("A", "10/1/26 9:00 AM", "10/1/26 2:30 PM", 0.5)).status, "compliant");
  });

  it("exactly 6.00 h with no break is still only a waiver candidate", () => {
    assert.equal(analyzeOne(row("A", "10/1/26 9:00 AM", "10/1/26 3:00 PM")).status, "waivable");
  });

  it("over 6 h with no break is critical", () => {
    const d = analyzeOne(row("A", "10/1/26 9:00 AM", "10/1/26 4:00 PM"));
    assert.equal(d.status, "critical");
    assert.equal(d.issues[0].critical, true);
  });

  it("over 6 h with a break under 30 min is critical", () => {
    const d = analyzeOne(row("A", "10/1/26 9:00 AM", "10/1/26 4:15 PM", 0.25));
    assert.deepEqual(codes(d), ["MISSED_FIRST_MEAL"]);
    assert.equal(d.status, "critical");
  });

  it("break time adds up across punches", () => {
    // Two 15-min unpaid breaks on separate punches = 30 min total.
    const d = analyzeOne(
      row("A", "10/1/26 9:00 AM", "10/1/26 1:00 PM", 0.25),
      row("A", "10/1/26 1:00 PM", "10/1/26 5:00 PM", 0.25, "Captain"),
    );
    assert.equal(d.status, "compliant");
  });

  it("a clock-out of 30+ min between punches counts as break time", () => {
    const d = analyzeOne(
      row("A", "10/1/26 9:00 AM", "10/1/26 1:00 PM"),
      row("A", "10/1/26 1:30 PM", "10/1/26 5:30 PM"),
    );
    assert.equal(d.status, "compliant");
  });

  it("clock-outs shorter than 30 min don't count", () => {
    const d = analyzeOne(
      row("A", "10/1/26 9:00 AM", "10/1/26 12:00 PM"),
      row("A", "10/1/26 12:20 PM", "10/1/26 4:00 PM"),
    );
    assert.equal(d.status, "critical"); // 6.67 h on the clock, no qualifying break
  });
});

describe("second meal: total > 10 h needs 60 min of break", () => {
  it("10.5 h with 30 min of break is a waiver candidate", () => {
    const d = analyzeOne(row("A", "10/1/26 8:00 AM", "10/1/26 6:30 PM", 0.5));
    assert.deepEqual(codes(d), ["MISSED_SECOND_MEAL"]);
    assert.equal(d.status, "waivable");
  });

  it("11 h with 60 min of break is fine", () => {
    assert.equal(analyzeOne(row("A", "10/1/26 8:00 AM", "10/1/26 7:00 PM", 1)).status, "compliant");
  });

  it("over 12 h with only 30 min of break is critical", () => {
    const d = analyzeOne(row("A", "10/1/26 8:00 AM", "10/1/26 8:30 PM", 0.5));
    assert.deepEqual(codes(d), ["MISSED_SECOND_MEAL"]);
    assert.equal(d.status, "critical");
  });

  it("over 10 h with no break reports both meals", () => {
    const d = analyzeOne(row("A", "10/1/26 8:00 AM", "10/1/26 7:00 PM"));
    assert.deepEqual(codes(d), ["MISSED_FIRST_MEAL", "MISSED_SECOND_MEAL"]);
    assert.equal(d.status, "critical");
  });
});

describe("workdays", () => {
  it("joins split shifts on the same date into one workday", () => {
    const d = analyzeOne(
      row("A", "9/30/26 9:08 AM", "9/30/26 3:03 PM", 0.53),
      row("A", "9/30/26 5:05 PM", "9/30/26 9:06 PM"),
    );
    assert.equal(d.workday.entries.length, 2);
  });

  it("keeps an overnight shift together instead of splitting at midnight", () => {
    const d = analyzeOne(
      row("A", "10/1/26 8:00 PM", "10/2/26 12:00 AM"),
      row("A", "10/2/26 12:00 AM", "10/2/26 3:00 AM", 0, "Captain"),
    );
    assert.equal(d.workday.isoDate, "2026-10-01");
    assert.equal(d.status, "critical"); // 7 h, no break
  });

  it("groups the same person despite inconsistent spacing", () => {
    const res = analyzeTimeEntries(
      [row("Liu, Jacky ", "10/2/26 1:32 PM", "10/2/26 5:31 PM"), row("Liu, Jacky", "10/2/26 5:31 PM", "10/2/26 8:56 PM")],
      HEADERS,
    );
    assert.equal(res.days.length, 1);
    assert.equal(res.days[0].status, "critical");
  });
});
