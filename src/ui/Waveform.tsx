import { useEffect, useRef } from "react";

/** Draws peaks (0..1) as a mirrored waveform, filling its container. */
export function Waveform({ peaks, color }: { peaks: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const g = canvas.getContext("2d")!;
      g.scale(dpr, dpr);
      g.clearRect(0, 0, w, h);
      g.fillStyle = color;
      const mid = h / 2;
      const bar = w / peaks.length;
      peaks.forEach((p, i) => {
        const y = Math.max(0.5, p * (mid - 2));
        g.fillRect(i * bar, mid - y, Math.max(1, bar - 0.4), y * 2);
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, color]);
  return <canvas ref={ref} />;
}
