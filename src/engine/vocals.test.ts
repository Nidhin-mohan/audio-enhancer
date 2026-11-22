import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type Studio } from "./studio";
import { sine, wavFile } from "../test/audio-fixtures";
import { fakeSeparator, noise, type FakeStem } from "../test/fake-separator";

let studio: Studio;
afterEach(() => studio?.dispose());

const SR = 44100;

/** Level of one frequency (single-bin DFT). */
function toneLevel(a: Float32Array, freq: number, sr: number) {
  let re = 0, im = 0;
  for (let i = 0; i < a.length; i++) {
    re += a[i] * Math.cos((2 * Math.PI * freq * i) / sr);
    im -= a[i] * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return (2 * Math.hypot(re, im)) / a.length;
}

async function separated(stems: Partial<Record<"vocals" | "drums" | "bass" | "other", FakeStem>>) {
  studio = createStudio({ separator: fakeSeparator(stems) });
  await studio.load(wavFile([sine(440, 3, SR, 0.1)], SR));
  await studio.separate();
  return studio;
}
async function mixedChannel(s: Studio) {
  const b = await s.mixAudio();
  // Skip the first/last 0.25 s so filter start-up doesn't affect measurements.
  const skip = Math.round(0.25 * b.sampleRate);
  return { data: b.getChannelData(0).subarray(skip, b.length - skip), sr: b.sampleRate };
}

/**
 * A "voice" that sings in syllables (0.4 s on, 0.2 s off) over constant hiss.
 * Steady tones are indistinguishable from hum, so a realistic voice comes and goes.
 */
const singing = (t: number) => t % 0.6 < 0.4;
const noisyVoice: FakeStem = (n, sr) => {
  const tone = sine(440, n / sr, sr, 0.2);
  const hiss = noise(n, 0.05);
  return tone.map((v, i) => (singing(i / sr) ? v : 0) + hiss[i]);
};
/** RMS over the parts of `data` (full mix from time 0) where `pick(t)` holds, skipping 50 ms at each boundary. */
function rmsWhere(data: Float32Array, sr: number, pick: (t: number) => boolean) {
  let s = 0, n = 0;
  for (let i = Math.round(0.25 * sr); i < data.length - Math.round(0.25 * sr); i++) {
    const t = i / sr;
    if (pick(t) && pick(t - 0.05) && pick(t + 0.05)) {
      s += data[i] * data[i];
      n++;
    }
  }
  return Math.sqrt(s / n);
}
async function fullMix(s: Studio) {
  const b = await s.mixAudio();
  return { data: b.getChannelData(0), sr: b.sampleRate };
}
const hissIn = (m: { data: Float32Array; sr: number }) => rmsWhere(m.data, m.sr, (t) => !singing(t));
const voiceIn = (m: { data: Float32Array; sr: number }) => rmsWhere(m.data, m.sr, singing);
const db = (ratio: number) => 20 * Math.log10(ratio);

describe("Noise Reduction", () => {
  it("is on by default at 60 after Separation", async () => {
    const s = await separated({ vocals: noisyVoice });
    expect(s.getState().mix.noiseReduction).toEqual({ enabled: true, amount: 60 });
  });

  it("removes background hiss from the vocals while keeping the voice", async () => {
    const s = await separated({ vocals: noisyVoice });
    s.setNoiseReduction({ enabled: false });
    const before = await fullMix(s);
    s.setNoiseReduction({ enabled: true, amount: 100 });
    const after = await fullMix(s);
    expect(db(hissIn(after) / hissIn(before))).toBeLessThan(-10); // hiss at least 10 dB quieter
    expect(Math.abs(db(voiceIn(after) / voiceIn(before)))).toBeLessThan(1.5); // voice kept
  });

  it("removes more hiss as the amount goes up", async () => {
    const s = await separated({ vocals: noisyVoice });
    s.setNoiseReduction({ amount: 20 });
    const low = await fullMix(s);
    s.setNoiseReduction({ amount: 90 });
    const high = await fullMix(s);
    expect(hissIn(high)).toBeLessThan(hissIn(low) * 0.7);
  });

  it("amount 0 or off leaves the vocals untouched", async () => {
    const s = await separated({ vocals: noisyVoice });
    s.setNoiseReduction({ amount: 0 });
    const zero = await fullMix(s);
    s.setNoiseReduction({ amount: 60, enabled: false });
    const off = await fullMix(s);
    expect(hissIn(zero)).toBeCloseTo(hissIn(off), 4);
    expect(hissIn(off)).toBeGreaterThan(0.025); // the hiss is really there
  });

  it("changes are undoable", async () => {
    const s = await separated({ vocals: noisyVoice });
    s.setNoiseReduction({ amount: 90 });
    s.commit("Noise Reduction");
    s.undo();
    expect(s.getState().mix.noiseReduction.amount).toBe(60);
  });
});

describe("Vocal Boost", () => {
  const quietVoiceLoudBand = { vocals: { freq: 440, amp: 0.03 }, drums: { freq: 2000, amp: 0.3 }, bass: { freq: 110, amp: 0.3 } };

  it("automatically brings a quiet voice up towards the level of the music", async () => {
    const s = await separated(quietVoiceLoudBand);
    s.setNoiseReduction({ enabled: false });
    const { vocalBoost } = s.getState().mix;
    expect(vocalBoost.auto).toBe(true);
    expect(vocalBoost.db).toBeGreaterThan(6);
    const { data, sr } = await mixedChannel(s);
    expect(20 * Math.log10(toneLevel(data, 440, sr) / 0.03)).toBeCloseTo(vocalBoost.db, 0);
  });

  it("leaves a voice that's already loud enough alone", async () => {
    const s = await separated({ vocals: { freq: 440, amp: 0.3 }, bass: { freq: 110, amp: 0.1 } });
    expect(s.getState().mix.vocalBoost.db).toBe(0);
  });

  it("a manual amount turns Auto off; turning Auto back on restores the suggested level", async () => {
    const s = await separated(quietVoiceLoudBand);
    s.setNoiseReduction({ enabled: false });
    const suggested = s.getState().mix.vocalBoost.db;
    s.setVocalBoost({ db: 2 });
    expect(s.getState().mix.vocalBoost).toEqual({ auto: false, db: 2 });
    const { data, sr } = await mixedChannel(s);
    expect(20 * Math.log10(toneLevel(data, 440, sr) / 0.03)).toBeCloseTo(2, 0);
    s.setVocalBoost({ auto: true });
    expect(s.getState().mix.vocalBoost).toEqual({ auto: true, db: suggested });
  });

  it("keeps the amount between -12 and +12 dB", async () => {
    const s = await separated(quietVoiceLoudBand);
    s.setVocalBoost({ db: 40 });
    expect(s.getState().mix.vocalBoost.db).toBe(12);
  });

  it("changes are undoable", async () => {
    const s = await separated(quietVoiceLoudBand);
    const suggested = s.getState().mix.vocalBoost.db;
    s.setVocalBoost({ db: 0 });
    s.commit("Vocal Boost");
    s.undo();
    expect(s.getState().mix.vocalBoost).toEqual({ auto: true, db: suggested });
  });
});
