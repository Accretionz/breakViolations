import Papa from "papaparse";

type Props = {
  onComplete: (data: any[], file: File) => void;
};

export default function UploadArea({ onComplete }: Props) {
  const processFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,

      complete: (results) => {
        onComplete(results.data, file);
      },
    });
  };

  return (
    <div className="upload-section">
      <input
        type="file"
        accept=".csv"
        onChange={(e) => {
          if (!e.target.files) return;

          processFile(e.target.files[0]);
        }}
      />
    </div>
  );
}
