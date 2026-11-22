// Pitch Correction Presets: three built-in ones plus the user's own, which are
// kept in browser storage (the only thing that persists between sessions).

import type { PitchSettings } from "./pitch";

export interface PitchPreset {
  name: string;
  settings: PitchSettings;
  builtIn: boolean;
}

/** Values validated in the UI prototype. */
export const BUILT_IN_PRESETS: PitchPreset[] = [
  { name: "Natural", builtIn: true, settings: { retuneMs: 120, humanize: 60, amount: 70, vibrato: 80, formant: true, mix: 100 } },
  { name: "Tight", builtIn: true, settings: { retuneMs: 40, humanize: 30, amount: 90, vibrato: 50, formant: true, mix: 100 } },
  { name: "Hard", builtIn: true, settings: { retuneMs: 0, humanize: 0, amount: 100, vibrato: 0, formant: false, mix: 100 } },
];

export type PresetStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "audio-enhancer.pitch-presets.v1";

export function defaultStorage(): PresetStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The user's saved Presets, or an empty list if storage can't be read. */
export function loadSavedPresets(storage: PresetStorage | null): { presets: PitchPreset[]; available: boolean } {
  if (!storage) return { presets: [], available: false };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as { name: string; settings: PitchSettings }[]) : [];
    return { presets: list.map((p) => ({ ...p, builtIn: false })), available: true };
  } catch {
    return { presets: [], available: false };
  }
}

/** Returns false when storage refused the write (Presets then last only for this session). */
export function storeSavedPresets(storage: PresetStorage | null, presets: PitchPreset[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets.map(({ name, settings }) => ({ name, settings }))));
    return true;
  } catch {
    return false;
  }
}
