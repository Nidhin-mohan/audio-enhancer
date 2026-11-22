// The Studio engine: the single module the UI talks to.
// It owns the Recording, the Mix, and playback (transport).

import { renderRecording, scheduleRecording, type Trim } from "./graph";

export type { Trim };

export interface RecordingInfo {
  name: string;
  durationSec: number;
}

/** The user's choices that decide how the Mixdown sounds. */
export interface Mix {
  trim: Trim;
}

/** Listening controls: they never affect the Mixdown. */
export interface Transport {
  loop: boolean;
  /** 0..1 */
  masterVolume: number;
}

export interface StudioState {
  recording: RecordingInfo | null;
  mix: Mix;
  transport: Transport;
  playing: boolean;
  /** Where playback last started or will resume from (seconds). Changes on seek/pause/stop, not every frame. */
  cursor: number;
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
  setMasterVolume(volume: number): void;
  /** Render what the Mix sounds like over the Trim range (the basis of the Mixdown). */
  render(): Promise<AudioBuffer>;
  getState(): StudioState;
  subscribe(listener: (state: StudioState) => void): () => void;
  dispose(): void;
}

const MIN_KEPT_SEC = 0.05;
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
  const master = ctx.createGain();
  master.connect(ctx.destination);

  let state: StudioState = {
    recording: null,
    mix: { trim: { start: 0, end: 0, fadeIn: 0, fadeOut: 0 } },
    transport: { loop: false, masterVolume: 0.8 },
    playing: false,
    cursor: 0,
  };
  master.gain.value = state.transport.masterVolume;
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
    const s = scheduleRecording(ctx, master, buffer, trim(), from);
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
      setState({
        recording: { name: file.name, durationSec: decoded.duration },
        mix: { ...state.mix, trim: { start: 0, end: decoded.duration, fadeIn: 0, fadeOut: 0 } },
        playing: false,
        cursor: 0,
      });
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
      const next = constrainTrim(trim(), patch, buffer.duration);
      setState({ mix: { ...state.mix, trim: next } });
      if (source) restartIfPlaying();
      else if (offset < next.start || offset > next.end) {
        offset = clamp(offset, next.start, next.end);
        setState({ cursor: offset });
      }
    },
    setLoop(on) {
      setState({ transport: { ...state.transport, loop: on } });
    },
    setMasterVolume(volume) {
      const v = clamp(volume, 0, 1);
      master.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      setState({ transport: { ...state.transport, masterVolume: v } });
    },
    async render() {
      if (!buffer) throw new Error("Import a Recording first.");
      return renderRecording(buffer, trim());
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
