// The Studio engine: the single module the UI talks to.
// It owns the Recording, the Stems, the Mix, and playback (transport).

import { aacSupported } from "./encoders";
import { mixOffline, schedulePlayback, type Layer, type ScheduledPlayback, type Trim } from "./graph";
import { createHistory, type HistoryLabels } from "./history";
import type { DetectedKey, NoteName, Scale } from "./key";
import { MIXDOWN_EXTENSION, type MixdownFormat, type MixdownLoudness } from "./mixdown";
import {
  STEM_NAMES,
  type SeparatedStems,
  type SeparationState,
  type Separator,
  type StemName,
} from "./separation";
import { runWorker } from "./workers";

export type { DetectedKey, HistoryLabels, MixdownFormat, MixdownLoudness, NoteName, Scale, Trim };
export type { SeparationState, Separator, StemName };
export { STEM_NAMES };

/** The Key Pitch Correction snaps to; `detected` is true while it follows the detected Key. */
export interface MixKey {
  root: NoteName;
  scale: Scale;
  detected: boolean;
}

export interface StemSettings {
  /** dB, -24..+12 */
  level: number;
  mute: boolean;
  solo: boolean;
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

/** Every choice that decides how the Mixdown sounds (see CONTEXT.md). All of it is undoable. */
export interface Mix {
  trim: Trim;
  stems: Record<StemName, StemSettings>;
  key: MixKey;
  mixdown: MixdownSettings;
}

/** Listening controls: they never affect the Mixdown. */
export interface Transport {
  loop: boolean;
  /** 0..1 */
  listeningVolume: number;
  /** Compare: hear the untouched Recording ("original") or the Mix ("processed"). */
  ab: "original" | "processed";
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
  separation: SeparationState;
}

export interface StudioOptions {
  /** Defaults to the real in-browser model; tests pass a fast stand-in. */
  separator?: Separator;
}

export interface Studio {
  load(file: File): Promise<void>;
  /** Peak amplitude (0..1) of the Recording in `count` equal time slices, for drawing its waveform. */
  getPeaks(count: number): number[];
  /** Same for one Stem; empty until Separation is done. */
  getStemPeaks(stem: StemName, count: number): number[];
  play(): Promise<void>;
  pause(): void;
  /** Stop playback and return to the Trim start. */
  stop(): void;
  seek(sec: number): void;
  /** Current playback position in seconds. Read it every animation frame; it is not part of the state. */
  getPosition(): number;
  /** Change any part of the Trim; values are kept within the Recording and fades within the kept range. */
  setTrim(patch: Partial<Trim>): void;
  setStem(stem: StemName, patch: Partial<StemSettings>): void;
  setLoop(on: boolean): void;
  setListeningVolume(volume: number): void;
  setAB(mode: Transport["ab"]): void;
  /**
   * End of a user gesture (handle release, slider change, click): records one undo
   * step named `label` if the Mix changed since the last step.
   */
  commit(label: string): void;
  undo(): void;
  redo(): void;
  /** Split the Recording into Stems. Resolves when finished, failed or cancelled (see state.separation). */
  separate(): Promise<void>;
  cancelSeparation(): void;
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
const DEFAULT_STEMS: Record<StemName, StemSettings> = {
  vocals: { level: 0, mute: false, solo: false },
  drums: { level: 0, mute: false, solo: false },
  bass: { level: 0, mute: false, solo: false },
  // Most background noise ends up in "other", so it starts a little lower.
  other: { level: -6, mute: false, solo: false },
};
const sameTrim = (a: Trim, b: Trim) =>
  a.start === b.start && a.end === b.end && a.fadeIn === b.fadeIn && a.fadeOut === b.fadeOut;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Linear gain for each Stem: level, mute, and solo (when any Stem is soloed, only soloed ones play). */
function stemGains(stems: Record<StemName, StemSettings>): Record<StemName, number> {
  const anySolo = STEM_NAMES.some((n) => stems[n].solo);
  const out = {} as Record<StemName, number>;
  for (const n of STEM_NAMES) {
    const s = stems[n];
    out[n] = s.mute || (anySolo && !s.solo) ? 0 : dbToGain(s.level);
  }
  return out;
}

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

/** The real Separator is loaded only when first needed (it pulls in the ML runtime). */
const realSeparator: Separator = async (input, onProgress, signal) => {
  const { demucsSeparator } = await import("./demucs-separator");
  return demucsSeparator(input, onProgress, signal);
};

export function createStudio(options: StudioOptions = {}): Studio {
  const separator = options.separator ?? realSeparator;
  const ctx = new AudioContext();
  const listeningGain = ctx.createGain();
  listeningGain.connect(ctx.destination);

  let state: StudioState = {
    recording: null,
    mix: {
      trim: { start: 0, end: 0, fadeIn: 0, fadeOut: 0 },
      stems: DEFAULT_STEMS,
      key: DEFAULT_KEY,
      mixdown: { format: "mp3", loudness: -14 },
    },
    transport: { loop: false, listeningVolume: 0.8, ab: "processed" },
    playing: false,
    cursor: 0,
    history: { undo: [], redo: [] },
    detectedKey: null,
    keyDetection: "idle",
    separation: { status: "idle" },
  };
  let loadToken = 0;
  listeningGain.gain.value = state.transport.listeningVolume;
  const history = createHistory<Mix>(state.mix);
  let buffer: AudioBuffer | null = null;
  let stems: Record<StemName, AudioBuffer> | null = null;
  let separationAbort: AbortController | null = null;
  const listeners = new Set<(s: StudioState) => void>();

  // Transport: while playing, position = offset + (ctx.currentTime - startedAt).
  let playback: ScheduledPlayback | null = null;
  let offset = 0;
  let startedAt = 0;

  const setState = (patch: Partial<StudioState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };
  const trim = () => state.mix.trim;

  /** The Mix: the four Stems once separated, otherwise the Recording itself. */
  const layers = (): Layer[] => {
    if (!stems) return buffer ? [{ id: "recording", buffer, gain: 1 }] : [];
    const gains = stemGains(state.mix.stems);
    return STEM_NAMES.map((n) => ({ id: n, buffer: stems![n], gain: gains[n] }));
  };
  /** What you hear: the Mix, or the untouched Recording while comparing (A/B "original"). */
  const listeningLayers = (): Layer[] =>
    state.transport.ab === "original" && buffer ? [{ id: "recording", buffer, gain: 1 }] : layers();

  const position = () => {
    if (!buffer) return 0;
    if (!playback) return offset;
    return Math.min(trim().end, offset + (ctx.currentTime - startedAt));
  };

  const stopPlayback = () => {
    playback?.stop();
    playback = null;
  };

  const startPlayback = (from: number) => {
    if (!buffer) return;
    const p = schedulePlayback(ctx, listeningGain, listeningLayers(), trim(), from);
    p.onended = () => {
      if (playback !== p) return;
      playback = null;
      if (state.transport.loop) {
        startPlayback(trim().start);
        setState({ cursor: trim().start });
      } else {
        offset = trim().start;
        setState({ playing: false, cursor: offset });
      }
    };
    offset = from;
    startedAt = ctx.currentTime;
    playback = p;
  };

  /** Restart playback from where it is now, e.g. after the Trim or the set of layers changed. */
  const restartIfPlaying = () => {
    if (!playback) return;
    const at = clamp(position(), trim().start, trim().end - 0.001);
    stopPlayback();
    startPlayback(at);
  };

  /** Push the Mix's Stem gains into the playing graph without restarting. */
  const updateLiveGains = () => {
    if (!playback || !stems || state.transport.ab === "original") return;
    const gains = stemGains(state.mix.stems);
    for (const n of STEM_NAMES) playback.setGain(n, gains[n]);
  };

  /** Apply a new Mix and keep playback consistent with it (only a Trim change needs a restart). */
  const applyMix = (mix: Mix, extra: Partial<StudioState> = {}) => {
    const trimChanged = !sameTrim(mix.trim, state.mix.trim);
    setState({ mix, ...extra });
    updateLiveGains();
    if (!trimChanged) return;
    const t = mix.trim;
    if (playback) restartIfPlaying();
    else if (offset < t.start || offset > t.end) {
      offset = clamp(offset, t.start, t.end);
      setState({ cursor: offset });
    }
  };

  const mixAudio = () => {
    if (!buffer) throw new Error("Import a Recording first.");
    const sampleRate = stems ? stems.vocals.sampleRate : buffer.sampleRate;
    return mixOffline(layers(), trim(), sampleRate);
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

  const toBuffers = (separated: SeparatedStems): Record<StemName, AudioBuffer> => {
    const out = {} as Record<StemName, AudioBuffer>;
    for (const n of STEM_NAMES) {
      const { left, right } = separated[n];
      const b = ctx.createBuffer(2, left.length, separated.sampleRate);
      b.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
      out[n] = b;
    }
    return out;
  };

  return {
    async load(file) {
      let decoded: AudioBuffer;
      try {
        decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      } catch {
        throw new Error(`Couldn't read "${file.name}". Try an M4A, MP3, WAV or OGG audio file.`);
      }
      separationAbort?.abort();
      stopPlayback();
      buffer = decoded;
      stems = null;
      offset = 0;
      const mix: Mix = {
        ...state.mix,
        trim: { start: 0, end: decoded.duration, fadeIn: 0, fadeOut: 0 },
        stems: DEFAULT_STEMS,
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
        separation: { status: "idle" },
      });
      detectKeyInBackground(decoded, ++loadToken);
    },
    getPeaks(count) {
      return buffer ? peaksOf(buffer, count) : [];
    },
    getStemPeaks(stem, count) {
      return stems ? peaksOf(stems[stem], count) : [];
    },
    async play() {
      if (!buffer || playback) return;
      if (ctx.state === "suspended") await ctx.resume();
      const { start, end } = trim();
      startPlayback(offset < start || offset >= end - 0.001 ? start : offset);
      setState({ playing: true, cursor: offset });
    },
    pause() {
      if (!playback) return;
      offset = position();
      stopPlayback();
      setState({ playing: false, cursor: offset });
    },
    stop() {
      stopPlayback();
      offset = trim().start;
      setState({ playing: false, cursor: offset });
    },
    seek(sec) {
      if (!buffer) return;
      const to = clamp(sec, trim().start, trim().end);
      if (playback) {
        stopPlayback();
        startPlayback(Math.min(to, trim().end - 0.001));
      } else offset = to;
      setState({ cursor: to });
    },
    getPosition: position,
    setTrim(patch) {
      if (!buffer) return;
      applyMix({ ...state.mix, trim: constrainTrim(trim(), patch, buffer.duration) });
    },
    setStem(stem, patch) {
      const s = { ...state.mix.stems[stem], ...patch };
      s.level = clamp(s.level, -24, 12);
      applyMix({ ...state.mix, stems: { ...state.mix.stems, [stem]: s } });
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
    async separate() {
      if (!buffer || state.separation.status === "running") return;
      const token = loadToken;
      const abort = new AbortController();
      separationAbort = abort;
      const source = buffer;
      const left = source.getChannelData(0).slice();
      const right = (source.numberOfChannels > 1 ? source.getChannelData(1) : source.getChannelData(0)).slice();
      let separatingSince = 0;
      setState({ separation: { status: "running", phase: "preparing", fraction: 0 } });
      try {
        const separated = await separator(
          { left, right, sampleRate: source.sampleRate },
          ({ phase, fraction }) => {
            if (abort.signal.aborted) return;
            let etaSec: number | undefined;
            if (phase === "separating") {
              separatingSince ||= performance.now();
              const elapsed = (performance.now() - separatingSince) / 1000;
              if (fraction > 0.02) etaSec = (elapsed / fraction) * (1 - fraction);
            }
            setState({ separation: { status: "running", phase, fraction, etaSec } });
          },
          abort.signal,
        );
        if (abort.signal.aborted || token !== loadToken) return;
        stems = toBuffers(separated);
        setState({ separation: { status: "done" } });
        restartIfPlaying(); // switch what's playing to the Stems
      } catch (e) {
        if (token !== loadToken) return;
        if (abort.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          setState({ separation: { status: "idle" } });
          return;
        }
        const reason = e instanceof Error ? e.message : String(e);
        setState({ separation: { status: "error", message: `Separation failed: ${reason}` } });
      } finally {
        if (separationAbort === abort) separationAbort = null;
      }
    },
    cancelSeparation() {
      separationAbort?.abort();
    },
    setLoop(on) {
      setState({ transport: { ...state.transport, loop: on } });
    },
    setListeningVolume(volume) {
      const v = clamp(volume, 0, 1);
      listeningGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      setState({ transport: { ...state.transport, listeningVolume: v } });
    },
    setAB(mode) {
      if (state.transport.ab === mode) return;
      setState({ transport: { ...state.transport, ab: mode } });
      restartIfPlaying();
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
      separationAbort?.abort();
      stopPlayback();
      listeners.clear();
      void ctx.close();
    },
  };
}
