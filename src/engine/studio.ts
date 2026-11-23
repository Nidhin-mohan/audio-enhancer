// The Studio engine: the single module the UI talks to.
// It owns the Recording, the Stems, the Mix, and playback (transport).

import { aacSupported } from "./encoders";
import { mixOffline, schedulePlayback, type Layer, type ScheduledPlayback, type Trim } from "./graph";
import { createHistory, type HistoryLabels } from "./history";
import type { DetectedKey, NoteName, Scale } from "./key";
import { integratedLoudness } from "./loudness";
import { pitchPicture, type PitchPicture, type PitchSettings } from "./pitch";
import {
  BUILT_IN_PRESETS,
  defaultStorage,
  loadSavedPresets,
  storeSavedPresets,
  type PitchPreset,
  type PresetStorage,
} from "./presets";
import { vocalChainActive, type NoiseReductionSettings, type VocalChain } from "./vocal-processing";
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
export type { SeparationState, Separator, StemName, PitchPicture, PitchSettings, PitchPreset, PresetStorage };
export { STEM_NAMES };
export { NOTES } from "./key";
export { SCALE_DEGREES } from "./pitch";

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

export type { NoiseReductionSettings };

export interface PitchCorrectionSettings {
  enabled: boolean;
  /** Name of the Preset the settings came from. */
  preset: string;
  /** True once any control was changed since choosing the Preset (shown as "Custom"). */
  modified: boolean;
  key: MixKey;
  settings: PitchSettings;
}

export interface VocalBoostSettings {
  /** While true, `db` follows the suggested level worked out from the Stems. */
  auto: boolean;
  /** -12..+12 */
  db: number;
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
  noiseReduction: NoiseReductionSettings;
  vocalBoost: VocalBoostSettings;
  pitchCorrection: PitchCorrectionSettings;
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
  /** True while the vocals' effects (Noise Reduction, Pitch Correction) are being recalculated. */
  processingVocals: boolean;
  /** Tracking the sung pitch of the vocals Stem for the pitch picture (starts after Separation). */
  pitchTrack: "idle" | "tracking" | "ready";
  /** Built-in Pitch Correction Presets followed by the user's saved ones. */
  pitchPresets: PitchPreset[];
  /** False when browser storage is blocked: saved Presets then last only for this session. */
  presetStorageAvailable: boolean;
}

export interface StudioOptions {
  /** Defaults to the real in-browser model; tests pass a fast stand-in. */
  separator?: Separator;
  /** Where saved Pitch Correction Presets live; defaults to localStorage. */
  storage?: PresetStorage | null;
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
  setNoiseReduction(patch: Partial<NoiseReductionSettings>): void;
  /** A manual `db` turns Auto off; `{ auto: true }` goes back to the suggested level. */
  setVocalBoost(patch: Partial<VocalBoostSettings>): void;
  /** Switch on/off and/or change controls; changing a control makes the Preset "Custom". */
  setPitchCorrection(patch: Partial<PitchSettings> & { enabled?: boolean }): void;
  applyPitchPreset(name: string): void;
  /** Back to the values of the Preset the current settings are based on. */
  resetPitchPreset(): void;
  /** Save the current settings as the user's own Preset (not an undo step). */
  savePitchPreset(name: string): void;
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
  /** Sung vs corrected pitch for the current Pitch Correction settings; null until `pitchTrack` is "ready". */
  getPitchPicture(): PitchPicture | null;
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
const DEFAULT_NOISE_REDUCTION: NoiseReductionSettings = { enabled: true, amount: 60 };
const DEFAULT_VOCAL_BOOST: VocalBoostSettings = { auto: true, db: 0 };
const DEFAULT_PITCH: PitchCorrectionSettings = {
  enabled: true,
  preset: "Natural",
  modified: false,
  key: DEFAULT_KEY,
  settings: BUILT_IN_PRESETS[0].settings,
};
const PITCH_LIMITS: Record<keyof PitchSettings, [number, number] | null> = {
  retuneMs: [0, 400],
  humanize: [0, 100],
  amount: [0, 100],
  vibrato: [0, 100],
  mix: [0, 100],
  formant: null,
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
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const saved = loadSavedPresets(storage);
  let savedPresets = saved.presets;
  const allPresets = () => [...BUILT_IN_PRESETS, ...savedPresets];
  const ctx = new AudioContext();
  const listeningGain = ctx.createGain();
  listeningGain.connect(ctx.destination);

  let state: StudioState = {
    recording: null,
    mix: {
      trim: { start: 0, end: 0, fadeIn: 0, fadeOut: 0 },
      stems: DEFAULT_STEMS,
      noiseReduction: DEFAULT_NOISE_REDUCTION,
      vocalBoost: DEFAULT_VOCAL_BOOST,
      pitchCorrection: DEFAULT_PITCH,
      mixdown: { format: "mp3", loudness: -14 },
    },
    transport: { loop: false, listeningVolume: 0.8, ab: "processed" },
    playing: false,
    cursor: 0,
    history: { undo: [], redo: [] },
    detectedKey: null,
    keyDetection: "idle",
    separation: { status: "idle" },
    processingVocals: false,
    pitchTrack: "idle",
    pitchPresets: allPresets(),
    presetStorageAvailable: saved.available,
  };
  let loadToken = 0;
  /** The vocals after their effects chain, for the settings in `key`. */
  let processedVocals: { key: string; buffer: AudioBuffer } | null = null;
  type Waiter = { resolve: () => void; reject: (e: Error) => void };
  let vocalJob: { key: string; worker: Worker; waiters: Waiter[] } | null = null;
  let vocalTimer = 0;
  let suggestedBoostDb = 0;
  /** Sung pitch of the vocals Stem per analysis frame, for the pitch picture. */
  let vocalsPitch: { f0: Float32Array; sampleRate: number } | null = null;
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

  /** Linear gain per Stem layer, including Vocal Boost on the vocals. */
  const layerGains = (mix: Mix) => {
    const g = stemGains(mix.stems);
    g.vocals *= dbToGain(mix.vocalBoost.db);
    return g;
  };

  // ---- Vocal effects chain (Noise Reduction, Pitch Correction): recalculated in a worker ----
  const vocalSettings = (mix: Mix): VocalChain => {
    const pc = mix.pitchCorrection;
    return {
      noiseReduction: mix.noiseReduction,
      pitch: pc.enabled ? { root: pc.key.root, scale: pc.key.scale, settings: pc.settings } : null,
    };
  };
  const vocalKey = (mix: Mix) => JSON.stringify(vocalSettings(mix));
  /** The vocals buffer to play now: processed if ready for the current settings, otherwise the best available. */
  const vocalsBuffer = (): AudioBuffer => {
    if (!vocalChainActive(vocalSettings(state.mix))) return stems!.vocals;
    return processedVocals?.buffer ?? stems!.vocals;
  };
  /**
   * Make sure the processed vocals match the current settings. Resolves once they do,
   * even if the settings change again meanwhile: a superseded job hands its waiters
   * on to the job that replaces it, so nobody is left waiting forever.
   */
  const ensureVocals = (): Promise<void> => {
    if (!stems) return Promise.resolve();
    const settings = vocalSettings(state.mix);
    const key = vocalKey(state.mix);
    const waitForJob = () => new Promise<void>((resolve, reject) => vocalJob!.waiters.push({ resolve, reject }));
    if (!vocalChainActive(settings) || processedVocals?.key === key) {
      // Nothing to calculate any more: release anyone waiting on a now-pointless job.
      if (vocalJob) {
        vocalJob.worker.terminate();
        vocalJob.waiters.forEach((w) => w.resolve());
        vocalJob = null;
        setState({ processingVocals: false });
      }
      return Promise.resolve();
    }
    if (vocalJob?.key === key) return waitForJob();

    // Start a job for the current settings; anyone waiting on an older job now waits on this one.
    const inherited = vocalJob?.waiters ?? [];
    vocalJob?.worker.terminate();
    const raw = stems.vocals;
    const channels = [raw.getChannelData(0).slice(), raw.getChannelData(1).slice()];
    const worker = new Worker(new URL("./vocals.worker.ts", import.meta.url), { type: "module" });
    const token = loadToken;
    const job = { key, worker, waiters: inherited };
    vocalJob = job;
    setState({ processingVocals: true });
    runWorker<Float32Array[]>(worker, { channels, sampleRate: raw.sampleRate, ...settings }, channels.map((c) => c.buffer)).then(
      (out) => {
        if (token !== loadToken || vocalJob !== job) return; // superseded: its waiters moved on
        const b = ctx.createBuffer(2, out[0].length, raw.sampleRate);
        b.copyToChannel(out[0] as Float32Array<ArrayBuffer>, 0);
        b.copyToChannel(out[1] as Float32Array<ArrayBuffer>, 1);
        processedVocals = { key, buffer: b };
        vocalJob = null;
        setState({ processingVocals: false });
        job.waiters.forEach((w) => w.resolve());
        restartIfPlaying(); // hear the new vocals straight away
      },
      (err: Error) => {
        if (vocalJob !== job) return;
        vocalJob = null;
        setState({ processingVocals: false });
        job.waiters.forEach((w) => w.reject(new Error(`Vocal effects failed: ${err.message}`)));
      },
    );
    return waitForJob();
  };
  /** Recalculate the vocals shortly after the last settings change (sliders move many times per second). */
  const scheduleVocals = () => {
    clearTimeout(vocalTimer);
    vocalTimer = window.setTimeout(() => void ensureVocals(), 200);
  };

  /** The Mix: the four Stems once separated, otherwise the Recording itself. */
  const layers = (): Layer[] => {
    if (!stems) return buffer ? [{ id: "recording", buffer, gain: 1 }] : [];
    const gains = layerGains(state.mix);
    return STEM_NAMES.map((n) => ({ id: n, buffer: n === "vocals" ? vocalsBuffer() : stems![n], gain: gains[n] }));
  };

  /** Vocal Boost that brings the vocals level with the rest of the Mix (never a cut). */
  const suggestBoost = (s: Record<StemName, AudioBuffer>): number => {
    const loud = (b: AudioBuffer) => integratedLoudness([b.getChannelData(0), b.getChannelData(1)], b.sampleRate);
    const gains = stemGains(DEFAULT_STEMS);
    const n = s.vocals.length;
    const backing = [new Float32Array(n), new Float32Array(n)];
    for (const name of ["drums", "bass", "other"] as const)
      for (let c = 0; c < 2; c++) {
        const d = s[name].getChannelData(c);
        for (let i = 0; i < n; i++) backing[c][i] += d[i] * gains[name];
      }
    const vocals = loud(s.vocals);
    const rest = integratedLoudness(backing, s.vocals.sampleRate);
    if (!Number.isFinite(vocals) || !Number.isFinite(rest)) return 0;
    return clamp(Math.round((rest - vocals) * 2) / 2, 0, 12);
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
    const gains = layerGains(state.mix);
    for (const n of STEM_NAMES) playback.setGain(n, gains[n]);
  };

  /** Apply a new Mix and keep playback consistent with it (only a Trim change needs a restart). */
  const applyMix = (mix: Mix, extra: Partial<StudioState> = {}) => {
    const trimChanged = !sameTrim(mix.trim, state.mix.trim);
    const vocalsChanged = vocalKey(mix) !== vocalKey(state.mix);
    setState({ mix, ...extra });
    updateLiveGains();
    if (vocalsChanged) scheduleVocals();
    if (!trimChanged) return;
    const t = mix.trim;
    if (playback) restartIfPlaying();
    else if (offset < t.start || offset > t.end) {
      offset = clamp(offset, t.start, t.end);
      setState({ cursor: offset });
    }
  };

  const mixAudio = async () => {
    if (!buffer) throw new Error("Import a Recording first.");
    await ensureVocals();
    const sampleRate = stems ? stems.vocals.sampleRate : buffer.sampleRate;
    return mixOffline(layers(), trim(), sampleRate);
  };

  const applyPreset = (name: string) => {
    const preset = allPresets().find((p) => p.name === name);
    if (!preset) return;
    const pc = state.mix.pitchCorrection;
    applyMix({ ...state.mix, pitchCorrection: { ...pc, preset: name, modified: false, settings: { ...preset.settings } } });
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
        const adopt = (mix: Mix): Mix =>
          mix.pitchCorrection.key.detected
            ? { ...mix, pitchCorrection: { ...mix.pitchCorrection, key: { ...found, detected: true } } }
            : mix;
        history.rewrite(adopt);
        setState({ detectedKey: found, keyDetection: "found", mix: adopt(state.mix), history: history.labels() });
        scheduleVocals(); // Pitch Correction now snaps to the real Key
      });
  };

  /** Track the vocals' sung pitch once in a worker; settings changes only redo the cheap correction curve. */
  const trackVocalsInBackground = (vocals: AudioBuffer, token: number) => {
    const mono = new Float32Array(vocals.length);
    for (let c = 0; c < vocals.numberOfChannels; c++) {
      const data = vocals.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / vocals.numberOfChannels;
    }
    setState({ pitchTrack: "tracking" });
    const worker = new Worker(new URL("./pitch-track.worker.ts", import.meta.url), { type: "module" });
    runWorker<Float32Array>(worker, { mono, sampleRate: vocals.sampleRate }, [mono.buffer])
      .then((f0) => {
        if (token !== loadToken) return;
        vocalsPitch = { f0, sampleRate: vocals.sampleRate };
        setState({ pitchTrack: "ready" });
      })
      .catch(() => token === loadToken && setState({ pitchTrack: "idle" }));
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
      vocalJob?.worker.terminate();
      vocalJob?.waiters.forEach((w) => w.resolve()); // their Stems are gone; nothing left to wait for
      vocalJob = null;
      processedVocals = null;
      vocalsPitch = null;
      buffer = decoded;
      stems = null;
      offset = 0;
      const mix: Mix = {
        ...state.mix,
        trim: { start: 0, end: decoded.duration, fadeIn: 0, fadeOut: 0 },
        stems: DEFAULT_STEMS,
        noiseReduction: DEFAULT_NOISE_REDUCTION,
        vocalBoost: DEFAULT_VOCAL_BOOST,
        pitchCorrection: { ...DEFAULT_PITCH, key: DEFAULT_KEY },
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
        processingVocals: false,
        pitchTrack: "idle",
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
    setNoiseReduction(patch) {
      const nr = { ...state.mix.noiseReduction, ...patch };
      nr.amount = clamp(Math.round(nr.amount), 0, 100);
      applyMix({ ...state.mix, noiseReduction: nr });
    },
    setVocalBoost(patch) {
      const vb: VocalBoostSettings =
        patch.auto === true
          ? { auto: true, db: suggestedBoostDb }
          : patch.db !== undefined
            ? { auto: false, db: clamp(patch.db, -12, 12) }
            : { ...state.mix.vocalBoost, ...patch };
      applyMix({ ...state.mix, vocalBoost: vb });
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
        suggestedBoostDb = suggestBoost(stems);
        const adopt = (mix: Mix): Mix =>
          mix.vocalBoost.auto ? { ...mix, vocalBoost: { auto: true, db: suggestedBoostDb } } : mix;
        history.rewrite(adopt);
        setState({ separation: { status: "done" }, mix: adopt(state.mix), history: history.labels() });
        restartIfPlaying(); // switch what's playing to the Stems
        void ensureVocals(); // apply the default vocal effects
        trackVocalsInBackground(stems.vocals, token);
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
      const pc = state.mix.pitchCorrection;
      applyMix({ ...state.mix, pitchCorrection: { ...pc, key: { ...pc.key, ...patch, detected: false } } });
    },
    useDetectedKey() {
      const found = state.detectedKey;
      if (!found) return;
      const pc = state.mix.pitchCorrection;
      applyMix({ ...state.mix, pitchCorrection: { ...pc, key: { ...found, detected: true } } });
    },
    getPitchPicture() {
      if (!vocalsPitch) return null;
      const pc = state.mix.pitchCorrection;
      const job = pc.enabled ? { root: pc.key.root, scale: pc.key.scale, settings: pc.settings } : null;
      return pitchPicture(vocalsPitch.f0, vocalsPitch.sampleRate, job);
    },
    setPitchCorrection(patch) {
      const { enabled, ...controls } = patch;
      const pc = state.mix.pitchCorrection;
      const settings = { ...pc.settings };
      let changed = false;
      for (const [k, v] of Object.entries(controls) as [keyof PitchSettings, number | boolean][]) {
        const limits = PITCH_LIMITS[k];
        const value = limits && typeof v === "number" ? clamp(v, limits[0], limits[1]) : v;
        if (settings[k] !== value) (settings as Record<string, unknown>)[k] = value, (changed = true);
      }
      applyMix({
        ...state.mix,
        pitchCorrection: { ...pc, enabled: enabled ?? pc.enabled, settings, modified: pc.modified || changed },
      });
    },
    applyPitchPreset(name) {
      applyPreset(name);
    },
    resetPitchPreset() {
      applyPreset(state.mix.pitchCorrection.preset);
    },
    savePitchPreset(rawName) {
      const name = rawName.trim();
      if (!name) return;
      const settings = { ...state.mix.pitchCorrection.settings };
      const builtIn = BUILT_IN_PRESETS.some((p) => p.name === name);
      const finalName = builtIn ? `${name} (mine)` : name;
      savedPresets = [...savedPresets.filter((p) => p.name !== finalName), { name: finalName, settings, builtIn: false }];
      const stored = storeSavedPresets(storage, savedPresets);
      // The Mix now simply follows the new Preset; history is told so this isn't an undo step.
      const pc = state.mix.pitchCorrection;
      const mix = { ...state.mix, pitchCorrection: { ...pc, preset: finalName, modified: false } };
      history.rewrite((m) =>
        JSON.stringify(m.pitchCorrection.settings) === JSON.stringify(settings)
          ? { ...m, pitchCorrection: { ...m.pitchCorrection, preset: finalName, modified: false } }
          : m,
      );
      setState({
        mix,
        pitchPresets: allPresets(),
        presetStorageAvailable: state.presetStorageAvailable && stored,
        history: history.labels(),
      });
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
      clearTimeout(vocalTimer);
      vocalJob?.worker.terminate();
      stopPlayback();
      listeners.clear();
      void ctx.close();
    },
  };
}
