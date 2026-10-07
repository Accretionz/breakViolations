import Papa from "papaparse";
import type { RawRow } from "../compliance";

type Props = {
  onParsed: (rows: RawRow[], headers: string[], file: File) => void;
  onError: (message: string) => void;
};

export default function UploadArea({ onParsed, onError }: Props) {
  const processFile = (file: File) => {
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        if (!results.data.length) {
          onError("The file has no data rows.");
          return;
        }
        onParsed(results.data, results.meta.fields ?? [], file);
      },
      error: (err) => onError(`Couldn't read the file: ${err.message}`),
    });
  };

  return (
    <div className="upload-box">
      <p>Upload a time-entries CSV export</p>
      <input
        className="upload-input"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
          e.target.value = ""; // allow re-uploading the same file
        }}
      />
    </div>
  );
}
