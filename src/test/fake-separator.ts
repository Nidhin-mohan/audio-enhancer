import type { Separator, StemName, StereoAudio } from "../engine/separation";
import { sine } from "./audio-fixtures";

/** A Stem's content: a plain tone, or any signal generated at the requested length and rate. */
export type FakeStem = { freq: number; amp: number } | ((length: number, sampleRate: number) => Float32Array);

/**
 * Fast stand-in for the real model. The "Recording" it pretends to separate is
 * defined by the Stems given here; each Stem is built at the input's sample rate.
 */
export function fakeSeparator(
  stems: Partial<Record<StemName, FakeStem>>,
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
    const make = (name: StemName): StereoAudio => {
      const def = stems[name];
      if (!def) return { left: new Float32Array(n), right: new Float32Array(n) };
      const s = typeof def === "function" ? def(n, sr) : sine(def.freq, n / sr, sr, def.amp);
      return { left: s, right: s.slice() };
    };
    return { sampleRate: sr, vocals: make("vocals"), drums: make("drums"), bass: make("bass"), other: make("other") };
  };
}

/** Deterministic white noise. */
export function noise(length: number, amp: number, seed = 1): Float32Array {
  let x = seed >>> 0 || 1;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = amp * (((x >>> 0) / 4294967296) * 2 - 1);
  }
  return out;
}
