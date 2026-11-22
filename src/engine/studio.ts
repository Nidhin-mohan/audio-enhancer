// The Studio engine: the single module the UI talks to.
// It owns the Recording, the Mix, and playback (transport).

import { aacSupported } from "./encoders";
import { mixOffline, scheduleRecording, type Trim } from "./graph";
import { createHistory, type HistoryLabels } from "./history";
import type { DetectedKey, NoteName, Scale } from "./key";
import { MIXDOWN_EXTENSION, type MixdownFormat, type MixdownLoudness } from "./mixdown";
import { runWorker } from "./workers";

export type { DetectedKey, HistoryLabels, MixdownFormat, MixdownLoudness, NoteName, Scale, Trim };

/** The Key Pitch Correction snaps to; `detected` is true while it follows the detected Key. */
export interface MixKey {
  root: NoteName;
  scale: Scale;
  detected: boolean;
}

export interface MixdownSettings {
  format: MixdownFormat;
  loudness: MixdownLoudness;
}

export interface MixdownFile {
  blob: Blob;
  fileName: string;
}

export interface RecordingInfo {
  name: string;
  durationSec: number;
}

/** The user's choices that decide how the Mixdown sounds. */
export interface Mix {
  trim: Trim;
  key: MixKey;
  mixdown: MixdownSettings;
}

/** Listening controls: they never affect the Mixdown. */
export interface Transport {
  loop: boolean;
  /** 0..1 */
  listeningVolume: number;
}

export type KeyDetection = "idle" | "detecting" | "found" | "not-found";

export interface StudioState {
  recording: RecordingInfo | null;
  mix: Mix;
  transport: Transport;
  playing: boolean;
  /** Where playback last started or will resume from (seconds). Changes on seek/pause/stop, not every frame. */
  cursor: number;
  /** Labels of the undo and redo steps, oldest first. */
  history: HistoryLabels;
  /** The Recording's Key as detected; null until detection finishes (or if it found no tonal content). */
  detectedKey: DetectedKey | null;
  keyDetection: KeyDetection;
}

export interface Studio {
  load(file: File): Promise<void>;
  /** Peak amplitude (0..1) of the Recording in `count` equal time slices, for drawing its waveform. */
  getPeaks(count: number): number[];
  play(): Promise<void>;
  pause(): void;
  /** Stop playback and return to the Trim start. */
  stop(): void;
  seek(sec: number): void;
  /** Current playback position in seconds. Read it every animation frame; it is not part of the state. */
  getPosition(): number;
  /** Change any part of the Trim; values are kept within the Recording and fades within the kept range. */
  setTrim(patch: Partial<Trim>): void;
  setLoop(on: boolean): void;
  setListeningVolume(volume: number): void;
  /**
   * End of a user gesture (handle release, slider change, click): records one undo
   * step named `label` if the Mix changed since the last step.
   */
  commit(label: string): void;
  undo(): void;
  redo(): void;
  /** The Mix as stereo audio over the Trim range, before loudness levelling (what the Mixdown is made from). */
  mixAudio(): Promise<AudioBuffer>;
  /** Override the Key (root and/or scale). */
  setKey(patch: Partial<Pick<MixKey, "root" | "scale">>): void;
  /** Go back to following the detected Key. */
  useDetectedKey(): void;
  setMixdown(patch: Partial<MixdownSettings>): void;
  /** Formats this browser can export (AAC depends on built-in encoder support). */
  supportedMixdownFormats(): Promise<MixdownFormat[]>;
  /** Mix, level and encode the Mixdown. Progress goes from 0 to 1. */
  exportMixdown(onProgress?: (fraction: number) => void): Promise<MixdownFile>;
  getState(): StudioState;
  subscribe(listener: (state: StudioState) => void): () => void;
  dispose(): void;
}

const MIN_KEPT_SEC = 0.05;
/** Placeholder until the Key is detected; replaced as soon as detection finds one. */
const DEFAULT_KEY: MixKey = { root: "C", scale: "major", detected: true };
const sameTrim = (a: Trim, b: Trim) =>
  a.start === b.start && a.end === b.end && a.fadeIn === b.fadeIn && a.fadeOut === b.fadeOut;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function peaksOf(buffer: AudioBuffer, count: number): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const size = buffer.length / count;
  const peaks = new Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) {
    const end = Math.min(buffer.length, Math.floor((i + 1) * size));
    let max = 0;
    for (const data of channels)
      for (let j = Math.floor(i * size); j < end; j++) {
        const a = Math.abs(data[j]);
        if (a > max) max = a;
      }
    peaks[i] = max;
  }
  return peaks;
}

function constrainTrim(current: Trim, patch: Partial<Trim>, duration: number): Trim {
  const minKept = Math.min(MIN_KEPT_SEC, duration);
  let start = clamp(patch.start ?? current.start, 0, duration);
  let end = clamp(patch.end ?? current.end, 0, duration);
  if (patch.start !== undefined && patch.end !== undefined && start > end) [start, end] = [end, start];
  if (end - start < minKept) {
    if (patch.start !== undefined && patch.end === undefined) start = Math.max(0, end - minKept);
    else end = Math.min(duration, start + minKept);
    if (end - start < minKept) start = Math.max(0, end - minKept);
  }
  const kept = end - start;
  let fadeIn = Math.max(0, patch.fadeIn ?? current.fadeIn);
  let fadeOut = Math.max(0, patch.fadeOut ?? current.fadeOut);
  if (fadeIn + fadeOut > kept) {
    const k = kept / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  return { start, end, fadeIn, fadeOut };
}

export function createStudio(): Studio {
  const ctx = new AudioContext();
  const listeningGain = ctx.createGain();
  listeningGain.connect(ctx.destination);

  let state: StudioState = {
    recording: null,
    mix: {
      trim: { start: 0, end: 0, fadeIn: 0, fadeOut: 0 },
      key: DEFAULT_KEY,
      mixdown: { format: "mp3", loudness: -14 },
    },
    transport: { loop: false, listeningVolume: 0.8 },
    playing: false,
    cursor: 0,
    history: { undo: [], redo: [] },
    detectedKey: null,
    keyDetection: "idle",
  };
  let loadToken = 0;
  listeningGain.gain.value = state.transport.listeningVolume;
  const history = createHistory<Mix>(state.mix);
  let buffer: AudioBuffer | null = null;
  const listeners = new Set<(s: StudioState) => void>();

  // Transport: while playing, position = offset + (ctx.currentTime - startedAt).
  let source: AudioBufferSourceNode | null = null;
  let offset = 0;
  let startedAt = 0;

  const setState = (patch: Partial<StudioState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };
  const trim = () => state.mix.trim;

  const position = () => {
    if (!buffer) return 0;
    if (!source) return offset;
    return Math.min(trim().end, offset + (ctx.currentTime - startedAt));
  };

  const stopSource = () => {
    if (!source) return;
    const s = source;
    source = null;
    s.onended = null;
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
    s.disconnect();
  };

  const startSource = (from: number) => {
    if (!buffer) return;
    const s = scheduleRecording(ctx, listeningGain, buffer, trim(), from);
    s.onended = () => {
      if (source !== s) return; // stopped on purpose
      source = null;
      if (state.transport.loop) {
        startSource(trim().start);
        setState({ cursor: trim().start });
      } else {
        offset = trim().start;
        setState({ playing: false, cursor: offset });
      }
    };
    offset = from;
    startedAt = ctx.currentTime;
    source = s;
  };

  /** Restart playback from where it is now, e.g. after the Trim changed. */
  const restartIfPlaying = () => {
    if (!source) return;
    const at = clamp(position(), trim().start, trim().end - 0.001);
    stopSource();
    startSource(at);
  };

  /** Apply a new Mix and keep playback consistent with it (only a Trim change needs a restart). */
  const applyMix = (mix: Mix, extra: Partial<StudioState> = {}) => {
    const trimChanged = !sameTrim(mix.trim, state.mix.trim);
    setState({ mix, ...extra });
    if (!trimChanged) return;
    const t = mix.trim;
    if (source) restartIfPlaying();
    else if (offset < t.start || offset > t.end) {
      offset = clamp(offset, t.start, t.end);
      setState({ cursor: offset });
    }
  };

  const mixAudio = () => {
    if (!buffer) throw new Error("Import a Recording first.");
    return mixOffline(buffer, trim());
  };

  const restoreFromHistory = (mix: Mix | null) => {
    if (mix) applyMix(mix, { history: history.labels() });
  };

  /** Detect the Key in a worker; when it arrives, every Mix that follows the detected Key adopts it. */
  const detectKeyInBackground = (decoded: AudioBuffer, token: number) => {
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    const worker = new Worker(new URL("./key.worker.ts", import.meta.url), { type: "module" });
    runWorker<DetectedKey | null>(worker, { mono, sampleRate: decoded.sampleRate }, [mono.buffer])
      .catch(() => null)
      .then((found) => {
        if (token !== loadToken) return; // a newer Recording was loaded meanwhile
        if (!found) return setState({ keyDetection: "not-found" });
        const adopt = (mix: Mix): Mix => (mix.key.detected ? { ...mix, key: { ...found, detected: true } } : mix);
        history.rewrite(adopt);
        setState({ detectedKey: found, keyDetection: "found", mix: adopt(state.mix), history: history.labels() });
      });
  };

  return {
    async load(file) {
      let decoded: AudioBuffer;
      try {
        decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      } catch {
        throw new Error(`Couldn't read "${file.name}". Try an M4A, MP3, WAV or OGG audio file.`);
      }
      stopSource();
      buffer = decoded;
      offset = 0;
      const mix: Mix = {
        ...state.mix,
        trim: { start: 0, end: decoded.duration, fadeIn: 0, fadeOut: 0 },
        key: DEFAULT_KEY,
      };
      history.reset(mix);
      setState({
        recording: { name: file.name, durationSec: decoded.duration },
        mix,
        playing: false,
        cursor: 0,
        history: history.labels(),
        detectedKey: null,
        keyDetection: "detecting",
      });
      detectKeyInBackground(decoded, ++loadToken);
    },
    getPeaks(count) {
      return buffer ? peaksOf(buffer, count) : [];
    },
    async play() {
      if (!buffer || source) return;
      if (ctx.state === "suspended") await ctx.resume();
      const { start, end } = trim();
      startSource(offset < start || offset >= end - 0.001 ? start : offset);
      setState({ playing: true, cursor: offset });
    },
    pause() {
      if (!source) return;
      offset = position();
      stopSource();
      setState({ playing: false, cursor: offset });
    },
    stop() {
      stopSource();
      offset = trim().start;
      setState({ playing: false, cursor: offset });
    },
    seek(sec) {
      if (!buffer) return;
      const to = clamp(sec, trim().start, trim().end);
      if (source) {
        stopSource();
        startSource(Math.min(to, trim().end - 0.001));
      } else offset = to;
      setState({ cursor: to });
    },
    getPosition: position,
    setTrim(patch) {
      if (!buffer) return;
      applyMix({ ...state.mix, trim: constrainTrim(trim(), patch, buffer.duration) });
    },
    commit(label) {
      if (history.commit(label, state.mix)) setState({ history: history.labels() });
    },
    undo() {
      restoreFromHistory(history.undo(state.mix));
    },
    redo() {
      restoreFromHistory(history.redo(state.mix));
    },
    setLoop(on) {
      setState({ transport: { ...state.transport, loop: on } });
    },
    setListeningVolume(volume) {
      const v = clamp(volume, 0, 1);
      listeningGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      setState({ transport: { ...state.transport, listeningVolume: v } });
    },
    async mixAudio() {
      return mixAudio();
    },
    setKey(patch) {
      setState({ mix: { ...state.mix, key: { ...state.mix.key, ...patch, detected: false } } });
    },
    useDetectedKey() {
      const found = state.detectedKey;
      if (!found) return;
      setState({ mix: { ...state.mix, key: { ...found, detected: true } } });
    },
    setMixdown(patch) {
      setState({ mix: { ...state.mix, mixdown: { ...state.mix.mixdown, ...patch } } });
    },
    async supportedMixdownFormats() {
      const formats: MixdownFormat[] = ["mp3", "wav"];
      if (await aacSupported(buffer?.sampleRate ?? ctx.sampleRate)) formats.push("aac");
      return formats;
    },
    async exportMixdown(onProgress) {
      if (!buffer || !state.recording) throw new Error("Import a Recording first.");
      const { format, loudness } = state.mix.mixdown;
      const fileName = `${state.recording.name.replace(/\.[^.]+$/, "")}-enhanced.${MIXDOWN_EXTENSION[format]}`;
      onProgress?.(0);
      const mixed = await mixAudio();
      onProgress?.(0.1);
      const channels = [mixed.getChannelData(0).slice(), mixed.getChannelData(1).slice()];
      const worker = new Worker(new URL("./mixdown.worker.ts", import.meta.url), { type: "module" });
      const blob = await runWorker<Blob>(
        worker,
        { channels, sampleRate: mixed.sampleRate, format, loudness },
        channels.map((c) => c.buffer),
        (p) => onProgress?.(0.1 + 0.9 * p),
      ).catch((e: Error) => {
        throw new Error(`Export failed: ${e.message}`);
      });
      onProgress?.(1);
      return { blob, fileName };
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stopSource();
      listeners.clear();
      void ctx.close();
    },
  };
}
