// Noise Reduction by spectral gating: learn each frequency's noise floor from the
// quietest moments of the vocals Stem, then turn down whatever stays near that
// floor (hiss, hum, room noise) while letting the voice through.

import { fft, hann, ifft } from "./dsp";

const SIZE = 2048;
const HOP = SIZE / 4;

/**
 * @param channels the vocals Stem (any number of channels, same length)
 * @param amount 0..100 — how hard to gate; 0 returns the input unchanged
 */
export function reduceNoise(channels: Float32Array[], amount: number): Float32Array[] {
  const a = Math.max(0, Math.min(100, amount)) / 100;
  if (a === 0) return channels.map((c) => c.slice());
  const n = channels[0].length;
  const bins = SIZE / 2 + 1;
  const frames = Math.max(1, Math.ceil(n / HOP) + 1);
  const window = hann(SIZE);
  const pad = SIZE; // so the first/last samples are fully covered

  // 1) Spectra of every frame, for every channel.
  const spectra = channels.map((c) => {
    const re: Float64Array[] = [];
    const im: Float64Array[] = [];
    for (let f = 0; f < frames; f++) {
      const r = new Float64Array(SIZE);
      const i = new Float64Array(SIZE);
      const start = f * HOP - pad / 2;
      for (let k = 0; k < SIZE; k++) {
        const idx = start + k;
        if (idx >= 0 && idx < n) r[k] = c[idx] * window[k];
      }
      fft(r, i);
      re.push(r);
      im.push(i);
    }
    return { re, im };
  });

  // 2) Mid magnitude per frame/bin, and the noise floor per bin (a low percentile over time).
  const mag: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const m = new Float32Array(bins);
    for (const s of spectra) for (let b = 0; b < bins; b++) m[b] += Math.hypot(s.re[f][b], s.im[f][b]) / spectra.length;
    mag.push(m);
  }
  const floor = new Float32Array(bins);
  const column = new Float32Array(frames);
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames; f++) column[f] = mag[f][b];
    const sorted = column.slice().sort();
    floor[b] = sorted[Math.floor(0.15 * (frames - 1))];
  }

  // 3) Gain per frame/bin: subtract the (over-estimated) noise, keep a little of it,
  //    smooth across frequency and time so the result doesn't "warble".
  const overSubtract = 1.5 + 2.5 * a;
  const minGain = 1 - 0.97 * a; // amount 100 → about -30 dB on pure noise
  const release = 0.5;
  const prev = new Float32Array(bins).fill(1);
  const gains: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const raw = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const m = mag[f][b];
      const g = m > 0 ? 1 - (overSubtract * floor[b]) / m : 0;
      raw[b] = Math.max(minGain, Math.min(1, g));
    }
    const g = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const lo = raw[Math.max(0, b - 1)], hi = raw[Math.min(bins - 1, b + 1)];
      const smoothed = (lo + 2 * raw[b] + hi) / 4;
      // fast to open, slower to close
      g[b] = smoothed >= prev[b] ? smoothed : prev[b] * release + smoothed * (1 - release);
    }
    prev.set(g);
    gains.push(g);
  }

  // 4) Apply and resynthesise (weighted overlap-add with the same window).
  return spectra.map((s) => {
    const out = new Float64Array(n + pad);
    const norm = new Float64Array(n + pad);
    for (let f = 0; f < frames; f++) {
      const r = s.re[f], i = s.im[f], g = gains[f];
      for (let b = 0; b < bins; b++) {
        r[b] *= g[b];
        i[b] *= g[b];
        if (b > 0 && b < SIZE / 2) {
          r[SIZE - b] *= g[b];
          i[SIZE - b] *= g[b];
        }
      }
      ifft(r, i);
      const start = f * HOP;
      for (let k = 0; k < SIZE; k++) {
        out[start + k] += r[k] * window[k];
        norm[start + k] += window[k] * window[k];
      }
    }
    const result = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const j = k + pad / 2;
      result[k] = norm[j] > 1e-8 ? out[j] / norm[j] : 0;
    }
    return result;
  });
}
