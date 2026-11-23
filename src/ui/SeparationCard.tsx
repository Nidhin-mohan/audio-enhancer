import { useEffect, useState } from "react";
import { isSeparationModelCached } from "../engine/separation";
import type { Studio, StudioState } from "../engine/studio";
import { Icon } from "./icons";

/** Measured on the target laptop: about 2.2 s of processing per second of audio. */
const SECONDS_PER_AUDIO_SECOND = 2.2;

/** "less than a minute" / "about 3 min". */
const durationPhrase = (sec: number) => (sec < 60 ? "less than a minute" : `about ${Math.round(sec / 60)} min`);

/** The call to action for Separation, its progress, and what to do if it fails. */
export function SeparationCard({ studio, state }: { studio: Studio; state: StudioState }) {
  const sep = state.separation;
  const duration = state.recording?.durationSec ?? 0;
  /** null until checked, so the download note never flickers in or out. */
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void isSeparationModelCached().then((c) => live && setCached(c));
    return () => {
      live = false;
    };
  }, [sep.status]);
  if (sep.status === "done") return null;

  if (sep.status === "running") {
    const pct = Math.round(sep.fraction * 100);
    const what =
      sep.phase === "downloading"
        ? `Downloading the Separation model — first time only (${pct}%)`
        : sep.phase === "preparing"
          ? "Getting ready…"
          : `Separating into Stems… ${sep.etaSec !== undefined ? `${durationPhrase(sep.etaSec)} left` : `${pct}%`}`;
    return (
      <div className="sep-card running" aria-live="polite">
        <div className="sep-row">
          <div className="spinner" aria-hidden="true" />
          <div className="grow">
            <div className="sep-title">{what}</div>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="dim">You can keep listening and setting the Trim while this runs.</div>
          </div>
          <button className="btn" onClick={() => studio.cancelSeparation()}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`sep-card${sep.status === "error" ? " failed" : ""}`}>
      <div className="sep-row">
        <div className="sep-icon" aria-hidden="true"><Icon name="separate" /></div>
        <div className="grow">
          <div className="sep-title">
            {sep.status === "error" ? "Separation didn't finish" : "Next: separate your Recording into Stems"}
          </div>
          <div className="muted">
            {sep.status === "error"
              ? sep.message
              : `Splits it into vocals, drums, bass and other, so the voice can be cleaned, boosted and tuned on its own. Takes ${durationPhrase(duration * SECONDS_PER_AUDIO_SECOND)} on this computer${cached === false ? ", plus a one-time 172 MB download of the model" : ""}. Your audio never leaves your computer.`}
          </div>
        </div>
        <button className="btn primary" onClick={() => void studio.separate()}>
          {sep.status === "error" ? "Try again" : "Separate into Stems"}
        </button>
      </div>
    </div>
  );
}
