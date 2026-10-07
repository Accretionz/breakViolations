import type { ReactNode } from "react";
import type { AnalysisResult, DayResult, DayStatus } from "../compliance";
import { waiverKey } from "../waivers/waiverFolder";

type Props = {
  result: AnalysisResult;
  /** Waivers already signed (by waiver key), from the folder or this session. */
  signedKeys: { has(key: string): boolean };
  onSign: (day: DayResult) => void;
};

const SECTIONS: { status: DayStatus; title: string; blurb: string; open: boolean }[] = [
  {
    status: "critical",
    title: "Critical violations",
    blurb: "Over 6 h without a 30-min break, or over 12 h without 60 min of breaks. A waiver can't cover these.",
    open: true,
  },
  {
    status: "waivable",
    title: "Waiver candidates",
    blurb: "Over 5 h without a 30-min break, or over 10 h without 60 min of breaks. Covered only by a valid signed waiver.",
    open: true,
  },
];

export default function ResultsSection({ result, signedKeys, onSign }: Props) {
  const { summary } = result;

  return (
    <div className="results-section">
      <div className="stats">
        <Stat label="Critical violations" value={summary.criticalDays} tone="bad" />
        <Stat label="Waiver candidates" value={summary.waivableDays} tone="warn" />
      </div>

      {SECTIONS.map((s) => {
        const days = result.days.filter((d) => d.status === s.status);
        return (
          <details key={s.status} className={`result-group ${s.status}`} open={s.open && days.length > 0}>
            <summary>
              {s.title} ({days.length})
            </summary>
            <p className="muted">{s.blurb}</p>
            {days.length > 0 && (
              <DayTable
                days={days}
                action={
                  s.status === "waivable"
                    ? (d) =>
                        signedKeys.has(waiverKey(d)) ? (
                          <div className="signed">
                            ✓ Signed{" "}
                            <button type="button" className="link-button" onClick={() => onSign(d)}>
                              Re-sign
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="primary small" onClick={() => onSign(d)}>
                            Sign waiver
                          </button>
                        )
                    : undefined
                }
              />
            )}
          </details>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <h3>{label}</h3>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function DayTable({ days, action }: { days: DayResult[]; action?: (d: DayResult) => ReactNode }) {
  return (
    <table className="day-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Date</th>
          <th>Total hours</th>
          <th>Break time</th>
          <th>Punches</th>
          <th>Finding</th>
          {action && <th>Waiver</th>}
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={`${d.workday.employeeKey}|${d.workday.isoDate}`}>
            <td>{d.workday.employeeName}</td>
            <td>{d.workday.displayDate}</td>
            <td>{d.workday.totalHours.toFixed(2)} h</td>
            <td>{Math.round(d.workday.breakHours * 60)} min</td>
            <td>
              {d.workday.entries.map((e) => (
                <div key={e.line} className="punch">
                  {e.start.text.split(" ").slice(1).join(" ")}–{e.end.text.split(" ").slice(1).join(" ")}{" "}
                  <span className="muted">{e.jobTitle}</span>
                </div>
              ))}
            </td>
            <td>
              {d.issues.map((i) => (
                <div key={i.code}>{i.message}</div>
              ))}
            </td>
            {action && <td>{action(d)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
