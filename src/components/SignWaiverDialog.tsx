import { useState } from "react";
import type { DayResult } from "../compliance";
import type { ImageMask } from "../waivers/simplePdf";
import { isoToShortDate, personDisplayName } from "../waivers/waiverFolder";
import { FORM_TEXT, STORE_DEPARTMENT, type WaiverSignatures } from "../waivers/waiverForm";
import SignaturePad from "./SignaturePad";

type Props = {
  day: DayResult;
  onCancel: () => void;
  /** mealBreakIsoDate: the date chosen for the waiver, YYYY-MM-DD. */
  onSave: (signatures: WaiverSignatures, mealBreakIsoDate: string) => Promise<void>;
};

/** Shows the waiver for one shift and collects the employee's (and supervisor's) signature. */
export default function SignWaiverDialog({ day, onCancel, onSave }: Props) {
  const [employeeSignature, setEmployeeSignature] = useState<ImageMask | null>(null);
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorSignature, setSupervisorSignature] = useState<ImageMask | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mealBreakIsoDate, setMealBreakIsoDate] = useState(day.workday.isoDate);
  const mealBreakDate = mealBreakIsoDate ? isoToShortDate(mealBreakIsoDate) : "";

  const missing = !mealBreakIsoDate
    ? "Choose the meal break date."
    : !employeeSignature
    ? "The employee needs to sign."
    : supervisorSignature && !supervisorName.trim()
      ? "Enter the supervisor's name."
      : "";

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(
        {
          employeeSignature: employeeSignature ?? undefined,
          supervisorName: supervisorName.trim() || undefined,
          supervisorSignature: supervisorSignature ?? undefined,
        },
        mealBreakIsoDate,
      );
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="waiver-title">
        <h2 id="waiver-title">{FORM_TEXT.title}</h2>

        <dl className="waiver-fields">
          <dt>Employee Name</dt>
          <dd>{personDisplayName(day.workday.employeeName)}</dd>
          <dt>Store/Department</dt>
          <dd>{STORE_DEPARTMENT}</dd>
        </dl>

        <div className="waiver-text">
          <p>{FORM_TEXT.intro}</p>
          {[FORM_TEXT.first, FORM_TEXT.second].map((section) => (
            <div key={section.heading}>
              <h4>{section.heading}</h4>
              <ul>
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
          <p>{FORM_TEXT.closing}</p>
        </div>

        <label className="text-field date-field">
          Meal break date this waiver is for
          <input
            type="date"
            value={mealBreakIsoDate}
            onChange={(e) => setMealBreakIsoDate(e.target.value)}
          />
          {mealBreakIsoDate !== day.workday.isoDate && (
            <span className="muted">Flagged date was {day.workday.displayDate}.</span>
          )}
        </label>

        <SignaturePad label="Employee's signature" onChange={setEmployeeSignature} />
        <div className="muted">Meal break date: {mealBreakDate}</div>

        <label className="text-field">
          Supervisor name
          <input value={supervisorName} onChange={(e) => setSupervisorName(e.target.value)} />
        </label>
        <SignaturePad label="Supervisor's signature (optional now)" onChange={setSupervisorSignature} />
        <div className="muted">Meal break date: {mealBreakDate}</div>

        {error && <div className="error-box">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={save}
            disabled={saving || Boolean(missing)}
            title={missing || undefined}
          >
            {saving ? "Saving…" : "Save signed form"}
          </button>
        </div>
      </div>
    </div>
  );
}
