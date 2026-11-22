import { useEffect, useState, useSyncExternalStore } from "react";
import { createStudio, type Studio } from "../engine/studio";

/**
 * One Studio engine for the page's lifetime, plus its state as React state.
 * Deliberately never disposed: React StrictMode replays effects, and a disposed
 * engine (closed AudioContext) cannot be revived.
 */
export function useStudio() {
  const [studio] = useState<Studio>(() => createStudio());
  const state = useSyncExternalStore(studio.subscribe, studio.getState);
  return { studio, state };
}

/** Playback position, refreshed every animation frame while playing and whenever the cursor moves. */
export function usePosition(studio: Studio, playing: boolean, cursor: number): number {
  const [pos, setPos] = useState(() => studio.getPosition());
  useEffect(() => {
    setPos(studio.getPosition());
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setPos(studio.getPosition());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [studio, playing, cursor]);
  return pos;
}

export const fmtClock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(3).padStart(6, "0")}`;
export const fmtShort = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
