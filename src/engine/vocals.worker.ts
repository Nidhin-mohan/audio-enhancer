/// <reference lib="webworker" />
import { processVocals, type VocalJob } from "./vocal-processing";
import { serveWorker } from "./workers";

serveWorker<VocalJob, Float32Array[]>(processVocals);
