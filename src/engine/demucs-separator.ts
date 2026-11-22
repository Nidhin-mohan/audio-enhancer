// The real Separator: Meta's HTDemucs 4-Stem model (via the demucs-web library,
// ONNX Runtime Web, WebGPU with WASM fallback) running in a worker.

import type { SeparatedStems, SeparationProgress, Separator, SeparatorInput } from "./separation";
import type { WorkerMessage } from "./workers";

const MODEL_SAMPLE_RATE = 44100;

/** Resample stereo audio with the browser's own resampler. */
async function resample(input: SeparatorInput, sampleRate: number): Promise<SeparatorInput> {
  if (input.sampleRate === sampleRate) return input;
  const src = new AudioBuffer({ numberOfChannels: 2, length: input.left.length, sampleRate: input.sampleRate });
  src.copyToChannel(input.left as Float32Array<ArrayBuffer>, 0);
  src.copyToChannel(input.right as Float32Array<ArrayBuffer>, 1);
  const length = Math.round((input.left.length * sampleRate) / input.sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const node = ctx.createBufferSource();
  node.buffer = src;
  node.connect(ctx.destination);
  node.start();
  const out = await ctx.startRendering();
  return { left: out.getChannelData(0), right: out.getChannelData(1), sampleRate };
}

export const demucsSeparator: Separator = async (input, onProgress, signal) => {
  onProgress({ phase: "preparing", fraction: 0 });
  const audio = await resample(input, MODEL_SAMPLE_RATE);
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");

  const worker = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  return new Promise<SeparatedStems>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort);
    worker.onmessage = (e: MessageEvent<WorkerMessage<SeparatedStems> | { type: "phase"; progress: SeparationProgress }>) => {
      const m = e.data;
      if (m.type === "phase") onProgress(m.progress);
      else if (m.type === "done") {
        finish();
        resolve(m.result);
      } else if (m.type === "error") {
        finish();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "The separation worker crashed"));
    };
    const left = audio.left.slice();
    const right = audio.right.slice();
    worker.postMessage({ left, right }, [left.buffer, right.buffer]);
  });
};
