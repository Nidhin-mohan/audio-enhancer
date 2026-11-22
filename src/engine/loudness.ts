// Loudness measurement per ITU-R BS.1770-4 (K-weighting, 400 ms blocks with
// 75% overlap, absolute gate at -70 LUFS and relative gate at -10 LU).
// Pure functions, so they can run in a worker or on the main thread.

type Coeffs = { b: [number, number, number]; a: [number, number] };

/** K-weighting stage 1 (high shelf) and stage 2 (high pass), derived for any sample rate. */
function kWeighting(sampleRate: number): [Coeffs, Coeffs] {
  // Stage 1: high-frequency shelf
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Coeffs = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // Stage 2: high pass (RLB weighting)
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sampleRate);
  const d = 1 + K1 / Q1 + K1 * K1;
  const highpass: Coeffs = { b: [1, -2, 1], a: [(2 * (K1 * K1 - 1)) / d, (1 - K1 / Q1 + K1 * K1) / d] };
  return [shelf, highpass];
}

function biquad(x: Float32Array, { b, a }: Coeffs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Integrated loudness in LUFS (−Infinity for silence). Channel weights are 1 (L, R, C). */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted = channels.map((c) => biquad(biquad(c, shelf), hp));
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const n = weighted[0]?.length ?? 0;
  if (n < block) return -Infinity;

  // Mean square per block, summed over channels.
  const energies: number[] = [];
  for (let start = 0; start + block <= n; start += step) {
    let sum = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = start; i < start + block; i++) s += w[i] * w[i];
      sum += s / block;
    }
    energies.push(sum);
  }
  const lufs = (e: number) => -0.691 + 10 * Math.log10(e);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const aboveAbsolute = energies.filter((e) => lufs(e) > -70);
  if (!aboveAbsolute.length) return -Infinity;
  const relativeGate = lufs(mean(aboveAbsolute)) - 10;
  const gated = aboveAbsolute.filter((e) => lufs(e) > relativeGate);
  return lufs(mean(gated));
}

// 4x oversampling with a windowed-sinc interpolator (BS.1770 Annex 2 style true peak).
const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 12; // 6 samples either side
const PHASES: Float64Array[] = Array.from({ length: OVERSAMPLE }, (_, p) => {
  const frac = p / OVERSAMPLE;
  const half = TAPS_PER_PHASE / 2;
  return Float64Array.from({ length: TAPS_PER_PHASE }, (_, k) => {
    const x = k - half + 1 - frac; // distance from the interpolated point to tap k
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (half + 1)); // Hann window
    return sinc * w;
  });
});

/**
 * For each sample index i: the largest absolute value of the signal on [i, i+1),
 * including the peaks between samples, estimated by 4x oversampling.
 */
export function interSamplePeaks(c: Float32Array): Float32Array {
  const n = c.length;
  const out = new Float32Array(n);
  const half = TAPS_PER_PHASE / 2;
  for (let i = 0; i < n; i++) {
    let peak = Math.abs(c[i]);
    for (let p = 1; p < OVERSAMPLE; p++) {
      const h = PHASES[p];
      let v = 0;
      for (let k = 0; k < TAPS_PER_PHASE; k++) {
        const j = i - half + 1 + k;
        if (j >= 0 && j < n) v += h[k] * c[j];
      }
      peak = Math.max(peak, Math.abs(v));
    }
    out[i] = peak;
  }
  return out;
}

/** Estimated true (inter-sample) peak over all channels, linear scale. */
export function truePeak(channels: Float32Array[], _sampleRate?: number): number {
  let peak = 0;
  for (const c of channels) {
    const p = interSamplePeaks(c);
    for (let i = 0; i < p.length; i++) if (p[i] > peak) peak = p[i];
  }
  return peak;
}

export function samplePeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const c of channels)
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
    }
  return peak;
}
