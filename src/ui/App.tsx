import { useEffect, useMemo, useRef, useState } from "react";
import { Chevron, Icon, LoopIcon, PauseIcon, PlayIcon, StopIcon } from "./icons";
import { RecordingLane } from "./RecordingLane";
import { fmtClock, fmtShort, usePosition, useStudio } from "./useStudio";

const PEAK_COUNT = 1200;

export function App() {
  const { studio, state } = useStudio();
  const [panelOpen, setPanelOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const position = usePosition(studio, state.playing, state.cursor);
  const { recording } = state;

  const peaks = useMemo(() => (recording ? studio.getPeaks(PEAK_COUNT) : []), [studio, recording]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await studio.load(file);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Drag and drop anywhere on the Studio.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void importFile(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  // Space bar toggles play/pause (except while typing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== "Space" || t.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (studio.getState().playing) studio.pause();
      else void studio.play();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [studio]);

  const openPicker = () => fileInput.current?.click();

  return (
    <div className="app">
      <div className={`shell${panelOpen ? "" : " nopanel"}`}>
        <nav className="rail" aria-label="Tools">
          <button data-tip="Import a Recording" aria-label="Import a Recording" onClick={openPicker}>
            <Icon name="import" />
          </button>
          <button data-tip="Separate into Stems (coming soon)" aria-label="Separate" disabled>
            <Icon name="separate" />
          </button>
          <button data-tip="Mixer (coming soon)" aria-label="Mixer" disabled>
            <Icon name="mixer" />
          </button>
          <button
            data-tip={panelOpen ? "Hide effects panel" : "Show effects panel"}
            aria-label="Toggle effects panel"
            className={panelOpen ? "on" : ""}
            onClick={() => setPanelOpen((o) => !o)}
          >
            <Icon name="effects" />
          </button>
          <button data-tip="Export Mixdown (coming soon)" aria-label="Export" disabled>
            <Icon name="export" />
          </button>
        </nav>

        <main className="main">
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Dismiss" onClick={() => setError(null)}>×</button>
            </div>
          )}
          {recording ? (
            <>
              <div className="mhead">
                <span className="name">{recording.name}</span>
                <span className="muted num">{fmtShort(recording.durationSec)}</span>
                <button className="btn" onClick={openPicker}>Replace…</button>
              </div>
              <RecordingLane
                studio={studio}
                peaks={peaks}
                duration={recording.durationSec}
                position={position}
                trim={state.mix.trim}
              />
            </>
          ) : (
            <button className="drop" onClick={openPicker}>
              <h2>Drop your Recording here</h2>
              <div className="muted">or click to choose a file · M4A, MP3, WAV or OGG · stays on your computer</div>
            </button>
          )}
        </main>

        <aside className="panel" aria-label="Properties">
          <div className="ph sc">Properties</div>
          {["Noise Reduction", "Vocal Boost", "Pitch Correction", "Mixdown"].map((title) => (
            <PanelSection key={title} title={title}>
              <div className="dim">Coming soon.</div>
            </PanelSection>
          ))}
        </aside>
      </div>

      <footer className="transport">
        <button
          className="tbtn play"
          aria-label={state.playing ? "Pause" : "Play"}
          disabled={!recording}
          onClick={() => (state.playing ? studio.pause() : void studio.play())}
        >
          {state.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tbtn" aria-label="Stop" disabled={!recording} onClick={() => studio.stop()}>
          <StopIcon />
        </button>
        <button
          className={`tbtn${state.transport.loop ? " on" : ""}`}
          aria-label="Loop"
          aria-pressed={state.transport.loop}
          title="Loop the trimmed range"
          onClick={() => studio.setLoop(!state.transport.loop)}
        >
          <LoopIcon />
        </button>
        <span className="clock num" aria-label="Time">
          {fmtClock(position)} <span className="dim">/ {fmtClock(recording?.durationSec ?? 0)}</span>
        </span>
        <span className="grow" />
        <label className="vol" title="Master volume (listening only — doesn't change the Mixdown)">
          <span className="sc">Vol</span>
          <input
            type="range"
            aria-label="Master volume"
            min={0}
            max={100}
            value={Math.round(state.transport.masterVolume * 100)}
            onChange={(e) => studio.setMasterVolume(Number(e.target.value) / 100)}
          />
        </label>
      </footer>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {dragging && <div className="dropping">Drop to import your Recording</div>}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`acc${open ? " open" : ""}`}>
      <button className="acc-h" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Chevron />
        <span className="sc">{title}</span>
      </button>
      {open && <div className="acc-b">{children}</div>}
    </section>
  );
}

