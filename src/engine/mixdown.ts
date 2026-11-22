// Turns the mixed audio into a finished Mixdown file: loudness levelling plus
// encoding. Runs in a worker so the Studio stays responsive.

import { encodeAac, encodeMp3, encodeWav, type Progress } from "./encoders";
import { CEILING_DBTP, levelToLoudness, LOSSY_CEILING_DBTP } from "./levelling";

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
  const ceiling = job.format === "wav" ? CEILING_DBTP : LOSSY_CEILING_DBTP;
  const levelled = levelToLoudness(job.channels, job.sampleRate, job.loudness, ceiling);
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
