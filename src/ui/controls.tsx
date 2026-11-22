// Shared controls with consistent behaviour:
// - every slider shows its value and unit, resets on double-click, and reports
//   one "gesture end" (for a single undo step) when you let go or finish with the keys;
// - switches for on/off; segmented buttons for small sets of choices.

import { useId, useState, type ReactNode } from "react";
import { Chevron } from "./icons";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the value, e.g. "dB", "%", "ms". */
  unit?: string;
  /** Double-click resets to this. */
  defaultValue?: number;
  disabled?: boolean;
  /** Format the value for display (defaults to value + unit, with a + sign for dB). */
  format?: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
  /** End of a drag or key press: record one undo step. */
  onCommit: () => void;
}

export function Slider(p: SliderProps) {
  const id = useId();
  const shown = p.format
    ? p.format(p.value)
    : `${p.unit === "dB" && p.value > 0 ? "+" : ""}${Number.isInteger(p.step ?? 1) ? Math.round(p.value) : p.value.toFixed(1)}${p.unit ? ` ${p.unit}` : ""}`;
  const fill = ((p.value - p.min) / (p.max - p.min)) * 100;
  return (
    <div className={`slider${p.disabled ? " is-disabled" : ""}`}>
      <div className="slider-top">
        <label htmlFor={id}>{p.label}</label>
        <output htmlFor={id} className="num">{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={p.value}
        disabled={p.disabled}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        title={p.defaultValue !== undefined ? "Double-click to reset" : undefined}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onPointerUp={p.onCommit}
        onKeyUp={(e) => e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key.startsWith("Page") ? p.onCommit() : undefined}
        onDoubleClick={() => {
          if (p.defaultValue === undefined) return;
          p.onChange(p.defaultValue);
          p.onCommit();
        }}
      />
      {p.hint && <div className="hint-text">{p.hint}</div>}
    </div>
  );
}

export function Switch(p: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`switch${p.disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        checked={p.checked}
        disabled={p.disabled}
        aria-label={p.label}
        onChange={(e) => p.onChange(e.target.checked)}
      />
      <span className="track" aria-hidden="true" />
    </label>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number>(p: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === p.value}
          className={o.value === p.value ? "on" : ""}
          title={o.title}
          disabled={p.disabled || o.disabled}
          onClick={() => o.value !== p.value && p.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A collapsible section of the Properties panel, with an optional on/off switch and value badge. */
export function Section(p: {
  title: string;
  badge?: ReactNode;
  toggle?: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void };
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(p.defaultOpen ?? true);
  return (
    <section className={`acc${open ? " open" : ""}`}>
      <div className="acc-h">
        <button className="acc-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Chevron />
          <span className="sc">{p.title}</span>
        </button>
        {p.badge !== undefined && <span className="badge num">{p.badge}</span>}
        {p.toggle && <Switch label={`${p.title} on/off`} {...p.toggle} />}
      </div>
      {open && <div className="acc-b">{p.children}</div>}
    </section>
  );
}

/** Explains why controls are unavailable and offers the step that unlocks them. */
export function Locked(p: { children: ReactNode; action?: { label: string; onClick: () => void; disabled?: boolean } }) {
  return (
    <div className="locked">
      <span>{p.children}</span>
      {p.action && (
        <button className="btn small" disabled={p.action.disabled} onClick={p.action.onClick}>
          {p.action.label}
        </button>
      )}
    </div>
  );
}
