/// <reference lib="webworker" />
import { detectKey } from "./key";

self.onmessage = (e: MessageEvent<{ mono: Float32Array; sampleRate: number }>) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(detectKey(e.data.mono, e.data.sampleRate));
};
