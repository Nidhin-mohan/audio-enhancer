// Builds the audio path for the Recording. The same function feeds live playback
// (AudioContext) and offline mixing (OfflineAudioContext), so what you hear is
// what ends up in the Mixdown.

export interface Trim {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
}

/** Linear fade gain at time t (seconds into the Recording). */
export function fadeGainAt(t: number, trim: Trim): number {
  let g = 1;
  if (trim.fadeIn > 0 && t < trim.start + trim.fadeIn) g = Math.min(g, (t - trim.start) / trim.fadeIn);
  if (trim.fadeOut > 0 && t > trim.end - trim.fadeOut) g = Math.min(g, (trim.end - t) / trim.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/**
 * Schedule the Recording from `from` (seconds) to the Trim end, starting now on `ctx`.
 * Returns the source node, whose `onended` fires when the Trim end is reached.
 */
export function scheduleRecording(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  trim: Trim,
  from: number,
): AudioBufferSourceNode {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const fade = ctx.createGain();
  source.connect(fade).connect(destination);

  // Fade envelope: piecewise linear between these breakpoints.
  const points = [from, trim.start + trim.fadeIn, trim.end - trim.fadeOut, trim.end]
    .filter((t) => t >= from && t <= trim.end)
    .sort((a, b) => a - b);
  fade.gain.setValueAtTime(fadeGainAt(from, trim), now);
  for (const t of points.slice(1)) fade.gain.linearRampToValueAtTime(fadeGainAt(t, trim), now + (t - from));

  source.start(now, from, Math.max(0, trim.end - from));
  return source;
}

/** Produce the kept range of the Recording offline, in stereo (a mono Recording plays in both channels). */
export async function mixOffline(buffer: AudioBuffer, trim: Trim): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((trim.end - trim.start) * buffer.sampleRate));
  const ctx = new OfflineAudioContext(2, length, buffer.sampleRate);
  scheduleRecording(ctx, ctx.destination, buffer, trim, trim.start);
  return ctx.startRendering();
}
