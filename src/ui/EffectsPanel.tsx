import { useState } from "react";
import type { NoteName, PitchSettings, Scale, Studio, StudioState } from "../engine/studio";
import { formatDb, Locked, Section, Segmented, Slider, Switch } from "./controls";
import { PitchPicture } from "./PitchPicture";
import { isSeparated } from "./useStudio";

const ROOTS: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** One notice at the top of the Effects panel while the Stems don't exist yet. */
export function EffectsNotice({ studio, state }: { studio: Studio; state: StudioState }) {
  if (isSeparated(state)) return null;
  const running = state.separation.status === "running";
  return (
    <div className="effects-notice">
      <Locked
        action={state.recording && !running ? { label: "Separate now", onClick: () => void studio.separate() } : undefined}
      >
        {!state.recording
          ? "Import a Recording to start."
          : running
            ? "These effects unlock as soon as Separation finishes."
            : "These effects work on the vocals Stem — separate your Recording first."}
      </Locked>
    </div>
  );
}

/** Shown in place of controls that need the Stems (the panel notice explains why). */
function NeedsStems() {
  return <div className="hint-text">Available after Separation.</div>;
}

export function NoiseReductionSection({ studio, state }: { studio: Studio; state: StudioState }) {
  const ready = isSeparated(state);
  const nr = state.mix.noiseReduction;
  return (
    <Section
      title="Noise Reduction"
      badge={ready ? (nr.enabled ? `${nr.amount}%` : "Off") : undefined}
      toggle={
        ready
          ? {
              checked: nr.enabled,
              onChange: (on) => {
                studio.setNoiseReduction({ enabled: on });
                studio.commit(on ? "Noise Reduction on" : "Noise Reduction off");
              },
            }
          : undefined
      }
    >
      {ready ? (
        <Slider
          label="Amount"
          value={nr.amount}
          min={0}
          max={100}
          unit="%"
          defaultValue={60}
          disabled={!nr.enabled}
          hint="Removes hiss, hum and room noise behind your voice. Lower it to keep some natural room sound."
          onChange={(v) => studio.setNoiseReduction({ amount: v })}
          onCommit={() => studio.commit("Noise Reduction")}
        />
      ) : (
        <NeedsStems />
      )}
    </Section>
  );
}

export function VocalBoostSection({ studio, state }: { studio: Studio; state: StudioState }) {
  const ready = isSeparated(state);
  const vb = state.mix.vocalBoost;
  return (
    <Section title="Vocal Boost" badge={ready ? `${vb.auto ? "Auto " : ""}${formatDb(vb.db)}` : undefined}>
      {ready ? (
        <>
          <div className="row-between">
            <span className="field-label">Automatic level</span>
            <Switch
              label="Automatic Vocal Boost"
              checked={vb.auto}
              onChange={(on) => {
                studio.setVocalBoost(on ? { auto: true } : { db: vb.db });
                studio.commit(on ? "Vocal Boost auto" : "Vocal Boost manual");
              }}
            />
          </div>
          <Slider
            label="Boost"
            value={vb.db}
            min={-12}
            max={12}
            step={0.5}
            unit="dB"
            defaultValue={0}
            hint={
              vb.auto
                ? "Set automatically to bring your voice level with the music. Move the slider to set it yourself."
                : "Makes your voice louder or softer against the music."
            }
            onChange={(v) => studio.setVocalBoost({ db: v })}
            onCommit={() => studio.commit("Vocal Boost")}
          />
        </>
      ) : (
        <NeedsStems />
      )}
    </Section>
  );
}

type FineTuneControl = Exclude<keyof PitchSettings, "formant">;

/** The Pitch Correction controls, in the order shown. Labels double as undo step names. */
const FINE_TUNE: { key: FineTuneControl; label: string; max: number; step?: number; unit: string; hint: string }[] = [
  {
    key: "retuneMs",
    label: "Retune Speed",
    max: 400,
    step: 5,
    unit: "ms",
    hint: "How fast notes snap to pitch. 0 ms is the robotic effect; higher is smoother.",
  },
  { key: "amount", label: "Correction Amount", max: 100, unit: "%", hint: "How far off-key notes are moved towards the right note." },
  { key: "humanize", label: "Humanize", max: 100, unit: "%", hint: "Leaves small, expressive wobbles alone." },
  { key: "vibrato", label: "Keep Vibrato", max: 100, unit: "%", hint: "Keeps your natural vibrato instead of flattening it." },
  { key: "mix", label: "Blend", max: 100, unit: "%", hint: "Blend of corrected and original voice." },
];

const PRESET_HINTS: Record<string, string> = {
  Natural: "Gentle — barely noticeable",
  Tight: "Clearly in tune, still human",
  Hard: "Deliberately robotic — every note snaps instantly",
};

export function PitchCorrectionSection({ studio, state }: { studio: Studio; state: StudioState }) {
  const ready = isSeparated(state);
  const pc = state.mix.pitchCorrection;
  const [fineTune, setFineTune] = useState(false);
  /** The name being typed for "Save as my Preset", or null when the form is closed. */
  const [presetDraft, setPresetDraft] = useState<string | null>(null);
  const commit = (label: string) => studio.commit(label);
  const preset = pc.modified ? "Custom" : pc.preset;
  const draftName = presetDraft?.trim() ?? "";
  const replaces = state.pitchPresets.some((p) => !p.builtIn && p.name === draftName);

  return (
    <Section
      title="Pitch Correction"
      badge={ready ? (pc.enabled ? preset : "Off") : undefined}
      toggle={
        ready
          ? {
              checked: pc.enabled,
              onChange: (on) => {
                studio.setPitchCorrection({ enabled: on });
                commit(on ? "Pitch Correction on" : "Pitch Correction off");
              },
            }
          : undefined
      }
    >
      <KeyPicker studio={studio} state={state} />
      {!ready ? (
        <NeedsStems />
      ) : (
        <>
          <PitchPicture studio={studio} state={state} />
          <fieldset className="plain" disabled={!pc.enabled}>
            <div className="field-label">Preset</div>
            <div className="chips" role="radiogroup" aria-label="Pitch Correction Preset">
              {state.pitchPresets.map((p) => {
                const on = !pc.modified && pc.preset === p.name;
                return (
                  <button
                    key={p.name}
                    role="radio"
                    aria-checked={on}
                    className={`chip${on ? " on" : ""}`}
                    title={p.builtIn ? PRESET_HINTS[p.name] : "Your saved Preset"}
                    onClick={() => {
                      studio.applyPitchPreset(p.name);
                      commit(`Pitch preset → ${p.name}`);
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
              {pc.modified && <span className="chip on custom" aria-current="true">Custom •</span>}
            </div>
            {pc.modified && (
              <div className="row-gap">
                <button
                  className="link"
                  onClick={() => {
                    studio.resetPitchPreset();
                    commit(`Reset to ${pc.preset}`);
                  }}
                >
                  Reset to {pc.preset}
                </button>
                {presetDraft === null && (
                  <button className="link" onClick={() => setPresetDraft("")}>Save as my Preset…</button>
                )}
              </div>
            )}
            {presetDraft !== null && (
              <form
                className="save"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draftName) return;
                  studio.savePitchPreset(draftName);
                  setPresetDraft(null);
                }}
              >
                <input
                  type="text"
                  autoFocus
                  aria-label="Preset name"
                  placeholder="Name, e.g. My ballad"
                  value={presetDraft}
                  maxLength={30}
                  onChange={(e) => setPresetDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setPresetDraft(null)}
                />
                <button className="btn small primary" type="submit" disabled={!draftName}>
                  {replaces ? "Replace" : "Save"}
                </button>
                <button className="btn small" type="button" onClick={() => setPresetDraft(null)}>Cancel</button>
              </form>
            )}
            {replaces && <div className="hint-text">You already have a Preset called "{draftName}" — saving replaces it.</div>}
            {!state.presetStorageAvailable && (
              <div className="hint-text">Your browser blocks storage, so saved Presets last only until you close this page.</div>
            )}

            <button className="disclosure" aria-expanded={fineTune} onClick={() => setFineTune((f) => !f)}>
              {fineTune ? "Hide fine-tuning" : "Fine-tune…"}
            </button>
            {fineTune && (
              <div className="fine">
                {FINE_TUNE.map((c) => (
                  <Slider
                    key={c.key}
                    label={c.label}
                    value={pc.settings[c.key]}
                    min={0}
                    max={c.max}
                    step={c.step}
                    unit={c.unit}
                    hint={c.hint}
                    onChange={(v) => studio.setPitchCorrection({ [c.key]: v })}
                    onCommit={() => commit(c.label)}
                  />
                ))}
                <div className="row-between">
                  <span className="field-label" title="Keeps the character of your voice when notes are moved">
                    Keep voice character (formants)
                  </span>
                  <Switch
                    label="Keep voice character"
                    checked={pc.settings.formant}
                    onChange={(on) => {
                      studio.setPitchCorrection({ formant: on });
                      commit("Keep voice character");
                    }}
                  />
                </div>
              </div>
            )}
          </fieldset>
        </>
      )}
    </Section>
  );
}

/** The Key notes are snapped to: detected automatically, can be overridden. */
function KeyPicker({ studio, state }: { studio: Studio; state: StudioState }) {
  const { key } = state.mix.pitchCorrection;
  const found = state.detectedKey;
  const disabled = !state.recording;
  const note = disabled
    ? "Detected from your Recording once it's imported."
    : state.keyDetection === "detecting"
      ? "Detecting the Key…"
      : !found
        ? "Couldn't detect a Key — please pick one."
        : key.detected
          ? `${key.root} ${key.scale} (detected)`
          : null;

  return (
    <div className="key-picker">
      <div className="row-between">
        <span className="field-label">Key</span>
        <div className="row-gap">
          <select
            aria-label="Key root note"
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
          <Segmented<Scale>
            label="Scale"
            value={key.scale}
            disabled={disabled}
            options={[
              { value: "major", label: "Major" },
              { value: "minor", label: "Minor" },
              { value: "chromatic", label: "Chromatic", title: "Snap to the nearest semitone, any note" },
            ]}
            onChange={(scale) => {
              studio.setKey({ scale });
              studio.commit("Key");
            }}
          />
        </div>
      </div>
      <div className="hint-text" aria-live="polite">
        {note ?? (
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
