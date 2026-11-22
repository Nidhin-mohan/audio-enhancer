// One protocol for all background work: a worker posts progress, then exactly one
// "done" or "error" message.

export type WorkerMessage<T> =
  | { type: "progress"; value: number }
  | { type: "done"; result: T }
  | { type: "error"; message: string };

/** Main thread: run one job in a fresh worker and resolve with its result. */
export function runWorker<T>(
  worker: Worker,
  job: unknown,
  transfer: Transferable[] = [],
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerMessage<T>>) => {
      const m = e.data;
      if (m.type === "progress") return onProgress?.(m.value);
      worker.terminate();
      if (m.type === "done") resolve(m.result);
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Background work failed"));
    };
    worker.postMessage(job, transfer);
  });
}

/** Worker side: answer each job with progress updates and one done/error message. */
export function serveWorker<J, T>(handle: (job: J, onProgress: (fraction: number) => void) => T | Promise<T>) {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  const post = (m: WorkerMessage<T>) => scope.postMessage(m);
  scope.onmessage = async (e: MessageEvent<J>) => {
    try {
      const result = await handle(e.data, (value) => post({ type: "progress", value }));
      post({ type: "done", result });
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };
}
