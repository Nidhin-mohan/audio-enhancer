// demucs-web ships plain JavaScript; these are the parts this app uses.
declare module "demucs-web" {
  interface StereoTrack {
    left: Float32Array;
    right: Float32Array;
  }
  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string; [key: string]: unknown };
  export class DemucsProcessor {
    constructor(options: {
      ort: unknown;
      modelPath?: string;
      sessionOptions?: Record<string, unknown>;
      onProgress?: (p: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onLog?: (phase: string, message: string) => void;
      onDownloadProgress?: (loaded: number, total: number) => void;
    });
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
    separate(
      left: Float32Array,
      right: Float32Array,
    ): Promise<{ drums: StereoTrack; bass: StereoTrack; other: StereoTrack; vocals: StereoTrack }>;
  }
}
