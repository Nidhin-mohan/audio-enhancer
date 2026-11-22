// Generated test audio: short, predictable signals encoded as WAV files.

export function sine(freq: number, seconds: number, sampleRate = 44100, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** Encode mono or multi-channel float samples as a 16-bit PCM WAV file. */
export function wavFile(channels: Float32Array[], sampleRate = 44100, name = "test.wav"): File {
  const n = channels[0].length;
  const nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * nc * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new File([buf], name, { type: "audio/wav" });
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The audio device can take a moment to start (especially with tests running in
 * parallel), and the playback clock only runs once it has. Play until the clock
 * moves, then stop, so timing-based assertions measure playback, not device start-up.
 */
export async function warmUp(s: {
  play(): Promise<void>;
  stop(): void;
  getPosition(): number;
}) {
  await s.play();
  const startedAt = Date.now();
  while (s.getPosition() === 0 || s.getPosition() < 0.005) {
    if (Date.now() - startedAt > 5000) throw new Error("Audio clock never started");
    await wait(10);
  }
  s.stop();
}
