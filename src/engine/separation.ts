// Separation: splitting a Recording into its four Stems. The engine depends only
// on the Separator signature, so tests can use a fast stand-in for the real model.

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export interface StereoAudio {
  left: Float32Array;
  right: Float32Array;
}

export interface SeparatorInput extends StereoAudio {
  sampleRate: number;
}

export type SeparatedStems = Record<StemName, StereoAudio> & { sampleRate: number };

export type SeparationPhase = "downloading" | "preparing" | "separating";

export interface SeparationProgress {
  phase: SeparationPhase;
  /** 0..1 within the phase */
  fraction: number;
}

/** Recording in → four Stems out. Must reject with an AbortError when `signal` aborts. */
export type Separator = (
  input: SeparatorInput,
  onProgress: (p: SeparationProgress) => void,
  signal: AbortSignal,
) => Promise<SeparatedStems>;

export type SeparationState =
  | { status: "idle" }
  | { status: "running"; phase: SeparationPhase; fraction: number; etaSec?: number }
  | { status: "done" }
  | { status: "error"; message: string };
