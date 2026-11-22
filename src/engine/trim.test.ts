import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type Studio } from "./studio";
import { sine, wait, warmUp, wavFile } from "../test/audio-fixtures";

let studio: Studio;
afterEach(() => studio?.dispose());

/** A constant-level signal makes gain easy to read back: |sample| == gain * 0.5 at the waveform's peaks. */
async function loadedDc(seconds: number) {
  studio = createStudio();
  await studio.load(wavFile([new Float32Array(Math.round(seconds * 44100)).fill(0.5)]));
  await warmUp(studio);
  return studio;
}
const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

describe("Trim", () => {
  it("starts as the whole Recording with no fades", async () => {
    const s = await loadedDc(3);
    expect(s.getState().mix.trim).toEqual({ start: 0, end: expect.closeTo(3, 3), fadeIn: 0, fadeOut: 0 });
  });

  it("keeps Trim and fades within sensible bounds", async () => {
    const s = await loadedDc(3);
    s.setTrim({ start: 2.5, end: 1 });
    let t = s.getState().mix.trim;
    expect(t.start).toBeLessThan(t.end);
    s.setTrim({ start: -1, end: 99 });
    t = s.getState().mix.trim;
    expect(t.start).toBe(0);
    expect(t.end).toBeCloseTo(3, 3);
    s.setTrim({ start: 1, end: 2, fadeIn: 5, fadeOut: 5 });
    t = s.getState().mix.trim;
    expect(t.fadeIn + t.fadeOut).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("renders only the kept range", async () => {
    const s = await loadedDc(3);
    s.setTrim({ start: 0.5, end: 2 });
    const out = await s.mixAudio();
    expect(out.duration).toBeCloseTo(1.5, 2);
  });

  it("fades from silence at the start and to silence at the end", async () => {
    const s = await loadedDc(2);
    s.setTrim({ fadeIn: 0.5, fadeOut: 0.5 });
    const d = (await s.mixAudio()).getChannelData(0);
    const sr = 44100;
    expect(rms(d, 0, 200)).toBeLessThan(0.01); // silent at the very start
    expect(rms(d, d.length - 200, d.length)).toBeLessThan(0.01); // silent at the very end
    expect(rms(d, Math.round(0.25 * sr) - 100, Math.round(0.25 * sr) + 100)).toBeCloseTo(0.25, 1); // half way up
    expect(rms(d, sr - 100, sr + 100)).toBeCloseTo(0.5, 2); // full level in the middle
  });

  it("plays only within the Trim and returns to the Trim start at its end", async () => {
    const s = await loadedDc(3);
    s.setTrim({ start: 1, end: 1.4 });
    await s.play();
    await wait(100);
    expect(s.getPosition()).toBeGreaterThanOrEqual(1);
    await wait(700);
    expect(s.getState().playing).toBe(false);
    expect(s.getPosition()).toBeCloseTo(1, 5);
  });

  it("clamps seeking into the Trim", async () => {
    const s = await loadedDc(3);
    s.setTrim({ start: 1, end: 2 });
    s.seek(0.2);
    expect(s.getPosition()).toBe(1);
    s.seek(2.8);
    expect(s.getPosition()).toBeLessThanOrEqual(2);
  });

  it("keeps playing from the current spot when the Trim changes during playback", async () => {
    const s = await loadedDc(3);
    await s.play();
    await wait(200);
    s.setTrim({ end: 2.5 });
    expect(s.getState().playing).toBe(true);
    expect(s.getPosition()).toBeGreaterThan(0.1);
    expect(s.getPosition()).toBeLessThan(0.6);
  });
});

describe("Loop and listening volume", () => {
  it("loops the trimmed range while Loop is on", async () => {
    const s = await loadedDc(3);
    s.setTrim({ start: 0.5, end: 0.8 });
    s.setLoop(true);
    await s.play();
    await wait(900);
    expect(s.getState().playing).toBe(true);
    const p = s.getPosition();
    expect(p).toBeGreaterThanOrEqual(0.5);
    expect(p).toBeLessThanOrEqual(0.8);
    expect(s.getState().transport.loop).toBe(true);
  });

  it("listening volume changes listening level only, never the rendered Mixdown", async () => {
    studio = createStudio();
    await studio.load(wavFile([sine(440, 1, 44100, 0.5)]));
    const before = rms((await studio.mixAudio()).getChannelData(0), 0, 44100);
    studio.setListeningVolume(0.2);
    expect(studio.getState().transport.listeningVolume).toBe(0.2);
    const after = rms((await studio.mixAudio()).getChannelData(0), 0, 44100);
    expect(after).toBeCloseTo(before, 4);
  });
});
