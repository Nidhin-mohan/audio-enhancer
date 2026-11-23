import { useEffect, useMemo, useRef } from "react";
import { NOTES, SCALE_DEGREES, type PitchPicture as Picture, type Studio, type StudioState } from "../engine/studio";

const HEIGHT = 132;
const MIN_SPAN = 12; // semitones shown at least (one octave)
const PAD = 2;

/** Sung (grey) vs corrected (accent) pitch over the Trim, on the Key's note grid. */
export function PitchPicture({ studio, state }: { studio: Studio; state: StudioState }) {
  const pc = state.mix.pitchCorrection;
  const picture = useMemo(
    () => studio.getPitchPicture(),
    // Recalculated whenever the pitch track arrives or any Pitch Correction setting or the Key changes.
    [studio, state.pitchTrack, pc],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const { start, end } = state.mix.trim;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !picture) return;
    const draw = () => paint(el, picture, start, end, pc.key.root, SCALE_DEGREES[pc.key.scale]);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [picture, start, end, pc.key.root, pc.key.scale]);

  if (state.pitchTrack === "tracking") return <div className="pitch-picture empty">Reading the notes you sang…</div>;
  if (!picture) return null;
  if (!picture.sung.some((v) => !Number.isNaN(v)))
    return <div className="pitch-picture empty">No singing found in the vocals Stem, so there's nothing to correct.</div>;
  return (
    <figure className="pitch-picture">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Pitch picture: sung notes in grey, corrected notes in purple, on the ${pc.key.root} ${pc.key.scale} grid`}
      />
      <figcaption>
        <span className="lg sung" /> Sung <span className="lg corrected" /> {pc.enabled ? "Corrected" : "Corrected (off)"}
      </figcaption>
    </figure>
  );
}

function paint(el: HTMLCanvasElement, pic: Picture, start: number, end: number, root: string, degrees: number[]) {
  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth;
  el.width = Math.round(w * dpr);
  el.height = Math.round(HEIGHT * dpr);
  const g = el.getContext("2d");
  if (!g || w === 0) return;
  g.scale(dpr, dpr);
  const css = getComputedStyle(el);
  const color = (name: string) => css.getPropertyValue(name).trim();

  const first = Math.max(0, Math.floor(start / pic.frameSec));
  const last = Math.min(pic.sung.length - 1, Math.ceil(end / pic.frameSec));
  let lo = Infinity, hi = -Infinity;
  for (let i = first; i <= last; i++) {
    for (const v of [pic.sung[i], pic.corrected[i]]) {
      if (Number.isNaN(v)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (lo === Infinity) (lo = 57), (hi = 69); // nothing sung in the Trim: show A3–A4
  const mid = (lo + hi) / 2;
  const span = Math.max(MIN_SPAN, hi - lo + 2 * PAD);
  const bottom = Math.floor(mid - span / 2), top = Math.ceil(mid + span / 2);
  const y = (midi: number) => HEIGHT - ((midi - bottom) / (top - bottom)) * HEIGHT;
  const x = (frame: number) => ((frame * pic.frameSec - start) / (end - start)) * w;

  // Key grid: a line for every note of the Key, brighter for the root. Names go top-down,
  // skipping any that would overlap the one above (roots always get theirs).
  const rootPc = NOTES.indexOf(root as (typeof NOTES)[number]);
  const LABEL_GAP = 12;
  g.font = `10px ${css.fontFamily}`;
  g.textBaseline = "middle";
  let lastLabelY = -Infinity;
  for (let m = top; m >= bottom; m--) {
    const degree = (((m - rootPc) % 12) + 12) % 12;
    if (!degrees.includes(degree)) continue;
    const isRoot = degree === 0;
    const lineY = Math.round(y(m));
    g.fillStyle = color(isRoot ? "--line2" : "--line");
    g.fillRect(0, lineY, w, 1);
    const labelY = lineY - 6;
    if (labelY < 6 || (labelY - lastLabelY < LABEL_GAP && !isRoot)) continue;
    g.fillStyle = color(isRoot ? "--muted" : "--dim");
    g.fillText(`${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`, 4, labelY);
    lastLabelY = labelY;
  }

  const line = (values: Float32Array, stroke: string, width: number) => {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.lineJoin = "round";
    g.beginPath();
    let pen = false;
    for (let i = first; i <= last; i++) {
      const v = values[i];
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(x(i), y(v));
      else g.moveTo(x(i), y(v));
      pen = true;
    }
    g.stroke();
  };
  line(pic.sung, color("--muted"), 1.5);
  line(pic.corrected, color("--accent"), 2);
}
