/// <reference lib="webworker" />
import { finishMixdown, type MixdownJob } from "./mixdown";
import { serveWorker } from "./workers";

serveWorker<MixdownJob, Blob>(finishMixdown);
