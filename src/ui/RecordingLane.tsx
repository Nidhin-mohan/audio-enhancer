import { useRef } from "react";
import type { Studio, Trim } from "../engine/studio";
import { fmtShort } from "./useStudio";
import { Waveform } from "./Waveform";

type Handle = "start" | "end" | "fadeIn" | "fadeOut";

interface Props {
  studio: Studio;
  peaks: number[];
  duration: number;
  position: number;
  trim: Trim;
  /** Called when a handle drag ends (one gesture). */
  onGestureEnd?: (handle: Handle) => void;
}

/** The Recording's waveform with ruler, playhead, and draggable Trim and fade handles. */
export function RecordingLane({ studio, peaks, duration, position, trim, onGestureEnd }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const pct = (t: number) => `${(t / duration) * 100}%`;

  const step = duration > 120 ? 30 : duration > 40 ? 10 : duration > 10 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);

  const dragHandle = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = timeAt(ev.clientX);
      const cur = studio.getState().mix.trim;
      if (handle === "start") studio.setTrim({ start: Math.min(t, cur.end - 0.05) });
      else if (handle === "end") studio.setTrim({ end: Math.max(t, cur.start + 0.05) });
      else if (handle === "fadeIn") studio.setTrim({ fadeIn: Math.max(0, t - cur.start) });
      else studio.setTrim({ fadeOut: Math.max(0, cur.end - t) });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onGestureEnd?.(handle);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const seek = (e: React.PointerEvent) => studio.seek(timeAt(e.clientX));
  const x = (t: number) => (t / duration) * 1000; // SVG units

  return (
    <div className="lane">
      <div className="ruler" onPointerDown={seek}>
        {ticks.map((t) => (
          <span key={t}>
            <span className="tk" style={{ left: pct(t) }} />
            <span className="tl num" style={{ left: pct(t) }}>{fmtShort(t)}</span>
          </span>
        ))}
      </div>
      <div
        ref={box}
        className="wavebox"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e);
        }}
        onPointerMove={(e) => {
          // Handle drags bubble up here too; only scrub when the waveform itself was grabbed.
          if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId)) seek(e);
        }}
      >
        <Waveform peaks={peaks} color="#9aa3b2" />
        <div className="shade" style={{ left: 0, width: pct(trim.start) }} />
        <div className="shade" style={{ left: pct(trim.end), right: 0 }} />
        <svg className="fades" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {trim.fadeIn > 0 && (
            <polyline points={`${x(trim.start)},100 ${x(trim.start + trim.fadeIn)},0`} />
          )}
          {trim.fadeOut > 0 && <polyline points={`${x(trim.end - trim.fadeOut)},0 ${x(trim.end)},100`} />}
        </svg>
        <div
          className="h trim l"
          role="slider"
          aria-label="Trim start"
          aria-valuenow={trim.start}
          style={{ left: pct(trim.start) }}
          onPointerDown={dragHandle("start")}
        />
        <div
          className="h trim r"
          role="slider"
          aria-label="Trim end"
          aria-valuenow={trim.end}
          style={{ left: pct(trim.end) }}
          onPointerDown={dragHandle("end")}
        />
        <div
          className="h fade"
          role="slider"
          aria-label="Fade in"
          aria-valuenow={trim.fadeIn}
          style={{ left: pct(trim.start + trim.fadeIn) }}
          onPointerDown={dragHandle("fadeIn")}
        />
        <div
          className="h fade"
          role="slider"
          aria-label="Fade out"
          aria-valuenow={trim.fadeOut}
          style={{ left: pct(trim.end - trim.fadeOut) }}
          onPointerDown={dragHandle("fadeOut")}
        />
        <div className="playhead" style={{ left: pct(position) }} />
      </div>
      <div className="trim-readout dim num">
        Trim {fmtShort(trim.start)}.{tenth(trim.start)} – {fmtShort(trim.end)}.{tenth(trim.end)} · kept{" "}
        {(trim.end - trim.start).toFixed(1)} s · fade in {trim.fadeIn.toFixed(1)} s · fade out {trim.fadeOut.toFixed(1)} s
      </div>
    </div>
  );
}

const tenth = (s: number) => Math.floor((s * 10) % 10);
