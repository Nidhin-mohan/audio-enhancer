// Loudness levelling for the Mixdown: gain to a target integrated loudness, with
// a look-ahead true-peak limiter so nothing goes above the ceiling, including the
// peaks between samples that appear after playback or lossy encoding.

import { integratedLoudness, interSamplePeaks } from "./loudness";

const dbToLinear = (db: number) => Math.pow(10, db / 20);

/** -1 dBTP: the usual streaming ceiling. */
export const CEILING_DBTP = -1;
/** Lossy encoders (MP3/AAC) overshoot a little, so they get extra headroom. */
export const LOSSY_CEILING_DBTP = -1.5;

/**
 * Smooth gain curve that keeps the true peak * gain <= ceiling everywhere.
 * Centred min-filter followed by a box filter of the same half-width guarantees the
 * gain never exceeds what any sample needs, while ramping in over ~5 ms (no clicks);
 * release back towards unity takes ~80 ms.
 */
function limiterGain(channels: Float32Array[], ceiling: number, sampleRate: number): Float32Array {
  const n = channels[0].length;
  const half = Math.max(1, Math.round(0.005 * sampleRate));
  const peaks = channels.map(interSamplePeaks);
  const required = new Float32Array(n);
  let needed = false;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const p of peaks) peak = Math.max(peak, p[i]);
    required[i] = peak > ceiling ? ceiling / peak : 1;
    if (required[i] < 1) needed = true;
  }
  if (!needed) return required;

  // Sliding-window minimum over [i - half, i + half] (monotonic deque).
  const minimum = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let j = 0; j < n + half; j++) {
    if (j < n) {
      while (tail > head && required[dq[tail - 1]] >= required[j]) tail--;
      dq[tail++] = j;
    }
    const i = j - half;
    if (i < 0) continue;
    while (dq[head] < i - half) head++;
    minimum[i] = required[dq[head]];
  }

  // Box average over the same window, then release smoothing.
  const gain = new Float32Array(n);
  const width = 2 * half + 1;
  let sum = 0;
  for (let j = -half; j <= half; j++) sum += minimum[Math.min(n - 1, Math.max(0, j))];
  const release = 1 - Math.exp(-1 / (0.08 * sampleRate));
  let env = 1;
  for (let i = 0; i < n; i++) {
    const avg = sum / width;
    env = Math.min(avg, env + (1 - env) * release);
    gain[i] = env;
    sum += minimum[Math.min(n - 1, i + half + 1)] - minimum[Math.max(0, i - half)];
  }
  return gain;
}

/** Level `channels` to `targetLufs` with the true peak at or below `ceilingDbtp`. Returns new arrays. */
export function levelToLoudness(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs: number,
  ceilingDbtp = CEILING_DBTP,
): Float32Array[] {
  const ceiling = dbToLinear(ceilingDbtp);
  const measured = integratedLoudness(channels, sampleRate);
  if (!Number.isFinite(measured)) return channels.map((c) => c.slice());

  let gainDb = targetLufs - measured;
  let out: Float32Array[] = [];
  // The limiter can pull loudness down; nudge the gain up and try again (a few times at most).
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = dbToLinear(gainDb);
    out = channels.map((c) => c.map((v) => v * g));
    const limit = limiterGain(out, ceiling, sampleRate);
    for (const c of out)
      for (let i = 0; i < c.length; i++) c[i] = Math.max(-ceiling, Math.min(ceiling, c[i] * limit[i]));
    const shortfall = targetLufs - integratedLoudness(out, sampleRate);
    if (Math.abs(shortfall) <= 0.3) break;
    gainDb += shortfall;
  }
  return out;
}
