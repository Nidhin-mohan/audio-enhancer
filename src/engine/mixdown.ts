// Turns rendered audio into a finished Mixdown file: loudness levelling plus
// encoding. Runs in a worker so the Studio stays responsive.

import { encodeAac, encodeMp3, encodeWav, type Progress } from "./encoders";
import { levelToLoudness } from "./mastering";

export type MixdownFormat = "mp3" | "wav" | "aac";
export type MixdownLoudness = -14 | -16 | -9;

export interface MixdownJob {
  channels: Float32Array[];
  sampleRate: number;
  format: MixdownFormat;
  loudness: MixdownLoudness;
}

export const MIXDOWN_EXTENSION: Record<MixdownFormat, string> = { mp3: "mp3", wav: "wav", aac: "m4a" };

export async function finishMixdown(job: MixdownJob, onProgress?: Progress): Promise<Blob> {
  const levelled = levelToLoudness(job.channels, job.sampleRate, job.loudness);
  onProgress?.(0.3);
  const encodeProgress: Progress = (p) => onProgress?.(0.3 + 0.7 * p);
  if (job.format === "wav") {
    const blob = encodeWav(levelled, job.sampleRate);
    onProgress?.(1);
    return blob;
  }
  if (job.format === "mp3") return encodeMp3(levelled, job.sampleRate, encodeProgress);
  return encodeAac(levelled, job.sampleRate, encodeProgress);
}
