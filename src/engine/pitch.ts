// Pitch Correction for a monophonic voice:
//   1. track the sung pitch (YIN on a 4x-downsampled copy),
//   2. work out how far to move each moment towards the nearest note of the Key
//      (amount, humanize, vibrato preservation, retune glide),
//   3. resynthesise with PSOLA — the voice's own waveform cycles, re-spaced to the
//      new pitch, which keeps the formants (the character of the voice) intact.

import { NOTES, type NoteName, type Scale } from "./key";

export interface PitchSettings {
  /** How fast notes glide to the target, ms (0 = instant, robotic). */
  retuneMs: number;
  /** 0..100: leave small, expressive deviations more alone. */
  humanize: number;
  /** 0..100: how far towards the target note. */
  amount: number;
  /** 0..100: keep the singer's vibrato instead of flattening it. */
  vibrato: number;
  /** Keep the voice's character (formants) when shifting. */
  formant: boolean;
  /** 0..100: dry/wet blend of corrected and original voice. */
  mix: number;
}

export interface PitchJob {
  root: NoteName;
  scale: Scale;
  settings: PitchSettings;
}

/** Semitones above the root that belong to each scale. */
export const SCALE_DEGREES: Record<Scale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const DECIMATE = 4;
const FRAME = 512; // at sampleRate / 4
const HOP = 128; // ≈ 11.6 ms at 44.1 kHz
const F_MIN = 70;
const F_MAX = 1000;

/** Low-pass and decimate by 4 (windowed-sinc FIR, cutoff ≈ 0.11·fs). */
function downsample(x: Float32Array): Float32Array {
  const taps = 31;
  const h = new Float64Array(taps);
  const fc = 0.45 / DECIMATE;
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const m = k - (taps - 1) / 2;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    h[k] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (taps - 1)));
    sum += h[k];
  }
  const out = new Float32Array(Math.floor(x.length / DECIMATE));
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    const c = i * DECIMATE;
    for (let k = 0; k < taps; k++) {
      const j = c + k - (taps - 1) / 2;
      if (j >= 0 && j < x.length) v += h[k] * x[j];
    }
    out[i] = v / sum;
  }
  return out;
}

/** Pitch in Hz per analysis frame (0 = unvoiced/silent). Frame i is centred at i·HOP·4 input samples. */
export function trackPitch(mono: Float32Array, sampleRate: number): Float32Array {
  const x = downsample(mono);
  const sr = sampleRate / DECIMATE;
  const half = FRAME / 2;
  const tauMin = Math.floor(sr / F_MAX);
  const tauMax = Math.min(half - 1, Math.ceil(sr / F_MIN));
  const frames = Math.ceil(x.length / HOP);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const silence = peak * 0.03; // about -30 dB below the loudest moment
  const f0 = new Float32Array(frames);
  const d = new Float64Array(tauMax + 1);

  for (let f = 0; f < frames; f++) {
    const start = f * HOP - half;
    let energy = 0;
    for (let j = 0; j < FRAME; j++) {
      const v = x[start + j] ?? 0;
      energy += v * v;
    }
    if (Math.sqrt(energy / FRAME) < silence) continue;

    // YIN difference function and cumulative-mean normalisation.
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < half; j++) {
        const a = x[start + j] ?? 0, b = x[start + j + tau] ?? 0;
        s += (a - b) * (a - b);
      }
      d[tau] = s;
    }
    let running = 0;
    let best = -1;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      const cmnd = running > 0 ? (d[tau] * tau) / running : 1;
      d[tau] = cmnd;
    }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < 0.15) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) continue;
    // Parabolic interpolation around the minimum.
    const a = d[best - 1] ?? d[best], b = d[best], c = d[best + 1] ?? d[best];
    const shift = a + c - 2 * b !== 0 ? (a - c) / (2 * (a + c - 2 * b)) : 0;
    f0[f] = sr / (best + shift);
  }
  // Remove single-frame glitches (octave jumps, isolated voiced/unvoiced frames).
  const clean = f0.slice();
  for (let f = 1; f < frames - 1; f++) {
    const trio = [f0[f - 1], f0[f], f0[f + 1]].sort((p, q) => p - q);
    clean[f] = trio[1];
  }
  return clean;
}

/** Nearest note of the scale to `midi` (fractional MIDI note number). */
function nearestScaleNote(midi: number, root: number, scale: Scale): number {
  const degrees = SCALE_DEGREES[scale];
  let best = midi;
  let bestDist = Infinity;
  const base = Math.floor(midi) - 12;
  for (let m = base; m <= base + 24; m++) {
    if (!degrees.includes((((m - root) % 12) + 12) % 12)) continue;
    const dist = Math.abs(m - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return best;
}

/** Pitch-shift ratio per analysis frame (1 = unchanged). */
export function correctionRatios(f0: Float32Array, sampleRate: number, job: PitchJob): Float32Array {
  const { settings } = job;
  const root = NOTES.indexOf(job.root);
  const frameSec = (HOP * DECIMATE) / sampleRate;
  const midi = Array.from(f0, (f) => (f > 0 ? 69 + 12 * Math.log2(f / 440) : NaN));

  // Smoothed pitch (≈150 ms), so vibrato around a note can be kept.
  const span = Math.max(1, Math.round(0.075 / frameSec));
  const base = midi.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i - span; j <= i + span; j++) if (j >= 0 && j < midi.length && !Number.isNaN(midi[j])) (s += midi[j]), n++;
    return n ? s / n : NaN;
  });

  const vib = settings.vibrato / 100;
  const humanizeThreshold = 0.3 * (settings.humanize / 100); // semitones
  const amount = settings.amount / 100;
  const glide = settings.retuneMs <= 0 ? 1 : 1 - Math.exp(-(frameSec * 1000) / settings.retuneMs);
  const ratios = new Float32Array(f0.length).fill(1);
  let current = 0;
  let wasVoiced = false;
  for (let i = 0; i < f0.length; i++) {
    if (Number.isNaN(midi[i])) {
      wasVoiced = false;
      continue;
    }
    if (!wasVoiced) current = 0; // each note starts uncorrected and glides in (instantly when glide = 1)
    wasVoiced = true;
    const direct = nearestScaleNote(midi[i], root, job.scale) - midi[i];
    const centre = nearestScaleNote(base[i], root, job.scale) - base[i];
    let wanted = (1 - vib) * direct + vib * centre;
    if (humanizeThreshold > 0) wanted *= Math.min(1, Math.abs(wanted) / humanizeThreshold);
    wanted *= amount;
    current += (wanted - current) * glide;
    ratios[i] = Math.pow(2, current / 12);
  }
  return ratios;
}

/** Sung and corrected pitch over time, for drawing against the Key's notes. */
export interface PitchPicture {
  /** Seconds between frames; frame i is at i·frameSec. */
  frameSec: number;
  /** Sung pitch as a fractional MIDI note number (69 = A4); NaN where nothing is sung. */
  sung: Float32Array;
  /** Where Pitch Correction moves it with the given settings (equal to `sung` when off). */
  corrected: Float32Array;
}

/** `job` null means Pitch Correction is off. */
export function pitchPicture(f0: Float32Array, sampleRate: number, job: PitchJob | null): PitchPicture {
  const sung = f0.map((f) => (f > 0 ? 69 + 12 * Math.log2(f / 440) : NaN));
  const corrected = sung.slice();
  if (job) {
    const ratios = correctionRatios(f0, sampleRate, job);
    for (let i = 0; i < corrected.length; i++) corrected[i] += 12 * Math.log2(ratios[i]);
  }
  return { frameSec: (HOP * DECIMATE) / sampleRate, sung, corrected };
}

/**
 * PSOLA resynthesis. `f0`/`ratios` are per analysis frame (HOP·4 input samples apart).
 * The same pitch marks are used for every channel so stereo stays aligned.
 */
export function psola(
  channels: Float32Array[],
  sampleRate: number,
  f0: Float32Array,
  ratios: Float32Array,
  keepFormants: boolean,
): Float32Array[] {
  const n = channels[0].length;
  const hopIn = HOP * DECIMATE;
  const unvoicedPeriod = Math.round(0.01 * sampleRate);
  const frameAt = (t: number) => Math.min(f0.length - 1, Math.max(0, Math.round(t / hopIn)));
  const periodAt = (t: number) => {
    const f = f0[frameAt(t)];
    return f > 0 ? sampleRate / f : unvoicedPeriod;
  };

  // Analysis marks: one per period of the input.
  const marks: number[] = [];
  for (let t = 0; t < n; t += Math.max(16, periodAt(t))) marks.push(t);
  let mi = 0;
  const nearestMark = (t: number) => {
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1] - t) <= Math.abs(marks[mi] - t)) mi++;
    return marks[mi];
  };

  const out = channels.map(() => new Float64Array(n));
  const norm = new Float64Array(n);
  for (let ts = 0; ts < n; ) {
    const ta = nearestMark(ts);
    const period = periodAt(ta);
    const ratio = f0[frameAt(ta)] > 0 ? ratios[frameAt(ta)] : 1;
    const halfIn = Math.round(period);
    // Grain length in the output: unchanged (formants kept) or scaled with the pitch.
    const halfOut = keepFormants ? halfIn : Math.max(4, Math.round(halfIn / ratio));
    for (let k = -halfOut; k < halfOut; k++) {
      const o = Math.round(ts) + k;
      if (o < 0 || o >= n) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * k) / halfOut);
      const srcPos = ta + (keepFormants ? k : k * ratio);
      const s0 = Math.floor(srcPos), frac = srcPos - s0;
      if (s0 < 0 || s0 + 1 >= n) continue;
      for (let c = 0; c < channels.length; c++) out[c][o] += w * (channels[c][s0] * (1 - frac) + channels[c][s0 + 1] * frac);
      norm[o] += w;
    }
    ts += Math.max(8, period / ratio);
  }
  return out.map((o) => {
    const r = new Float32Array(n);
    // Weighted overlap-add normalisation (grains can leave small gaps when lowering pitch).
    for (let i = 0; i < n; i++) r[i] = norm[i] > 0.05 ? o[i] / norm[i] : o[i];
    return r;
  });
}

export function correctPitch(channels: Float32Array[], sampleRate: number, job: PitchJob): Float32Array[] {
  const wet = job.settings.mix / 100;
  if (wet <= 0) return channels.map((c) => c.slice());
  const mono = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / channels.length;
  const f0 = trackPitch(mono, sampleRate);
  const ratios = correctionRatios(f0, sampleRate, job);
  const shifted = psola(channels, sampleRate, f0, ratios, job.settings.formant);
  if (wet >= 1) return shifted;
  return shifted.map((s, c) => s.map((v, i) => wet * v + (1 - wet) * channels[c][i]));
}
