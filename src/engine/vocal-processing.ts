// The vocals Stem's effects chain, run offline in a worker:
// Noise Reduction, then Pitch Correction. (Vocal Boost is a live gain, not here.)

import { reduceNoise } from "./noise-reduction";
import { correctPitch, type PitchJob } from "./pitch";

export interface NoiseReductionSettings {
  enabled: boolean;
  /** 0..100 */
  amount: number;
}

export interface VocalChain {
  noiseReduction: NoiseReductionSettings;
  /** null when Pitch Correction is off. */
  pitch: PitchJob | null;
}

export interface VocalJob extends VocalChain {
  channels: Float32Array[];
  sampleRate: number;
}

const noiseActive = (c: VocalChain) => c.noiseReduction.enabled && c.noiseReduction.amount > 0;
const pitchActive = (c: VocalChain) => !!c.pitch && c.pitch.settings.mix > 0;

/** True when the chain would change the audio at all. */
export const vocalChainActive = (c: VocalChain) => noiseActive(c) || pitchActive(c);

export function processVocals(job: VocalJob, onProgress?: (fraction: number) => void): Float32Array[] {
  let channels = job.channels;
  if (noiseActive(job)) channels = reduceNoise(channels, job.noiseReduction.amount);
  onProgress?.(0.4);
  if (pitchActive(job)) channels = correctPitch(channels, job.sampleRate, job.pitch!);
  onProgress?.(1);
  return channels;
}
