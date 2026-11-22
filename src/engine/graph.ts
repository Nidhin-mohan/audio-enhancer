// Builds the audio path for playback. The same function feeds live playback
// (AudioContext) and offline mixing (OfflineAudioContext), so what you hear is
// what ends up in the Mixdown.
//
//   layer source → layer gain ┐
//   layer source → layer gain ┼→ fade gain → destination
//   …                         ┘

export interface Trim {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
}

/** One thing to play: the Recording itself, or one Stem, at a linear gain. */
export interface Layer {
  id: string;
  buffer: AudioBuffer;
  gain: number;
}

export interface ScheduledPlayback {
  /** Fires once when the Trim end is reached (not when stopped). */
  onended: (() => void) | null;
  /** Change a layer's gain while it plays (smoothly, no restart). */
  setGain(id: string, gain: number): void;
  stop(): void;
}

/** Linear fade gain at time t (seconds into the Recording). */
export function fadeGainAt(t: number, trim: Trim): number {
  let g = 1;
  if (trim.fadeIn > 0 && t < trim.start + trim.fadeIn) g = Math.min(g, (t - trim.start) / trim.fadeIn);
  if (trim.fadeOut > 0 && t > trim.end - trim.fadeOut) g = Math.min(g, (trim.end - t) / trim.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/** Play `layers` from `from` (seconds) to the Trim end, starting now on `ctx`. */
export function schedulePlayback(
  ctx: BaseAudioContext,
  destination: AudioNode,
  layers: Layer[],
  trim: Trim,
  from: number,
): ScheduledPlayback {
  const now = ctx.currentTime;
  const fade = ctx.createGain();
  fade.connect(destination);

  // Fade envelope: piecewise linear between these breakpoints.
  const points = [from, trim.start + trim.fadeIn, trim.end - trim.fadeOut, trim.end]
    .filter((t) => t >= from && t <= trim.end)
    .sort((a, b) => a - b);
  fade.gain.setValueAtTime(fadeGainAt(from, trim), now);
  for (const t of points.slice(1)) fade.gain.linearRampToValueAtTime(fadeGainAt(t, trim), now + (t - from));

  const duration = Math.max(0, trim.end - from);
  const gains = new Map<string, GainNode>();
  const sources = layers.map((layer) => {
    const source = ctx.createBufferSource();
    source.buffer = layer.buffer;
    const gain = ctx.createGain();
    gain.gain.value = layer.gain;
    source.connect(gain).connect(fade);
    gains.set(layer.id, gain);
    source.start(now, from, duration);
    return source;
  });

  let stopped = false;
  const playback: ScheduledPlayback = {
    onended: null,
    setGain(id, value) {
      const g = gains.get(id);
      if (g && ctx instanceof AudioContext) g.gain.setTargetAtTime(value, ctx.currentTime, 0.015);
      else if (g) g.gain.value = value;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const s of sources) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
        s.disconnect();
      }
      fade.disconnect();
    },
  };
  // All layers share the same start and duration; the first one ending means the Trim end was reached.
  if (sources[0])
    sources[0].onended = () => {
      if (stopped) return;
      stopped = true;
      playback.onended?.();
    };
  return playback;
}

/** Mix `layers` offline over the Trim range, in stereo (a mono layer plays in both channels). */
export async function mixOffline(layers: Layer[], trim: Trim, sampleRate: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((trim.end - trim.start) * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  schedulePlayback(ctx, ctx.destination, layers, trim, trim.start);
  return ctx.startRendering();
}
