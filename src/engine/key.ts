// Key detection: average pitch-class energy (chroma) of the whole Recording,
// matched against the Krumhansl–Kessler major and minor key profiles.

export const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type NoteName = (typeof NOTES)[number];
export type Scale = "major" | "minor" | "chromatic";

export interface DetectedKey {
  root: NoteName;
  scale: "major" | "minor";
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const pitchClass = (f: number) => ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;

/**
 * Harmonic pitch class profile: energy per pitch class (C..B) between ~60 Hz and
 * ~2 kHz. Each frequency also votes, with decaying weight, for the notes it could be
 * a harmonic of (f/2, f/3, f/4). Without this, a note's 3rd harmonic (its fifth)
 * biases detection towards the key a fifth above.
 */
export function chroma(mono: Float32Array, sampleRate: number): number[] {
  const size = 8192;
  const hop = 4096;
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const HARMONIC_WEIGHTS = [1, 0.6, 0.36, 0.22];
  // For every bin: the pitch classes it votes for and how strongly.
  const votes: { pc: number; weight: number }[][] = Array.from({ length: size / 2 }, () => []);
  for (let k = 1; k < size / 2; k++) {
    const f = (k * sampleRate) / size;
    if (f < 60 || f > 2000) continue;
    HARMONIC_WEIGHTS.forEach((weight, h) => {
      const fundamental = f / (h + 1);
      if (fundamental >= 50) votes[k].push({ pc: pitchClass(fundamental), weight });
    });
  }
  const out = new Array<number>(12).fill(0);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start + size <= mono.length; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      if (!votes[k].length) continue;
      const magnitude = Math.hypot(re[k], im[k]);
      for (const { pc, weight } of votes[k]) out[pc] += weight * magnitude;
    }
  }
  return out;
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Best-matching key, or null when there is no tonal content (e.g. silence). */
export function detectKey(mono: Float32Array, sampleRate: number): DetectedKey | null {
  const c = chroma(mono, sampleRate);
  if (c.every((v) => v === 0)) return null;
  let best: DetectedKey | null = null;
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    // Rotate the chroma so the candidate root sits at index 0.
    const rotated = c.map((_, i) => c[(i + root) % 12]);
    for (const [scale, profile] of [["major", MAJOR], ["minor", MINOR]] as const) {
      const score = correlation(rotated, profile);
      if (score > bestScore) {
        bestScore = score;
        best = { root: NOTES[root], scale };
      }
    }
  }
  return best;
}
