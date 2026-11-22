import { useEffect, useMemo, useRef, useState } from "react";
import { Chevron, Icon, LoopIcon, PauseIcon, PlayIcon, StopIcon } from "./icons";
import { MixdownPanel, useMixdownExport } from "./MixdownPanel";
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const toast = useToast();
  const exporter = useMixdownExport(studio);

  const loadFile = async (file: File) => {
    try {
      await studio.load(file);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Import, asking first if that would throw away edits to the current Mix. */
  const importFile = (file: File | undefined) => {
    if (!file) return;
    if (studio.getState().history.undo.length > 0) setPendingFile(file);
    else void loadFile(file);
  };

  const undo = () => {
    const label = studio.getState().history.undo.at(-1);
    if (!label) return;
    studio.undo();
    toast.show(`Undo: ${label}`);
  };
  const redo = () => {
    const label = studio.getState().history.redo.at(-1);
    if (!label) return;
    studio.redo();
    toast.show(`Redo: ${label}`);
  };
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };

  // Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo. Ignored while typing.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if ((e.target as HTMLElement).closest("input[type=text], textarea, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) undoRef.current.undo();
      else if ((k === "z" && e.shiftKey) || k === "y") undoRef.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

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
      importFile(e.dataTransfer?.files[0]);
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
          <button
            className="hist"
            data-tip={undoTip("Undo", state.history.undo.at(-1), "Ctrl+Z")}
            aria-label="Undo"
            disabled={!state.history.undo.length}
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="hist"
            data-tip={undoTip("Redo", state.history.redo.at(-1), "Ctrl+Shift+Z")}
            aria-label="Redo"
            disabled={!state.history.redo.length}
            onClick={redo}
          >
            ↷
          </button>
          <div className="rail-sep" />
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
          <button
            data-tip="Export Mixdown"
            aria-label="Export"
            disabled={!recording || exporter.status.kind === "running"}
            onClick={() => void exporter.run()}
          >
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
                onGestureEnd={(handle) => studio.commit(HANDLE_LABELS[handle])}
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
          {["Noise Reduction", "Vocal Boost", "Pitch Correction"].map((title) => (
            <PanelSection key={title} title={title}>
              <div className="dim">Coming soon.</div>
            </PanelSection>
          ))}
          <PanelSection title="Mixdown">
            <MixdownPanel studio={studio} state={state} exporter={exporter} />
          </PanelSection>
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
          importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {dragging && <div className="dropping">Drop to import your Recording</div>}
      {toast.text && <div className="toast" role="status">{toast.text}</div>}
      {pendingFile && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="replace-title">
          <div className="modal">
            <h3 id="replace-title">Replace this Recording?</h3>
            <p className="muted">
              Opening “{pendingFile.name}” discards your edits to “{recording?.name}”. This can't be undone.
            </p>
            <div className="modal-actions">
              <button className="btn" autoFocus onClick={() => setPendingFile(null)}>Keep editing</button>
              <button
                className="btn danger"
                onClick={() => {
                  const f = pendingFile;
                  setPendingFile(null);
                  void loadFile(f);
                }}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const HANDLE_LABELS = { start: "Trim start", end: "Trim end", fadeIn: "Fade in", fadeOut: "Fade out" } as const;

const undoTip = (verb: string, label: string | undefined, keys: string) =>
  label ? `${verb} ${label} (${keys})` : `Nothing to ${verb.toLowerCase()}`;

/** A brief, quiet message (e.g. "Undo: Trim start"). */
function useToast() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number>(0);
  return {
    text,
    show(message: string) {
      setText(message);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(null), 1400);
    },
  };
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

