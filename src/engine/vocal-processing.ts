// The vocals Stem's effects chain, run offline in a worker:
// Noise Reduction, then Pitch Correction. (Vocal Boost is a live gain, not here.)

import { reduceNoise } from "./noise-reduction";

export interface NoiseReductionSettings {
  enabled: boolean;
  /** 0..100 */
  amount: number;
}

export interface VocalJob {
  channels: Float32Array[];
  sampleRate: number;
  noiseReduction: NoiseReductionSettings;
}

/** True when the chain would change the audio at all. */
export const vocalChainActive = (job: Omit<VocalJob, "channels" | "sampleRate">) =>
  job.noiseReduction.enabled && job.noiseReduction.amount > 0;

export function processVocals(job: VocalJob, onProgress?: (fraction: number) => void): Float32Array[] {
  let channels = job.channels;
  if (job.noiseReduction.enabled && job.noiseReduction.amount > 0) channels = reduceNoise(channels, job.noiseReduction.amount);
  onProgress?.(1);
  return channels;
}
