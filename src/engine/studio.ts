// The Studio engine: the single module the UI talks to.
// It owns the Recording, playback (transport) and, in later tickets, the Mix.

export interface RecordingInfo {
  name: string;
  durationSec: number;
}

export interface StudioState {
  recording: RecordingInfo | null;
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
  /** Stop playback and return to the start. */
  stop(): void;
  seek(sec: number): void;
  /** Current playback position in seconds. Read it every animation frame; it is not part of the state. */
  getPosition(): number;
  getState(): StudioState;
  subscribe(listener: (state: StudioState) => void): () => void;
  dispose(): void;
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

export function createStudio(): Studio {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);

  let state: StudioState = { recording: null, playing: false, cursor: 0 };
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

  const position = () => {
    if (!buffer) return 0;
    if (!source) return offset;
    return Math.min(buffer.duration, offset + (ctx.currentTime - startedAt));
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
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.connect(master);
    s.onended = () => {
      if (source !== s) return; // stopped on purpose
      source = null;
      offset = 0;
      setState({ playing: false, cursor: 0 });
    };
    offset = from;
    startedAt = ctx.currentTime;
    source = s;
    s.start(0, from);
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
      setState({ recording: { name: file.name, durationSec: decoded.duration }, playing: false, cursor: 0 });
    },
    getPeaks(count) {
      return buffer ? peaksOf(buffer, count) : [];
    },
    async play() {
      if (!buffer || source) return;
      if (ctx.state === "suspended") await ctx.resume();
      startSource(offset >= buffer.duration ? 0 : offset);
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
      offset = 0;
      setState({ playing: false, cursor: 0 });
    },
    seek(sec) {
      if (!buffer) return;
      const to = Math.max(0, Math.min(buffer.duration, sec));
      if (source) {
        stopSource();
        startSource(to);
      } else offset = to;
      setState({ cursor: to });
    },
    getPosition: position,
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
