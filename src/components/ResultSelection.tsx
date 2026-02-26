import { downloadSummary, downloadZip } from "../utils/reportUtils";

type Props = {
  violations: any;
  fileName: string;
};

export default function ResultsSection({ violations, fileName }: Props) {
  if (!violations) return null;

  const total = violations.critical.length + violations.standard.length;

  return (
    <div className="results-section show">
      <h2>Break Compliance Report</h2>

      <div>
        Total Violations:
        {total}
      </div>

      <h3>
        Critical:
        {violations.critical.length}
      </h3>

      {violations.critical.map((v: any, i: number) => (
        <div key={i}>
          {v.employee} {v.date}
        </div>
      ))}

      <h3>
        Standard:
        {violations.standard.length}
      </h3>

      {violations.standard.map((v: any, i: number) => (
        <div key={i}>
          {v.employee} {v.date}
        </div>
      ))}

      <button onClick={() => downloadSummary(violations)}>
        Download Summary
      </button>

      <button onClick={() => downloadZip(violations, fileName)}>
        Download ZIP
      </button>
    </div>
  );
}
