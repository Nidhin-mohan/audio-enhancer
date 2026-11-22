/// <reference lib="webworker" />
import { detectKey, type DetectedKey } from "./key";
import { serveWorker } from "./workers";

serveWorker<{ mono: Float32Array; sampleRate: number }, DetectedKey | null>((job) => detectKey(job.mono, job.sampleRate));
