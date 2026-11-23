import { useMemo } from "react";
import { STEM_NAMES, type StemName, type Studio, type StudioState } from "../engine/studio";
import { endsKeyGesture, fillStyle, formatDb } from "./controls";
import { isSeparated } from "./useStudio";
import { Waveform } from "./Waveform";

const STEM_COLORS: Record<StemName, string> = {
  vocals: "#c9798f",
  drums: "#c9a26a",
  bass: "#6f9fc9",
  other: "#7aa89a",
};
const STEM_LABELS: Record<StemName, string> = { vocals: "Vocals", drums: "Drums", bass: "Bass", other: "Other" };
const STEM_HINTS: Record<StemName, string> = {
  vocals: "Your voice",
  drums: "Beats and percussion",
  bass: "Low notes",
  other: "Everything else — most background noise ends up here",
};

const LEVEL_MIN = -24;
const LEVEL_MAX = 12;

/** One lane per Stem: waveform, level fader, Mute and Solo. */
export function StemLanes(props: { studio: Studio; state: StudioState; position: number }) {
  const { studio, state, position } = props;
  const done = isSeparated(state);
  const peaks = useMemo(
    () => Object.fromEntries(STEM_NAMES.map((n) => [n, done ? studio.getStemPeaks(n, 800) : []])) as Record<StemName, number[]>,
    [studio, done, state.recording],
  );
  if (!done || !state.recording) return null;
  const { trim } = state.mix;
  const duration = state.recording.durationSec;
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const anySolo = STEM_NAMES.some((n) => state.mix.stems[n].solo);

  return (
    <div className="stems" id="stems">
      <div className="stems-head sc">Stems</div>
      {STEM_NAMES.map((name) => {
        const s = state.mix.stems[name];
        const audible = !s.mute && (!anySolo || s.solo);
        const label = STEM_LABELS[name];
        return (
          <div key={name} className={`stem${audible ? "" : " silent"}`} style={{ "--stem": STEM_COLORS[name] } as React.CSSProperties}>
            <div className="stem-strip">
              <div className="stem-name" title={STEM_HINTS[name]}>
                <span className="dot" />
                {label}
              </div>
              <div className="stem-buttons">
                <button
                  className={`ms${s.mute ? " on mute" : ""}`}
                  aria-pressed={s.mute}
                  aria-label={`Mute ${label}`}
                  title={`Mute ${label}`}
                  onClick={() => {
                    studio.setStem(name, { mute: !s.mute });
                    studio.commit(`${label} mute`);
                  }}
                >
                  M
                </button>
                <button
                  className={`ms${s.solo ? " on solo" : ""}`}
                  aria-pressed={s.solo}
                  aria-label={`Solo ${label}`}
                  title={`Solo ${label} (hear only soloed Stems)`}
                  onClick={() => {
                    studio.setStem(name, { solo: !s.solo });
                    studio.commit(`${label} solo`);
                  }}
                >
                  S
                </button>
              </div>
              <div className="fader">
                <input
                  type="range"
                  min={LEVEL_MIN}
                  max={LEVEL_MAX}
                  step={0.5}
                  value={s.level}
                  aria-label={`${label} level`}
                  aria-valuetext={formatDb(s.level)}
                  title="Double-click to reset to 0 dB"
                  style={fillStyle(s.level, LEVEL_MIN, LEVEL_MAX)}
                  onChange={(e) => studio.setStem(name, { level: Number(e.target.value) })}
                  onPointerUp={() => studio.commit(`${label} level`)}
                  onKeyUp={(e) => endsKeyGesture(e.key) && studio.commit(`${label} level`)}
                  onDoubleClick={() => {
                    studio.setStem(name, { level: 0 });
                    studio.commit(`${label} level`);
                  }}
                />
                <output className="num">{formatDb(s.level)}</output>
              </div>
            </div>
            {/* Click-to-seek shortcut; from the keyboard, ←/→ seek (see App). */}
            <div
              className="stem-wave"
              aria-hidden="true"
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                studio.seek(((e.clientX - r.left) / r.width) * duration);
              }}
            >
              <Waveform peaks={peaks[name]} color={STEM_COLORS[name]} />
              <div className="shade" style={{ left: 0, width: pct(trim.start) }} />
              <div className="shade" style={{ left: pct(trim.end), right: 0 }} />
              <div className="playhead" style={{ left: pct(position) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
