// Separation: splitting a Recording into its four Stems. The engine depends only
// on the Separator signature, so tests can use a fast stand-in for the real model.

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;

/** The HTDemucs model (≈172 MB), downloaded once and kept in Cache Storage. */
export const SEPARATION_MODEL_URL = "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";
export const MODEL_CACHE_NAME = "audio-enhancer-models-v1";

/** True when the Separation model is already on this computer (no download needed). */
export async function isSeparationModelCached(): Promise<boolean> {
  try {
    return !!(await (await caches.open(MODEL_CACHE_NAME)).match(SEPARATION_MODEL_URL));
  } catch {
    return false;
  }
}
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
