import { describe, expect, it } from "vitest";
import { integratedLoudness, samplePeak } from "./loudness";
import { sine } from "../test/audio-fixtures";

// Reference values from EBU Tech 3341 (loudness metering test signals),
// which allows a tolerance of ±0.1 LU.
const dbfs = (db: number) => Math.pow(10, db / 20);
const withinEbuTolerance = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.1);

describe("integrated loudness (ITU-R BS.1770)", () => {
  it("a stereo 1 kHz sine at -23 dBFS measures -23 LUFS", () => {
    for (const sr of [44100, 48000]) {
      const s = sine(1000, 20, sr, dbfs(-23));
      withinEbuTolerance(integratedLoudness([s, s], sr), -23);
    }
  });

  it("a stereo 1 kHz sine at -33 dBFS measures -33 LUFS", () => {
    const s = sine(1000, 20, 48000, dbfs(-33));
    withinEbuTolerance(integratedLoudness([s, s], 48000), -33);
  });

  it("ignores silence (absolute gate), so adding silence doesn't change the reading", () => {
    const sr = 48000;
    const tone = sine(1000, 10, sr, dbfs(-23));
    const withSilence = new Float32Array(tone.length * 2);
    withSilence.set(tone, tone.length);
    withinEbuTolerance(integratedLoudness([withSilence, withSilence], sr), -23);
  });

  it("returns -Infinity for pure silence", () => {
    const z = new Float32Array(48000 * 2);
    expect(integratedLoudness([z, z], 48000)).toBe(-Infinity);
  });

  it("sample peak is the largest absolute sample over all channels", () => {
    const a = new Float32Array([0, 0.2, -0.7, 0.1]);
    const b = new Float32Array([0.5, -0.1, 0, 0]);
    expect(samplePeak([a, b])).toBeCloseTo(0.7, 6);
  });
});
