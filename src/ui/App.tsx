import { useEffect, useMemo, useRef, useState } from "react";
import type { Studio } from "../engine/studio";
import { Chevron, Icon, PauseIcon, PlayIcon, StopIcon } from "./icons";
import { fmtClock, fmtShort, usePosition, useStudio } from "./useStudio";
import { Waveform } from "./Waveform";

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
        <span className="clock num" aria-label="Time">
          {fmtClock(position)} <span className="dim">/ {fmtClock(recording?.durationSec ?? 0)}</span>
        </span>
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

function RecordingLane(props: { studio: Studio; peaks: number[]; duration: number; position: number }) {
  const { studio, peaks, duration, position } = props;
  const seekFromEvent = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    studio.seek(((e.clientX - r.left) / r.width) * duration);
  };
  const step = duration > 120 ? 30 : duration > 40 ? 10 : duration > 10 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <div className="lane">
      <div className="ruler" onPointerDown={seekFromEvent}>
        {ticks.map((t) => (
          <span key={t}>
            <span className="tk" style={{ left: pct(t) }} />
            <span className="tl num" style={{ left: pct(t) }}>{fmtShort(t)}</span>
          </span>
        ))}
      </div>
      <div
        className="wavebox"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}
      >
        <Waveform peaks={peaks} color="#9aa3b2" />
        <div className="playhead" style={{ left: pct(position) }} />
      </div>
    </div>
  );
}
