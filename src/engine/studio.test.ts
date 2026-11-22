import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type Studio } from "./studio";
import { sine, wait, warmUp, wavFile } from "../test/audio-fixtures";

let studio: Studio;
afterEach(() => studio?.dispose());

describe("loading a Recording", () => {
  it("decodes the file and reports its name and duration", async () => {
    studio = createStudio();
    await studio.load(wavFile([sine(440, 2)], 44100, "my-song.wav"));
    const { recording } = studio.getState();
    expect(recording?.name).toBe("my-song.wav");
    expect(recording?.durationSec).toBeCloseTo(2, 2);
  });

  it("rejects an unreadable file with a clear error and keeps the current Recording", async () => {
    studio = createStudio();
    await studio.load(wavFile([sine(440, 1)], 44100, "good.wav"));
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], "notes.txt");
    await expect(studio.load(junk)).rejects.toThrow(/couldn't read "notes.txt"/i);
    expect(studio.getState().recording?.name).toBe("good.wav");
  });

  it("provides waveform peaks for the whole Recording", async () => {
    studio = createStudio();
    // 1 s of silence followed by 1 s of a loud tone
    const samples = new Float32Array(88200);
    samples.set(sine(440, 1, 44100, 0.8), 44100);
    await studio.load(wavFile([samples]));
    const peaks = studio.getPeaks(100);
    expect(peaks).toHaveLength(100);
    expect(Math.max(...peaks.slice(0, 45))).toBeLessThan(0.01);
    expect(Math.min(...peaks.slice(55))).toBeGreaterThan(0.7);
  });
});

describe("playback", () => {
  async function loaded(seconds = 3) {
    studio = createStudio();
    await studio.load(wavFile([sine(220, seconds)]));
    await warmUp(studio);
    return studio;
  }

  it("plays from the start and the position advances", async () => {
    const s = await loaded();
    await s.play();
    expect(s.getState().playing).toBe(true);
    await wait(300);
    expect(s.getPosition()).toBeGreaterThan(0.15);
    expect(s.getPosition()).toBeLessThan(1);
  });

  it("pause holds the position, and play resumes from it", async () => {
    const s = await loaded();
    await s.play();
    await wait(250);
    s.pause();
    const held = s.getPosition();
    expect(s.getState().playing).toBe(false);
    await wait(200);
    expect(s.getPosition()).toBeCloseTo(held, 2);
    await s.play();
    await wait(150);
    expect(s.getPosition()).toBeGreaterThan(held + 0.05);
  });

  it("stop returns to the start", async () => {
    const s = await loaded();
    await s.play();
    await wait(200);
    s.stop();
    expect(s.getState().playing).toBe(false);
    expect(s.getPosition()).toBe(0);
  });

  it("seeks while paused and while playing", async () => {
    const s = await loaded();
    s.seek(2);
    expect(s.getPosition()).toBeCloseTo(2, 5);
    await s.play();
    await wait(150);
    expect(s.getPosition()).toBeGreaterThan(2.05);
    s.seek(0.5);
    expect(s.getPosition()).toBeLessThan(0.7);
    expect(s.getState().playing).toBe(true);
  });

  it("tells subscribers where playback will resume after a seek, pause or stop", async () => {
    const s = await loaded();
    const cursors: number[] = [];
    s.subscribe((st) => cursors.push(st.cursor));
    s.seek(1.5);
    expect(s.getState().cursor).toBeCloseTo(1.5, 5);
    await s.play();
    await wait(150);
    s.pause();
    // Paused somewhere after the seek point (how far depends on machine load).
    expect(s.getState().cursor).toBeGreaterThan(1.5);
    expect(s.getState().cursor).toBeCloseTo(s.getPosition(), 5);
    s.stop();
    expect(s.getState().cursor).toBe(0);
    expect(cursors.length).toBeGreaterThanOrEqual(3);
  });

  it("stops by itself at the end of the Recording", async () => {
    const s = await loaded(0.4);
    await s.play();
    await wait(700);
    expect(s.getState().playing).toBe(false);
    expect(s.getPosition()).toBe(0);
  });

  it("does nothing when asked to play with no Recording loaded", async () => {
    studio = createStudio();
    await studio.play();
    expect(studio.getState().playing).toBe(false);
  });
});
