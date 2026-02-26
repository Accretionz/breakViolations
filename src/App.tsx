import { useState } from "react";

import Header from "./components/Header";
import UploadArea from "./components/UploadArea";

import { analyzeBreaks } from "./utils/analyzeBreaks";
import ResultsSection from "./components/ResultSelection";

export default function App() {
  const [violations, setViolations] = useState<any>(null);

  const [fileName, setFileName] = useState("");

  return (
    <div className="app-container">
      <div className="main-card">
        <Header />

        <UploadArea
          onComplete={(data, file) => {
            setFileName(file.name);

            const result = analyzeBreaks(data);

            setViolations(result);
          }}
        />

        <ResultsSection violations={violations} fileName={fileName} />
      </div>
    </div>
  );
}
