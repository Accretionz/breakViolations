import { useEffect, useMemo, useState } from "react";

import DownloadWaiversButton from "./components/DownloadWaiversButton";
import Header from "./components/Header";
import ResultsSection from "./components/ResultsSection";
import SignWaiverDialog from "./components/SignWaiverDialog";
import UploadArea from "./components/UploadArea";
import { analyzeTimeEntries, type AnalysisResult, type DayResult } from "./compliance";
import {
  canUseFolders,
  connectRoot,
  downloadPdf,
  downloadWaiverZip,
  findSignedWaivers,
  getConnectedRoot,
  getRememberedFolderName,
  saveSignedToFolder,
  writeWaiverFolder,
} from "./utils/waiverStorage";
import {
  buildWaiverFolder,
  renderWaiverFor,
  waiverKey,
  waiverLocation,
  type SignedWaiver,
} from "./waivers/waiverFolder";
import {
  payPeriodFolderName,
  payPeriodFromDays,
  payPeriodFromFileName,
  payPeriodLabel,
  type PayPeriod,
} from "./waivers/payPeriod";

export default function App() {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pay period from the CSV file name, e.g. TimeEntries_2026_09_21-2026_10_04.csv
  const [payPeriod, setPayPeriod] = useState<PayPeriod | null>(null);

  // The persistent "Meal Break Waivers" folder (Chrome/Edge) and what's already signed in it.
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [rememberedFolder, setRememberedFolder] = useState<string | null>(null);
  const [signedOnDisk, setSignedOnDisk] = useState<Map<string, string>>(new Map());
  // Signed this session (needed for the .zip fallback in browsers without folder access).
  const [signedSession, setSignedSession] = useState<Map<string, SignedWaiver>>(new Map());

  const [signing, setSigning] = useState<DayResult | null>(null);
  const [notice, setNotice] = useState("");

  const waiverDays = useMemo(() => result?.days.filter((d) => d.status === "waivable") ?? [], [result]);
  const signedKeys = useMemo(
    () => new Set([...signedOnDisk.keys(), ...signedSession.keys()]),
    [signedOnDisk, signedSession],
  );

  // Reconnect to the folder from a previous visit (works without a prompt if the browser allows it).
  useEffect(() => {
    getRememberedFolderName().then(setRememberedFolder);
    getConnectedRoot().then((r) => r && setRoot(r));
  }, []);

  useEffect(() => {
    if (root) setRememberedFolder(root.name);
  }, [root]);

  // Whenever a CSV is loaded or the folder changes, check which waivers are already signed.
  useEffect(() => {
    if (!root || !waiverDays.length) return;
    let cancelled = false;
    findSignedWaivers(root, waiverDays)
      .then((found) => !cancelled && setSignedOnDisk(found))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [root, waiverDays]);

  const downloadWaivers = async () => {
    if (!result || !payPeriod) return "";
    const folder = buildWaiverFolder(result, signedSession);
    if (!canUseFolders()) {
      await downloadWaiverZip(folder, payPeriodFolderName(payPeriod));
      return "Downloaded as a .zip (this browser can't save folders directly).";
    }
    const r = await connectRoot();
    if (!r) return "";
    setRoot(r);
    const onDisk = await findSignedWaivers(r, waiverDays);
    setSignedOnDisk(onDisk);
    const { written, kept, locked, periodFolder } = await writeWaiverFolder(r, payPeriod, folder, onDisk);
    return (
      `Saved ${written} blank form${written === 1 ? "" : "s"} to ${r.name}/${periodFolder}` +
      (kept ? `; kept ${kept} signed waiver${kept === 1 ? "" : "s"} untouched.` : ".") +
      (locked.length
        ? ` Couldn't update ${locked.join(", ")} — close ${locked.length === 1 ? "it" : "them"} if open in a PDF viewer, or let OneDrive finish syncing, then click again.`
        : "")
    );
  };

  const changeFolder = async () => {
    const r = await connectRoot({ choose: true });
    if (r) setRoot(r);
  };

  const reconnect = async () => {
    const r = await connectRoot();
    if (r) setRoot(r);
  };

  return (
    <div className="app-container">
      <div className="card">
        <div className="top-bar">
          <Header />
          {result && (
            <DownloadWaiversButton
              disabled={waiverDays.length === 0}
              onDownload={downloadWaivers}
              folderName={root?.name ?? null}
              rememberedFolderName={rememberedFolder}
              onReconnect={reconnect}
              onChangeFolder={canUseFolders() ? changeFolder : undefined}
            />
          )}
        </div>

        <UploadArea
          onParsed={(rows, headers, file) => {
            setSignedSession(new Map());
            setSignedOnDisk(new Map());
            setNotice("");
            try {
              const analysis = analyzeTimeEntries(rows, headers);
              setResult(analysis);
              setPayPeriod(payPeriodFromFileName(file.name) ?? payPeriodFromDays(analysis.days));
              setError(null);
            } catch (e) {
              setResult(null);
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          onError={(message) => {
            setResult(null);
            setPayPeriod(null);
            setNotice("");
            setError(message);
          }}
        />

        {error && <div className="error-box">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        {result && !root && rememberedFolder && waiverDays.length > 0 && (
          <div className="notice warn">
            Reconnect the {rememberedFolder} folder (top right) to see which waivers are already signed.
          </div>
        )}

        {result && payPeriod && <div className="pay-period">Pay period: {payPeriodLabel(payPeriod)}</div>}

        {result && <ResultsSection result={result} signedKeys={signedKeys} onSign={setSigning} />}
      </div>

      {signing && (
        <SignWaiverDialog
          day={signing}
          onCancel={() => setSigning(null)}
          onSave={async (signatures, mealBreakIsoDate) => {
            const key = waiverKey(signing);
            const pdf = renderWaiverFor(signing, signatures, mealBreakIsoDate);
            const { folderName, fileName } = waiverLocation(signing, mealBreakIsoDate);

            if (canUseFolders() && payPeriod) {
              const r = await connectRoot();
              if (!r) throw new Error("Choose the Meal Break Waivers folder to save into.");
              setRoot(r);
              const path = await saveSignedToFolder(
                r,
                payPeriod,
                folderName,
                fileName,
                pdf,
                waiverLocation(signing).fileName,
              );
              setSignedOnDisk((prev) => new Map(prev).set(key, path));
              setNotice(`Saved to ${r.name}/${path}`);
            } else {
              downloadPdf(fileName, pdf);
              setNotice(`Downloaded ${fileName}`);
            }
            setSignedSession((prev) => new Map(prev).set(key, { fileName, pdf }));
            setSigning(null);
          }}
        />
      )}
    </div>
  );
}
