import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudio, type Studio } from "./studio";
import { wavFile } from "../test/audio-fixtures";

let studio: Studio;
afterEach(() => studio?.dispose());

const SR = 44100;
const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 } as const;
type Note = keyof typeof NOTE;
const freq = (note: Note, octave: number) => 440 * Math.pow(2, (NOTE[note] + 12 * (octave + 1) - 69) / 12);

/** Chords (each a list of notes) played one after another, 1 s each, with a few harmonics like a real instrument. */
function progression(chords: Note[][], repeats = 3): Float32Array {
  const per = SR;
  const out = new Float32Array(per * chords.length * repeats);
  chords.forEach((chord, ci) => {
    for (let r = 0; r < repeats; r++) {
      const offset = (r * chords.length + ci) * per;
      chord.forEach((note, ni) => {
        const f = freq(note, ni === 0 ? 3 : 4); // root in the bass
        for (let i = 0; i < per; i++) {
          const env = Math.min(1, i / 400) * Math.exp(-i / (per * 0.8));
          let s = 0;
          for (let h = 1; h <= 4; h++) s += Math.sin((2 * Math.PI * f * h * i) / SR) / h;
          out[offset + i] += 0.08 * env * s;
        }
      });
    }
  });
  return out;
}

async function detect(samples: Float32Array) {
  studio = createStudio();
  await studio.load(wavFile([samples], SR, "song.wav"));
  await vi.waitFor(() => expect(studio.getState().detectedKey).not.toBeNull(), { timeout: 10000 });
  return studio;
}

describe("Key detection", () => {
  it("detects C major from I–IV–V–I", async () => {
    const s = await detect(progression([["C", "E", "G"], ["F", "A", "C"], ["G", "B", "D"], ["C", "E", "G"]]));
    expect(s.getState().detectedKey).toEqual({ root: "C", scale: "major" });
  });

  it("detects A minor from i–iv–V–i", async () => {
    const s = await detect(progression([["A", "C", "E"], ["D", "F", "A"], ["E", "G#", "B"], ["A", "C", "E"]]));
    expect(s.getState().detectedKey).toEqual({ root: "A", scale: "minor" });
  });

  it("detects E major from I–IV–V–I", async () => {
    const s = await detect(progression([["E", "G#", "B"], ["A", "C#", "E"], ["B", "D#", "F#"], ["E", "G#", "B"]]));
    expect(s.getState().detectedKey).toEqual({ root: "E", scale: "major" });
  });

  const more: [string, Note[][], { root: Note; scale: "major" | "minor" }][] = [
    ["F major (I–vi–IV–V)", [["F", "A", "C"], ["D", "F", "A"], ["A#", "D", "F"], ["C", "E", "G"]], { root: "F", scale: "major" }],
    ["D minor (i–VI–VII–V)", [["D", "F", "A"], ["A#", "D", "F"], ["C", "E", "G"], ["A", "C#", "E"]], { root: "D", scale: "minor" }],
    ["G major (I–V–vi–IV)", [["G", "B", "D"], ["D", "F#", "A"], ["E", "G", "B"], ["C", "E", "G"]], { root: "G", scale: "major" }],
    ["B minor (i–iv–V–i)", [["B", "D", "F#"], ["E", "G", "B"], ["F#", "A#", "C#"], ["B", "D", "F#"]], { root: "B", scale: "minor" }],
  ];
  for (const [name, chords, expected] of more) {
    it(`detects ${name}`, async () => {
      const s = await detect(progression(chords));
      expect(s.getState().detectedKey).toEqual(expected);
    });
  }

  it("uses the detected Key for Pitch Correction until the user overrides it", async () => {
    const s = await detect(progression([["C", "E", "G"], ["F", "A", "C"], ["G", "B", "D"], ["C", "E", "G"]]));
    expect(s.getState().mix.pitchCorrection.key).toEqual({ root: "C", scale: "major", detected: true });
    s.setKey({ root: "D", scale: "minor" });
    s.commit("Key");
    expect(s.getState().mix.pitchCorrection.key).toEqual({ root: "D", scale: "minor", detected: false });
    s.useDetectedKey();
    s.commit("Key");
    expect(s.getState().mix.pitchCorrection.key).toEqual({ root: "C", scale: "major", detected: true });
  });

  it("Key changes are undoable", async () => {
    const s = await detect(progression([["C", "E", "G"], ["F", "A", "C"], ["G", "B", "D"], ["C", "E", "G"]]));
    s.setKey({ scale: "chromatic" });
    s.commit("Key");
    s.undo();
    expect(s.getState().mix.pitchCorrection.key).toEqual({ root: "C", scale: "major", detected: true });
  });

  it("reports when no Key could be detected (e.g. silence)", async () => {
    studio = createStudio();
    await studio.load(wavFile([new Float32Array(SR * 3)], SR));
    expect(studio.getState().keyDetection).toBe("detecting");
    await vi.waitFor(() => expect(studio.getState().keyDetection).toBe("not-found"), { timeout: 10000 });
    expect(studio.getState().detectedKey).toBeNull();
  });

  it("reports the Key as found once detected", async () => {
    const s = await detect(progression([["C", "E", "G"], ["F", "A", "C"], ["G", "B", "D"], ["C", "E", "G"]]));
    expect(s.getState().keyDetection).toBe("found");
  });

  it("re-detects the Key when a new Recording is loaded", async () => {
    const s = await detect(progression([["C", "E", "G"], ["F", "A", "C"], ["G", "B", "D"], ["C", "E", "G"]]));
    await s.load(wavFile([progression([["E", "G#", "B"], ["A", "C#", "E"], ["B", "D#", "F#"], ["E", "G#", "B"]])], SR));
    await vi.waitFor(() => expect(s.getState().detectedKey).toEqual({ root: "E", scale: "major" }), { timeout: 10000 });
    expect(s.getState().mix.pitchCorrection.key).toEqual({ root: "E", scale: "major", detected: true });
  });
});
