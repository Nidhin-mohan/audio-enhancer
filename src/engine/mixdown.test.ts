import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type MixdownFormat, type Studio } from "./studio";
import { integratedLoudness, samplePeak } from "./loudness";
import { sine, wavFile } from "../test/audio-fixtures";

let studio: Studio;
afterEach(() => studio?.dispose());

/** A quiet "phone recording": a few tones around -30 dBFS, 6 seconds, mono. */
function quietSong(seconds = 6, sr = 44100): Float32Array {
  const a = sine(220, seconds, sr, 0.03);
  const b = sine(330, seconds, sr, 0.02);
  const c = sine(1200, seconds, sr, 0.01);
  return a.map((v, i) => v + b[i] + c[i]);
}

async function decode(blob: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}
const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

async function loaded(samples = quietSong(), name = "voice memo.m4a") {
  studio = createStudio();
  await studio.load(wavFile([samples], 44100, name));
  return studio;
}

describe("Mixdown settings", () => {
  it("defaults to MP3 at -14 LUFS", async () => {
    const s = await loaded();
    expect(s.getState().mix.mixdown).toEqual({ format: "mp3", loudness: -14 });
  });

  it("format and loudness changes are undoable", async () => {
    const s = await loaded();
    s.setMixdown({ format: "wav" });
    s.commit("Mixdown format");
    s.setMixdown({ loudness: -9 });
    s.commit("Mixdown loudness");
    s.undo();
    expect(s.getState().mix.mixdown).toEqual({ format: "wav", loudness: -14 });
    s.undo();
    expect(s.getState().mix.mixdown).toEqual({ format: "mp3", loudness: -14 });
  });
});

describe("exporting the Mixdown", () => {
  it("names the file after the Recording", async () => {
    const s = await loaded();
    s.setMixdown({ format: "wav" });
    const { fileName } = await s.exportMixdown();
    expect(fileName).toBe("voice memo-enhanced.wav");
  });

  for (const loudness of [-14, -16, -9] as const) {
    it(`levels the Mixdown to ${loudness} LUFS without clipping`, async () => {
      const s = await loaded();
      s.setMixdown({ format: "wav", loudness });
      const out = await decode((await s.exportMixdown()).blob);
      const ch = channelsOf(out);
      expect(Math.abs(integratedLoudness(ch, out.sampleRate) - loudness)).toBeLessThanOrEqual(1);
      expect(samplePeak(ch)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 0.001); // -1 dBFS ceiling
    });
  }

  it("covers exactly the Trim range", async () => {
    const s = await loaded();
    s.setTrim({ start: 1, end: 4 });
    s.setMixdown({ format: "wav" });
    const out = await decode((await s.exportMixdown()).blob);
    expect(out.duration).toBeCloseTo(3, 2);
  });

  it("exports stereo so mono phone recordings play in both speakers", async () => {
    const s = await loaded();
    s.setMixdown({ format: "wav" });
    const out = await decode((await s.exportMixdown()).blob);
    expect(out.numberOfChannels).toBe(2);
  });

  it("reports progress up to completion", async () => {
    const s = await loaded();
    s.setMixdown({ format: "wav" });
    const seen: number[] = [];
    await s.exportMixdown((p) => seen.push(p));
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
  });

  const lossy: MixdownFormat[] = ["mp3", "aac"];
  for (const format of lossy) {
    it(`a ${format.toUpperCase()} Mixdown decodes back to the right length and loudness`, async (ctx) => {
      const s = await loaded();
      if (!(await s.supportedMixdownFormats()).includes(format)) ctx.skip();
      s.setMixdown({ format });
      const { blob, fileName } = await s.exportMixdown();
      expect(fileName.endsWith(format === "mp3" ? ".mp3" : ".m4a")).toBe(true);
      const out = await decode(blob);
      expect(Math.abs(out.duration - 6)).toBeLessThan(0.1); // encoder padding is allowed
      expect(Math.abs(integratedLoudness(channelsOf(out), out.sampleRate) - -14)).toBeLessThanOrEqual(1);
    });
  }

  it("refuses to export with no Recording loaded", async () => {
    studio = createStudio();
    await expect(studio.exportMixdown()).rejects.toThrow(/import a recording/i);
  });
});
