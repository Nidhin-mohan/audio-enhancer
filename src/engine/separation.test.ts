import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudio, type Separator, type Studio } from "./studio";
import { sine, wavFile } from "../test/audio-fixtures";

let studio: Studio;
afterEach(() => studio?.dispose());

const SR = 44100;
/** Recording = a 440 Hz "voice" plus a 110 Hz "bass", 2 s, mono (RMS 0.3). */
const bassLine = sine(110, 2, SR, 0.3);
const recording = sine(440, 2, SR, 0.3).map((v, i) => v + bassLine[i]);

/** Fast stand-in for the real model: knows exactly what is in the Recording. */
function fakeSeparator(opts: { delayMs?: number; fail?: string } = {}): Separator {
  return async (input, onProgress, signal) => {
    for (let step = 1; step <= 4; step++) {
      await new Promise((r) => setTimeout(r, (opts.delayMs ?? 20) / 4));
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress({ phase: "separating", fraction: step / 4 });
    }
    if (opts.fail) throw new Error(opts.fail);
    // Build the Stems at the rate the Recording was decoded at (the browser may resample it).
    const n = input.left.length;
    const sr = input.sampleRate;
    const v = sine(440, n / sr, sr, 0.3);
    const b = sine(110, n / sr, sr, 0.3);
    const silent = () => ({ left: new Float32Array(n), right: new Float32Array(n) });
    return {
      sampleRate: sr,
      vocals: { left: v, right: v.slice() },
      bass: { left: b, right: b.slice() },
      drums: silent(),
      other: silent(),
    };
  };
}

async function loaded(separator: Separator) {
  studio = createStudio({ separator });
  await studio.load(wavFile([recording], SR, "song.wav"));
  return studio;
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe("Separation", () => {
  it("starts with no Stems", async () => {
    const s = await loaded(fakeSeparator());
    expect(s.getState().separation).toEqual({ status: "idle" });
    expect(s.getStemPeaks("vocals", 10)).toEqual([]);
  });

  it("separates the Recording into four Stems, reporting progress", async () => {
    const s = await loaded(fakeSeparator());
    const fractions: number[] = [];
    s.subscribe((st) => st.separation.status === "running" && fractions.push(st.separation.fraction));
    await s.separate();
    expect(s.getState().separation).toEqual({ status: "done" });
    expect(fractions.at(-1)).toBe(1);
    expect(Math.max(...s.getStemPeaks("vocals", 20))).toBeCloseTo(0.3, 1);
    expect(Math.max(...s.getStemPeaks("drums", 20))).toBe(0);
  });

  it("can be cancelled, leaving the Recording as it was", async () => {
    const s = await loaded(fakeSeparator({ delayMs: 400 }));
    const running = s.separate();
    await vi.waitFor(() => expect(s.getState().separation.status).toBe("running"));
    s.cancelSeparation();
    await running;
    expect(s.getState().separation).toEqual({ status: "idle" });
    expect(s.getStemPeaks("vocals", 10)).toEqual([]);
  });

  it("reports a failure clearly and keeps the Recording usable", async () => {
    const s = await loaded(fakeSeparator({ fail: "Not enough memory" }));
    await s.separate();
    expect(s.getState().separation).toEqual({ status: "error", message: expect.stringMatching(/not enough memory/i) });
    expect(s.getState().recording?.name).toBe("song.wav");
    await expect(s.mixAudio()).resolves.toBeTruthy();
  });

  it("is never an undo step", async () => {
    const s = await loaded(fakeSeparator());
    await s.separate();
    expect(s.getState().history.undo).toEqual([]);
  });

  it("loading a new Recording discards the Stems", async () => {
    const s = await loaded(fakeSeparator());
    await s.separate();
    await s.load(wavFile([recording], SR, "next.wav"));
    expect(s.getState().separation).toEqual({ status: "idle" });
    expect(s.getStemPeaks("vocals", 10)).toEqual([]);
  });

  it("after Separation, the Mix is made from the Stems", async () => {
    const s = await loaded(fakeSeparator());
    await s.separate();
    // Neutral vocal effects, so the Stems add up exactly ("other" is silent, so its -6 dB doesn't matter).
    s.setNoiseReduction({ enabled: false });
    s.setVocalBoost({ db: 0 });
    const mixed = (await s.mixAudio()).getChannelData(0);
    // vocals + bass = the original Recording
    expect(rms(mixed)).toBeCloseTo(rms(recording), 2);
  });
});
