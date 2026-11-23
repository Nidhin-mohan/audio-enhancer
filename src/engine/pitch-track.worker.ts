/// <reference lib="webworker" />
import { trackPitch } from "./pitch";
import { serveWorker } from "./workers";

serveWorker<{ mono: Float32Array; sampleRate: number }, Float32Array>((job) => trackPitch(job.mono, job.sampleRate));
