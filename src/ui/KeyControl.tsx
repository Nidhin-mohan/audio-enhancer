import type { NoteName, Scale, Studio, StudioState } from "../engine/studio";

const ROOTS: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES: Scale[] = ["major", "minor", "chromatic"];

/** The Key Pitch Correction snaps to: detected automatically, overridable. */
export function KeyControl({ studio, state }: { studio: Studio; state: StudioState }) {
  const { key } = state.mix;
  const found = state.detectedKey;
  const disabled = !state.recording;
  const detecting = !!state.recording && !found;

  return (
    <div className="key-ctl">
      <div className="field">
        <span>Key</span>
        <div className="row">
          <select
            aria-label="Key root"
            value={key.root}
            disabled={disabled}
            onChange={(e) => {
              studio.setKey({ root: e.target.value as NoteName });
              studio.commit("Key");
            }}
          >
            {ROOTS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select
            aria-label="Key scale"
            value={key.scale}
            disabled={disabled}
            onChange={(e) => {
              studio.setKey({ scale: e.target.value as Scale });
              studio.commit("Key");
            }}
          >
            {SCALES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="dim key-note" aria-live="polite">
        {disabled
          ? "Detected from your Recording once it's imported."
          : detecting
            ? "Detecting the Key…"
            : key.detected
              ? `${found!.root} ${found!.scale} (detected)`
              : (
                  <>
                    Detected: {found!.root} {found!.scale} ·{" "}
                    <button
                      className="link"
                      onClick={() => {
                        studio.useDetectedKey();
                        studio.commit("Key");
                      }}
                    >
                      use detected
                    </button>
                  </>
                )}
      </div>
    </div>
  );
}
