import { useEffect, useState } from "react";
import type { MixdownFormat, MixdownLoudness, Studio, StudioState } from "../engine/studio";
import { Section, Segmented } from "./controls";

type ExportStatus =
  | { kind: "idle" }
  | { kind: "running"; progress: number }
  | { kind: "done"; fileName: string }
  | { kind: "error"; message: string };

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

const FORMAT_HINT: Record<MixdownFormat, string> = {
  mp3: "MP3 · 320 kbps — plays everywhere (WhatsApp, Instagram, YouTube…)",
  wav: "WAV · 16-bit — lossless, large file",
  aac: "AAC · 256 kbps (.m4a) — small, great quality",
};
const LOUDNESS_HINT: Record<MixdownLoudness, string> = {
  [-16]: "-16 LUFS — a little quieter, more dynamic",
  [-14]: "-14 LUFS — the standard for streaming apps",
  [-9]: "-9 LUFS — loud, like commercial pop",
};

export function MixdownSection(props: {
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
  const disabled = !state.recording;

  return (
    <Section title="Mixdown" badge={format.toUpperCase()}>
      <div className="field-label">Format</div>
      <Segmented<MixdownFormat>
        label="Format"
        value={format}
        disabled={disabled}
        options={(["mp3", "wav", "aac"] as const).map((f) => ({
          value: f,
          label: f.toUpperCase(),
          disabled: !supported.includes(f),
          title: supported.includes(f) ? FORMAT_HINT[f] : "Not available in this browser",
        }))}
        onChange={(f) => {
          studio.setMixdown({ format: f });
          studio.commit("Mixdown format");
        }}
      />
      <div className="hint-text">{FORMAT_HINT[format]}</div>
      <div className="field-label">Loudness</div>
      <Segmented<MixdownLoudness>
        label="Loudness"
        value={loudness}
        disabled={disabled}
        options={([-16, -14, -9] as const).map((l) => ({
          value: l,
          label: l === -14 ? "Streaming" : l === -16 ? "Quieter" : "Loud",
          title: LOUDNESS_HINT[l],
        }))}
        onChange={(l) => {
          studio.setMixdown({ loudness: l });
          studio.commit("Mixdown loudness");
        }}
      />
      <div className="hint-text">{LOUDNESS_HINT[loudness]}</div>
      <button
        className="btn primary wide"
        disabled={disabled || status.kind === "running"}
        onClick={() => void exporter.run()}
      >
        {status.kind === "running" ? `Exporting… ${Math.round(status.progress * 100)}%` : "Export Mixdown"}
      </button>
      {status.kind === "running" && (
        <div className="bar" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${status.progress * 100}%` }} />
        </div>
      )}
      {status.kind === "done" && <div className="ok" role="status">✓ Saved {status.fileName}</div>}
      {status.kind === "error" && <div className="error" role="alert">{status.message}</div>}
      {disabled && <div className="hint-text">Import a Recording to export a Mixdown.</div>}
      {!disabled && state.separation.status !== "done" && (
        <div className="hint-text">Tip: separate first to include Noise Reduction, Vocal Boost and Pitch Correction.</div>
      )}
    </Section>
  );
}
