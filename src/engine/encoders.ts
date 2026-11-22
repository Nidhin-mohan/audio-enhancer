// Encoders for the Mixdown. All run inside a worker as well as on the main thread.

import { Mp3Encoder } from "@breezystack/lamejs";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export type Progress = (fraction: number) => void;

/** Float sample (-1..1) to 16-bit PCM, clipping out-of-range values. */
const pcm16 = (v: number) => {
  const s = Math.max(-1, Math.min(1, v));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
};

const toInt16 = (c: Float32Array, from: number, to: number) => {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) out[i - from] = pcm16(c[i]);
  return out;
};

export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const n = channels[0].length;
  const nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
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
  const pcm = new Int16Array(buf, 44);
  for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < nc; c++) pcm[o++] = pcm16(channels[c][i]);
  return new Blob([buf], { type: "audio/wav" });
}

export function encodeMp3(channels: Float32Array[], sampleRate: number, onProgress?: Progress): Blob {
  const [left, right = left] = channels;
  const encoder = new Mp3Encoder(2, sampleRate, 320);
  const parts: Uint8Array[] = [];
  const block = 1152 * 20;
  for (let i = 0; i < left.length; i += block) {
    const end = Math.min(left.length, i + block);
    const data = encoder.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end));
    if (data.length) parts.push(new Uint8Array(data));
    onProgress?.(end / left.length);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}

const aacConfig = (sampleRate: number, numberOfChannels: number): AudioEncoderConfig => ({
  codec: "mp4a.40.2",
  sampleRate,
  numberOfChannels,
  bitrate: 256_000,
});

export async function aacSupported(sampleRate = 48000): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    return !!(await AudioEncoder.isConfigSupported(aacConfig(sampleRate, 2))).supported;
  } catch {
    return false;
  }
}

/** AAC in an MP4 (.m4a) container, using the browser's built-in encoder (WebCodecs). */
export async function encodeAac(channels: Float32Array[], sampleRate: number, onProgress?: Progress): Promise<Blob> {
  const nc = channels.length;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    audio: { codec: "aac", sampleRate, numberOfChannels: nc },
    fastStart: "in-memory",
  });
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure(aacConfig(sampleRate, nc));

  const n = channels[0].length;
  const block = 1024 * 16;
  for (let i = 0; i < n; i += block) {
    const frames = Math.min(block, n - i);
    const planar = new Float32Array(frames * nc);
    for (let c = 0; c < nc; c++) planar.set(channels[c].subarray(i, i + frames), c * frames);
    const data = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: nc,
      timestamp: Math.round((i / sampleRate) * 1e6),
      data: planar,
    });
    encoder.encode(data);
    data.close();
    onProgress?.((i + frames) / n);
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  return new Blob([target.buffer], { type: "audio/mp4" });
}
