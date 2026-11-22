import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type Studio } from "./studio";
import { sine, wavFile } from "../test/audio-fixtures";
import { fakeSeparator } from "../test/fake-separator";

let studio: Studio;
afterEach(() => studio?.dispose());

const SR = 44100;
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
/** Energy of `a` at one frequency (single-bin DFT), to tell Stems apart in a mix. */
function toneLevel(a: Float32Array, freq: number, sr: number) {
  let re = 0, im = 0;
  for (let i = 0; i < a.length; i++) {
    re += a[i] * Math.cos((2 * Math.PI * freq * i) / sr);
    im -= a[i] * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return (2 * Math.hypot(re, im)) / a.length;
}

async function separated() {
  studio = createStudio({
    separator: fakeSeparator({
      vocals: { freq: 440, amp: 0.2 },
      drums: { freq: 2000, amp: 0.2 },
      bass: { freq: 110, amp: 0.2 },
      other: { freq: 700, amp: 0.2 },
    }),
  });
  await studio.load(wavFile([sine(440, 2, SR, 0.2)], SR));
  await studio.separate();
  // These tests are about mixing; keep the vocal effects neutral (steady test tones read as hum).
  studio.setNoiseReduction({ enabled: false });
  studio.setVocalBoost({ db: 0 });
  studio.commit("neutral vocals");
  return studio;
}
const mixed = async (s: Studio) => {
  const b = await s.mixAudio();
  return { data: b.getChannelData(0), sr: b.sampleRate };
};

describe("Stem mixer", () => {
  it("starts with vocals/drums/bass at 0 dB and other at -6 dB", async () => {
    const s = await separated();
    const { stems } = s.getState().mix;
    expect([stems.vocals.level, stems.drums.level, stems.bass.level, stems.other.level]).toEqual([0, 0, 0, -6]);
    const { data, sr } = await mixed(s);
    expect(toneLevel(data, 700, sr) / toneLevel(data, 440, sr)).toBeCloseTo(Math.pow(10, -6 / 20), 1);
  });

  it("muting a Stem removes it from the Mixdown", async () => {
    const s = await separated();
    s.setStem("drums", { mute: true });
    const { data, sr } = await mixed(s);
    expect(toneLevel(data, 2000, sr)).toBeLessThan(0.001);
    expect(toneLevel(data, 440, sr)).toBeCloseTo(0.2, 2);
  });

  it("solo isolates Stems (several can be soloed)", async () => {
    const s = await separated();
    s.setStem("vocals", { solo: true });
    s.setStem("bass", { solo: true });
    const { data, sr } = await mixed(s);
    expect(toneLevel(data, 440, sr)).toBeCloseTo(0.2, 2);
    expect(toneLevel(data, 110, sr)).toBeCloseTo(0.2, 2);
    expect(toneLevel(data, 2000, sr)).toBeLessThan(0.001);
    expect(toneLevel(data, 700, sr)).toBeLessThan(0.001);
  });

  it("a muted Stem stays silent even when soloed", async () => {
    const s = await separated();
    s.setStem("vocals", { solo: true, mute: true });
    const { data } = await mixed(s);
    expect(rms(data)).toBeLessThan(0.001);
  });

  it("a level change moves the Stem's loudness by that many dB", async () => {
    const s = await separated();
    s.setStem("bass", { level: -12 });
    const { data, sr } = await mixed(s);
    expect(toneLevel(data, 110, sr)).toBeCloseTo(0.2 * Math.pow(10, -12 / 20), 2);
  });

  it("keeps levels between -24 and +12 dB", async () => {
    const s = await separated();
    s.setStem("vocals", { level: 30 });
    expect(s.getState().mix.stems.vocals.level).toBe(12);
    s.setStem("vocals", { level: -99 });
    expect(s.getState().mix.stems.vocals.level).toBe(-24);
  });

  it("each fader/mute/solo gesture is one labelled undo step", async () => {
    const s = await separated();
    for (const l of [-1, -2, -3]) s.setStem("vocals", { level: l });
    s.commit("Vocals level");
    s.setStem("bass", { mute: true });
    s.commit("Bass mute");
    expect(s.getState().history.undo).toEqual(["neutral vocals", "Vocals level", "Bass mute"]);
    s.undo();
    s.undo();
    expect(s.getState().mix.stems.vocals.level).toBe(0);
    expect(s.getState().mix.stems.bass.mute).toBe(false);
  });
});

describe("A/B", () => {
  it("compares Original and Processed without being an undo step or changing the Mixdown", async () => {
    const s = await separated();
    s.setStem("vocals", { mute: true });
    s.commit("Vocals mute");
    s.setAB("original");
    s.commit("A/B");
    expect(s.getState().transport.ab).toBe("original");
    expect(s.getState().history.undo).toEqual(["neutral vocals", "Vocals mute"]);
    const { data, sr } = await mixed(s);
    expect(toneLevel(data, 440, sr)).toBeLessThan(0.001); // the Mixdown is always the Processed Mix
  });
});
