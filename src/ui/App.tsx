import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "./controls";
import { EffectsNotice, NoiseReductionSection, PitchCorrectionSection, VocalBoostSection } from "./EffectsPanel";
import { Icon, LoopIcon, PauseIcon, PlayIcon, StopIcon, VolumeIcon } from "./icons";
import { MixdownSection, useMixdownExport } from "./MixdownPanel";
import { RecordingLane } from "./RecordingLane";
import { SeparationCard } from "./SeparationCard";
import { StemLanes } from "./StemLanes";
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
    const { undo, redo } = studio.getState().history;
    const separated = studio.getState().separation.status === "done";
    if (undo.length > 0 || redo.length > 0 || separated) setPendingFile(file);
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
      if (isTyping(e.target)) return;
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

  // Space toggles play/pause; B switches Original/Enhanced (not while typing or on a focused button).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const onControl = (e.target as HTMLElement).closest("select, button");
      if (e.code === "Space" && !onControl) {
        e.preventDefault();
        if (studio.getState().playing) studio.pause();
        else void studio.play();
      } else if (e.key.toLowerCase() === "b" && studio.getState().recording) {
        studio.setAB(studio.getState().transport.ab === "original" ? "processed" : "original");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [studio]);

  const openPicker = () => fileInput.current?.click();
  const reveal = (id: string) => {
    setPanelOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const separated = state.separation.status === "done";
  const separating = state.separation.status === "running";
  const exported = exporter.status.kind === "done";

  const steps: Step[] = [
    { label: "Import", state: recording ? "done" : "current", onClick: openPicker },
    {
      label: "Separate",
      state: separated ? "done" : recording ? "current" : "todo",
      onClick: () => (recording && !separating && !separated ? void studio.separate() : reveal("main-top")),
    },
    { label: "Enhance", state: separated ? (exported ? "done" : "current") : "todo", onClick: () => reveal("effects") },
    { label: "Export", state: exported ? "done" : separated ? "next" : "todo", onClick: () => reveal("mixdown") },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          Audio Enhancer
        </div>
        {recording && (
          <div className="file">
            <span className="file-name" title={recording.name}>{recording.name}</span>
            <span className="muted num">{fmtShort(recording.durationSec)}</span>
            <button className="btn small" onClick={openPicker}>Replace…</button>
          </div>
        )}
        <Stepper steps={steps} />
        <div className="history" role="group" aria-label="Undo and redo">
          <button
            className="icon-btn"
            title={undoTip("Undo", state.history.undo.at(-1), "Ctrl+Z")}
            aria-label="Undo"
            disabled={!state.history.undo.length}
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="icon-btn"
            title={undoTip("Redo", state.history.redo.at(-1), "Ctrl+Shift+Z")}
            aria-label="Redo"
            disabled={!state.history.redo.length}
            onClick={redo}
          >
            ↷
          </button>
        </div>
      </header>

      <div className={`shell${panelOpen ? "" : " nopanel"}`}>
        <nav className="rail" aria-label="Tools">
          <button data-tip="Import a Recording" aria-label="Import a Recording" onClick={openPicker}>
            <Icon name="import" />
          </button>
          <button
            data-tip={!recording ? "Separate into Stems (import a Recording first)" : separated ? "Already separated" : "Separate into Stems"}
            aria-label="Separate into Stems"
            className={separating ? "on" : ""}
            disabled={!recording || separated || separating}
            onClick={() => void studio.separate()}
          >
            <Icon name="separate" />
          </button>
          <button
            data-tip={separated ? "Go to the Stem mixer" : "Stem mixer (after Separation)"}
            aria-label="Stem mixer"
            disabled={!separated}
            onClick={() => document.getElementById("stems")?.scrollIntoView({ behavior: "smooth" })}
          >
            <Icon name="mixer" />
          </button>
          <button
            data-tip={panelOpen ? "Hide the effects panel" : "Show the effects panel"}
            aria-label="Toggle effects panel"
            aria-pressed={panelOpen}
            className={panelOpen ? "on" : ""}
            onClick={() => setPanelOpen((o) => !o)}
          >
            <Icon name="effects" />
          </button>
          <button
            data-tip={recording ? "Export the Mixdown" : "Export (import a Recording first)"}
            aria-label="Export Mixdown"
            disabled={!recording || exporter.status.kind === "running"}
            onClick={() => void exporter.run()}
          >
            <Icon name="export" />
          </button>
        </nav>

        <main className="main" id="main-top">
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Dismiss" onClick={() => setError(null)}>×</button>
            </div>
          )}
          {recording ? (
            <>
              <RecordingLane
                studio={studio}
                peaks={peaks}
                duration={recording.durationSec}
                position={position}
                trim={state.mix.trim}
                onGestureEnd={(handle) => studio.commit(HANDLE_LABELS[handle])}
              />
              <SeparationCard studio={studio} state={state} />
              <StemLanes studio={studio} state={state} position={position} />
            </>
          ) : (
            <button className="drop" onClick={openPicker}>
              <Icon name="import" />
              <h2>Drop your Recording here</h2>
              <div className="muted">or click to choose a file · M4A, MP3, WAV or OGG</div>
              <div className="dim">Everything stays on your computer.</div>
            </button>
          )}
        </main>

        <aside className="panel" aria-label="Effects and Mixdown">
          <div className="ph" id="effects">
            <span className="sc">Effects</span>
            {state.processingVocals && (
              <span className="updating" role="status">
                <span className="spinner small" aria-hidden="true" /> Updating vocals…
              </span>
            )}
          </div>
          <EffectsNotice studio={studio} state={state} />
          <NoiseReductionSection studio={studio} state={state} />
          <VocalBoostSection studio={studio} state={state} />
          <PitchCorrectionSection studio={studio} state={state} />
          <div id="mixdown">
            <MixdownSection studio={studio} state={state} exporter={exporter} />
          </div>
        </aside>
      </div>

      <footer className="transport">
        <button
          className="tbtn play"
          aria-label={state.playing ? "Pause" : "Play"}
          title={state.playing ? "Pause (Space)" : "Play (Space)"}
          disabled={!recording}
          onClick={() => (state.playing ? studio.pause() : void studio.play())}
        >
          {state.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tbtn" aria-label="Stop" title="Stop and go back to the start" disabled={!recording} onClick={() => studio.stop()}>
          <StopIcon />
        </button>
        <button
          className={`tbtn${state.transport.loop ? " on" : ""}`}
          aria-label="Loop"
          aria-pressed={state.transport.loop}
          title="Loop the trimmed part"
          disabled={!recording}
          onClick={() => studio.setLoop(!state.transport.loop)}
        >
          <LoopIcon />
        </button>
        <span className="clock num" aria-label="Time">
          {fmtClock(position)} <span className="dim">/ {fmtClock(recording?.durationSec ?? 0)}</span>
        </span>
        <div className="ab" title="Compare with the untouched Recording (B)">
          <Segmented<"original" | "processed">
            label="Compare"
            value={state.transport.ab}
            disabled={!recording}
            options={[
              { value: "original", label: "Original" },
              { value: "processed", label: "Enhanced" },
            ]}
            onChange={(v) => studio.setAB(v)}
          />
        </div>
        <span className="grow" />
        <label className="vol" title="Listening volume — only what you hear, never the Mixdown">
          <VolumeIcon />
          <input
            type="range"
            aria-label="Listening volume"
            min={0}
            max={100}
            value={Math.round(state.transport.listeningVolume * 100)}
            style={{ "--fill": `${state.transport.listeningVolume * 100}%` } as React.CSSProperties}
            onChange={(e) => studio.setListeningVolume(Number(e.target.value) / 100)}
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
              Opening “{pendingFile.name}” discards your Stems and edits for “{recording?.name}”. This can't be undone.
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

interface Step {
  label: string;
  state: "done" | "current" | "next" | "todo";
  onClick: () => void;
}

/** Where you are in Import → Separate → Enhance → Export; each step jumps to its controls. */
function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="stepper" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.label} className={s.state}>
          <button onClick={s.onClick} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="step-num" aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</span>
            {s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** True while the user is typing text, where keyboard shortcuts must not fire. */
const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "file", "color"]);
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest("textarea, [contenteditable]:not([contenteditable=false])")) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type);
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
