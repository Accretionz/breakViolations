import { useState } from "react";

type Props = {
  disabled: boolean;
  /** Does the work; returns a status message to show under the button ("" for none). */
  onDownload: () => Promise<string>;
  /** Name of the connected waiver folder, if any. */
  folderName: string | null;
  /** A folder remembered from a previous visit that needs a click to reconnect. */
  rememberedFolderName: string | null;
  onReconnect: () => void;
  /** Shown only in browsers that can use folders. */
  onChangeFolder?: () => void;
};

export default function DownloadWaiversButton({
  disabled,
  onDownload,
  folderName,
  rememberedFolderName,
  onReconnect,
  onChangeFolder,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const handleClick = async () => {
    setBusy(true);
    setStatus("");
    try {
      setStatus(await onDownload());
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="download-waivers">
      <button
        className="primary"
        onClick={handleClick}
        disabled={busy || disabled}
        title={disabled ? "No waiver candidates" : "Save blank waivers; signed ones are never overwritten"}
      >
        {busy ? "Saving…" : "Download Waiver Folder"}
      </button>
      {onChangeFolder && (
        <div className="muted">
          {folderName ? (
            <>
              Folder: {folderName} ·{" "}
              <button type="button" className="link-button" onClick={onChangeFolder}>
                Change
              </button>
            </>
          ) : rememberedFolderName ? (
            <>
              Folder: {rememberedFolderName} (not connected) ·{" "}
              <button type="button" className="link-button" onClick={onReconnect}>
                Reconnect
              </button>
            </>
          ) : (
            <>
              No folder chosen yet ·{" "}
              <button type="button" className="link-button" onClick={onChangeFolder}>
                Choose
              </button>
            </>
          )}
        </div>
      )}
      {status && <div className="muted">{status}</div>}
    </div>
  );
}
