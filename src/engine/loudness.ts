// Loudness measurement per ITU-R BS.1770-4 (K-weighting, 400 ms blocks with
// 75% overlap, absolute gate at -70 LUFS and relative gate at -10 LU).
// Pure functions, so they can run in a worker or on the main thread.

type Coeffs = { b: [number, number, number]; a: [number, number] };

/** K-weighting stage 1 (high shelf) and stage 2 (high pass), derived for any sample rate. */
function kWeighting(sampleRate: number): [Coeffs, Coeffs] {
  {
    // Stage 1: high-frequency shelf
    var f0 = 1681.974450955533;
    var G = 3.999843853973347;
    var Q = 0.7071752369554196;
    var K = Math.tan((Math.PI * f0) / sampleRate);
    var Vh = Math.pow(10, G / 20);
    var Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
  }
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

export function samplePeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const c of channels)
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
    }
  return peak;
}
