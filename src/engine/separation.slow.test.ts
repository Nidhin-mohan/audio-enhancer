// Slow: runs the real HTDemucs model (downloads ~172 MB the first time). `npm run test:slow`.
import { expect, it } from "vitest";
import { demucsSeparator } from "./demucs-separator";
import { STEM_NAMES } from "./separation";

it("the real model splits a clip into four Stems that add back up to the original", async () => {
  // Longer than one model segment (~7.8 s), so segment stitching is exercised too.
  const sr = 44100;
  const n = sr * 10;
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 330 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t));
    let voice = 0;
    for (let h = 1; h <= 6; h++) voice += Math.sin(2 * Math.PI * f * h * t) / h;
    const bass = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-((t % 0.5) * 6));
    left[i] = 0.15 * voice + 0.4 * bass;
  }
  const phases = new Set<string>();
  const stems = await demucsSeparator(
    { left, right: left.slice(), sampleRate: sr },
    (p) => phases.add(p.phase),
    new AbortController().signal,
  );
  expect(phases.has("separating")).toBe(true);

  const energy = (a: Float32Array) => a.reduce((s, v) => s + v * v, 0);
  let residual = 0;
  for (let i = 0; i < n; i++) {
    const sum = STEM_NAMES.reduce((s, k) => s + stems[k].left[i], 0);
    residual += (sum - left[i]) ** 2;
  }
  console.log(
    "Stem energy share:",
    Object.fromEntries(STEM_NAMES.map((k) => [k, (energy(stems[k].left) / energy(left)).toFixed(3)])),
    "residual:",
    (residual / energy(left)).toFixed(3),
  );
  for (const k of STEM_NAMES) expect(stems[k].left.length).toBe(n);
  // The Stems together should reconstruct the input closely (catches stitching/offset/channel-order bugs).
  expect(residual / energy(left)).toBeLessThan(0.1);
});
