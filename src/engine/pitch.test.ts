import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudio, type PitchPicture, type Studio } from "./studio";
import { sine, wavFile } from "../test/audio-fixtures";
import { fakeSeparator, type FakeStem } from "../test/fake-separator";

let studio: Studio;
afterEach(() => studio?.dispose());

const SR = 44100;
const NOTE_START = 0.3; // seconds of silence before the sung note

/** A sung note that's off-key: 460 Hz is 77 cents above A4 (440 Hz), 23 cents below A#4 (466.16 Hz). */
const offKeyNote: FakeStem = (n, sr) => {
  const tone = sine(460, n / sr, sr, 0.3);
  return tone.map((v, i) => (i / sr < NOTE_START ? 0 : v));
};

/** Frequency from positive-going zero crossings (linear interpolation) between t0 and t1 seconds. */
function frequency(data: Float32Array, sr: number, t0: number, t1: number): number {
  const crossings: number[] = [];
  for (let i = Math.round(t0 * sr) + 1; i < Math.round(t1 * sr); i++)
    if (data[i - 1] < 0 && data[i] >= 0) crossings.push(i - 1 + -data[i - 1] / (data[i] - data[i - 1]));
  return ((crossings.length - 1) * sr) / (crossings.at(-1)! - crossings[0]);
}
const cents = (f: number, ref: number) => 1200 * Math.log2(f / ref);

const memoryStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

async function singing(storage = memoryStorage()) {
  studio = createStudio({ separator: fakeSeparator({ vocals: offKeyNote }), storage });
  await studio.load(wavFile([new Float32Array(SR * 2)], SR));
  await studio.separate();
  studio.setNoiseReduction({ enabled: false }); // isolate Pitch Correction
  studio.setKey({ root: "C", scale: "major" });
  return studio;
}
async function sung(s: Studio) {
  const b = await s.mixAudio();
  return { data: b.getChannelData(0), sr: b.sampleRate };
}

describe("Pitch Correction", () => {
  it("is on by default with the Natural Preset", async () => {
    const s = await singing();
    const pc = s.getState().mix.pitchCorrection;
    expect(pc).toMatchObject({ enabled: true, preset: "Natural", modified: false });
    expect(pc.settings).toEqual({ retuneMs: 120, humanize: 60, amount: 70, vibrato: 80, formant: true, mix: 100 });
  });

  it("Hard snaps an off-key note onto the nearest note of the Key", async () => {
    const s = await singing();
    s.applyPitchPreset("Hard");
    const { data, sr } = await sung(s);
    expect(Math.abs(cents(frequency(data, sr, 0.6, 1.8), 440))).toBeLessThan(8);
  });

  it("follows the Key: in C major the note goes to A, with a chromatic scale to the nearer A#", async () => {
    const s = await singing();
    s.applyPitchPreset("Hard");
    s.setKey({ scale: "chromatic" });
    const { data, sr } = await sung(s);
    expect(Math.abs(cents(frequency(data, sr, 0.6, 1.8), 466.16))).toBeLessThan(8);
  });

  it("Natural corrects only part of the way (gentle, still human)", async () => {
    const s = await singing();
    const { data, sr } = await sung(s);
    const c = cents(frequency(data, sr, 0.8, 1.8), 440);
    expect(c).toBeGreaterThan(5); // not snapped all the way to A
    expect(c).toBeLessThan(60); // but clearly pulled towards it from +77 cents
  });

  it("Retune Speed: a slow retune glides into the note, a fast one is there at once", async () => {
    const s = await singing();
    s.applyPitchPreset("Hard");
    s.setPitchCorrection({ retuneMs: 400 });
    const slow = await sung(s);
    s.setPitchCorrection({ retuneMs: 0 });
    const fast = await sung(s);
    const early = (m: { data: Float32Array; sr: number }) => frequency(m.data, m.sr, NOTE_START + 0.02, NOTE_START + 0.12);
    expect(cents(early(slow), 440)).toBeGreaterThan(40);
    expect(Math.abs(cents(early(fast), 440))).toBeLessThan(15);
  });

  it("Mix 0% and switching it off leave the voice untouched", async () => {
    const s = await singing();
    s.applyPitchPreset("Hard");
    s.setPitchCorrection({ mix: 0 });
    const dry = await sung(s);
    expect(Math.abs(cents(frequency(dry.data, dry.sr, 0.6, 1.8), 460))).toBeLessThan(3);
    s.setPitchCorrection({ mix: 100, enabled: false });
    const off = await sung(s);
    expect(Math.abs(cents(frequency(off.data, off.sr, 0.6, 1.8), 460))).toBeLessThan(3);
  });
});

describe("Pitch picture", () => {
  const tracked = async (s: Studio) => {
    await vi.waitFor(() => expect(s.getState().pitchTrack).toBe("ready"), { timeout: 15_000 });
    return s;
  };
  const at = (pic: PitchPicture, sec: number) => Math.round(sec / pic.frameSec);

  it("is not available before Separation", async () => {
    studio = createStudio({ separator: fakeSeparator({ vocals: offKeyNote }), storage: memoryStorage() });
    await studio.load(wavFile([new Float32Array(SR * 2)], SR));
    expect(studio.getState().pitchTrack).toBe("idle");
    expect(studio.getPitchPicture()).toBeNull();
  });

  it("shows the sung note and where Pitch Correction moves it on the Key grid", async () => {
    const s = await tracked(await singing());
    s.applyPitchPreset("Hard");
    const pic = s.getPitchPicture()!;
    expect(pic.sung[at(pic, 1.2)]).toBeCloseTo(69.77, 1); // 460 Hz, between A4 (69) and A#4 (70)
    expect(pic.corrected[at(pic, 1.2)]).toBeCloseTo(69, 1); // snapped to A, in C major
    expect(pic.sung[at(pic, 0.1)]).toBeNaN(); // silence before the note
  });

  it("reflects the current settings", async () => {
    const s = await tracked(await singing());
    s.applyPitchPreset("Hard");
    s.setKey({ scale: "chromatic" });
    let pic = s.getPitchPicture()!;
    expect(pic.corrected[at(pic, 1.2)]).toBeCloseTo(70, 1); // the nearer A#
    s.setPitchCorrection({ enabled: false });
    pic = s.getPitchPicture()!;
    expect(pic.corrected[at(pic, 1.2)]).toBeCloseTo(pic.sung[at(pic, 1.2)], 5); // off: nothing moves
  });
});

describe("Pitch Correction Presets", () => {
  it("changing any control shows Custom, based on the Preset; Reset brings the Preset back", async () => {
    const s = await singing();
    s.applyPitchPreset("Tight");
    s.setPitchCorrection({ humanize: 10 });
    expect(s.getState().mix.pitchCorrection).toMatchObject({ preset: "Tight", modified: true });
    s.resetPitchPreset();
    expect(s.getState().mix.pitchCorrection).toMatchObject({ preset: "Tight", modified: false });
    expect(s.getState().mix.pitchCorrection.settings.humanize).toBe(30);
  });

  it("switching on/off and changing the Key don't count as changing the Preset", async () => {
    const s = await singing();
    s.setPitchCorrection({ enabled: false });
    s.setKey({ root: "D" });
    expect(s.getState().mix.pitchCorrection.modified).toBe(false);
  });

  it("Preset and control changes are undoable", async () => {
    const s = await singing();
    s.commit("setup");
    s.applyPitchPreset("Hard");
    s.commit("Pitch preset → Hard");
    s.setPitchCorrection({ retuneMs: 50 });
    s.commit("Retune Speed");
    s.undo();
    expect(s.getState().mix.pitchCorrection).toMatchObject({ preset: "Hard", modified: false });
    s.undo();
    expect(s.getState().mix.pitchCorrection.preset).toBe("Natural");
  });

  it("saves my own Preset, which survives a restart and works like a built-in one", async () => {
    const storage = memoryStorage();
    const s = await singing(storage);
    s.applyPitchPreset("Hard");
    s.setPitchCorrection({ retuneMs: 25, vibrato: 40 });
    s.commit("tweaks");
    s.savePitchPreset("My sound");
    expect(s.getState().mix.pitchCorrection).toMatchObject({ preset: "My sound", modified: false });
    expect(s.getState().history.undo).toEqual(["tweaks"]); // saving is not an undo step
    expect(s.getState().pitchPresets.map((p) => p.name)).toEqual(["Natural", "Tight", "Hard", "My sound"]);
    s.dispose();

    const again = await singing(storage);
    expect(again.getState().pitchPresets.map((p) => p.name)).toContain("My sound");
    again.applyPitchPreset("My sound");
    expect(again.getState().mix.pitchCorrection.settings).toMatchObject({ retuneMs: 25, vibrato: 40, amount: 100 });
  });

  it("undo never deletes a saved Preset", async () => {
    const s = await singing();
    s.setPitchCorrection({ amount: 50 });
    s.commit("Amount");
    s.savePitchPreset("Half");
    s.undo();
    expect(s.getState().pitchPresets.map((p) => p.name)).toContain("Half");
  });

  it("still works when browser storage is unavailable (Presets just don't persist)", async () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const s = await singing(broken);
    s.setPitchCorrection({ amount: 50 });
    s.savePitchPreset("Temp");
    expect(s.getState().pitchPresets.map((p) => p.name)).toContain("Temp");
    expect(s.getState().presetStorageAvailable).toBe(false);
  });
});
