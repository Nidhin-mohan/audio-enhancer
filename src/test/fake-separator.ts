import type { Separator, StereoAudio } from "../engine/separation";
import { sine } from "./audio-fixtures";

/**
 * Fast stand-in for the real model. The "Recording" it pretends to separate is
 * defined by the tones given here; each Stem is built at the input's sample rate.
 */
export function fakeSeparator(
  tones: Partial<Record<"vocals" | "drums" | "bass" | "other", { freq: number; amp: number }>>,
  opts: { delayMs?: number; fail?: string } = {},
): Separator {
  return async (input, onProgress, signal) => {
    for (let step = 1; step <= 4; step++) {
      await new Promise((r) => setTimeout(r, (opts.delayMs ?? 20) / 4));
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress({ phase: "separating", fraction: step / 4 });
    }
    if (opts.fail) throw new Error(opts.fail);
    const n = input.left.length;
    const sr = input.sampleRate;
    const stem = (name: keyof typeof tones): StereoAudio => {
      const t = tones[name];
      if (!t) return { left: new Float32Array(n), right: new Float32Array(n) };
      const s = sine(t.freq, n / sr, sr, t.amp);
      return { left: s, right: s.slice() };
    };
    return { sampleRate: sr, vocals: stem("vocals"), drums: stem("drums"), bass: stem("bass"), other: stem("other") };
  };
}
