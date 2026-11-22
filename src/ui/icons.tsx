const P: Record<string, string> = {
  import: "M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  separate: "M4 6h16M4 10h16M4 14h16M4 18h16",
  mixer: "M6 4v16M12 4v16M18 4v16M4 14h4M10 8h4M16 12h4",
  effects: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  export: "M12 21V9m0 0-4 4m4-4 4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2",
};

export function Icon({ name }: { name: keyof typeof P | string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
);
export const PauseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
);
export const StopIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z" /></svg>
);
export const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
