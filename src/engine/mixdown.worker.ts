/// <reference lib="webworker" />
import { finishMixdown, type MixdownJob } from "./mixdown";

export type MixdownWorkerMessage =
  | { type: "progress"; value: number }
  | { type: "done"; blob: Blob }
  | { type: "error"; message: string };

const post = (m: MixdownWorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<MixdownJob>) => {
  try {
    const blob = await finishMixdown(e.data, (value) => post({ type: "progress", value }));
    post({ type: "done", blob });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
