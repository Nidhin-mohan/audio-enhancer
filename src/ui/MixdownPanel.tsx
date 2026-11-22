import { useEffect, useState } from "react";
import type { MixdownFormat, MixdownLoudness, Studio, StudioState } from "../engine/studio";

const FORMATS: { value: MixdownFormat; label: string }[] = [
  { value: "mp3", label: "MP3 · 320 kbps (plays everywhere)" },
  { value: "wav", label: "WAV · 16-bit (lossless, large)" },
  { value: "aac", label: "AAC · 256 kbps (.m4a)" },
];
const LOUDNESS: { value: MixdownLoudness; label: string }[] = [
  { value: -14, label: "-14 LUFS · streaming (recommended)" },
  { value: -16, label: "-16 LUFS · a little quieter" },
  { value: -9, label: "-9 LUFS · loud" },
];

type ExportStatus = { kind: "idle" } | { kind: "running"; progress: number } | { kind: "done"; fileName: string } | { kind: "error"; message: string };

/** Hand a finished file to the browser's normal download/save flow. */
function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function useMixdownExport(studio: Studio) {
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const run = async () => {
    if (status.kind === "running") return;
    setStatus({ kind: "running", progress: 0 });
    try {
      const { blob, fileName } = await studio.exportMixdown((progress) => setStatus({ kind: "running", progress }));
      saveFile(blob, fileName);
      setStatus({ kind: "done", fileName });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };
  return { status, run };
}

export function MixdownPanel(props: {
  studio: Studio;
  state: StudioState;
  exporter: ReturnType<typeof useMixdownExport>;
}) {
  const { studio, state, exporter } = props;
  const { format, loudness } = state.mix.mixdown;
  const [supported, setSupported] = useState<MixdownFormat[]>(["mp3", "wav"]);
  useEffect(() => {
    void studio.supportedMixdownFormats().then(setSupported);
  }, [studio, state.recording]);
  const { status } = exporter;
  const disabled = !state.recording || status.kind === "running";

  return (
    <>
      <label className="field">
        <span>Format</span>
        <select
          value={format}
          disabled={!state.recording}
          onChange={(e) => {
            studio.setMixdown({ format: e.target.value as MixdownFormat });
            studio.commit("Mixdown format");
          }}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value} disabled={!supported.includes(f.value)}>
              {f.label}
              {supported.includes(f.value) ? "" : " — not available in this browser"}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Loudness</span>
        <select
          value={loudness}
          disabled={!state.recording}
          onChange={(e) => {
            studio.setMixdown({ loudness: Number(e.target.value) as MixdownLoudness });
            studio.commit("Mixdown loudness");
          }}
        >
          {LOUDNESS.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </label>
      <button className="btn primary" disabled={disabled} onClick={() => void exporter.run()}>
        {status.kind === "running" ? "Exporting…" : "Export Mixdown"}
      </button>
      {status.kind === "running" && (
        <div className="bar" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${status.progress * 100}%` }} />
        </div>
      )}
      {status.kind === "done" && <div className="ok" role="status">Mixdown ready: {status.fileName}</div>}
      {status.kind === "error" && <div className="error" role="alert">{status.message}</div>}
      {!state.recording && <div className="dim">Import a Recording to export a Mixdown.</div>}
    </>
  );
}
