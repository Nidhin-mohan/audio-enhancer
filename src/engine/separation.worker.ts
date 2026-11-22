/// <reference lib="webworker" />
// Runs HTDemucs in a worker. The model (~172 MB) is downloaded once from Hugging Face
// and kept in the browser's Cache Storage, so later Separations work offline.

import * as ort from "onnxruntime-web/webgpu";
import { CONSTANTS, DemucsProcessor } from "demucs-web";
import { MODEL_CACHE_NAME, SEPARATION_MODEL_URL, type SeparatedStems, type SeparationProgress } from "./separation";

const MODEL_URL = SEPARATION_MODEL_URL;
const CACHE_NAME = MODEL_CACHE_NAME;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const phase = (progress: SeparationProgress) => scope.postMessage({ type: "phase", progress });

/** The model bytes: from Cache Storage if present, otherwise downloaded (with progress) and cached. */
async function modelBytes(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(MODEL_URL);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body) throw new Error(`Couldn't download the Separation model (HTTP ${response.status}).`);
  const total = Number(response.headers.get("Content-Length")) || 172_000_000;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    phase({ phase: "downloading", fraction: Math.min(1, loaded / total) });
  }
  const bytes = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  await cache.put(MODEL_URL, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  return bytes.buffer;
}

scope.onmessage = async (e: MessageEvent<{ left: Float32Array; right: Float32Array }>) => {
  try {
    ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
    const model = await modelBytes();
    phase({ phase: "preparing", fraction: 0.5 });
    const processor = new DemucsProcessor({
      ort,
      onProgress: ({ progress }: { progress: number }) => phase({ phase: "separating", fraction: progress }),
    });
    await processor.loadModel(model);
    phase({ phase: "separating", fraction: 0 });
    const out = await processor.separate(e.data.left, e.data.right);
    const result: SeparatedStems = { sampleRate: CONSTANTS.SAMPLE_RATE, ...out };
    const transfer = (["vocals", "drums", "bass", "other"] as const).flatMap((n) => [
      result[n].left.buffer,
      result[n].right.buffer,
    ]);
    scope.postMessage({ type: "done", result }, transfer);
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
