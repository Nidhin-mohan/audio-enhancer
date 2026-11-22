// Snapshot-based undo/redo over the Mix. A step is recorded at the end of a
// gesture (commit), and only when the Mix actually changed since the last step.

const MAX_STEPS = 100;

interface Step<T> {
  label: string;
  snapshot: T;
}

export interface HistoryLabels {
  undo: string[];
  redo: string[];
}

export function createHistory<T>(initial: T) {
  const copy = (v: T): T => structuredClone(v);
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  let baseline = copy(initial);
  let undo: Step<T>[] = [];
  let redo: Step<T>[] = [];

  return {
    /** Record a step if `current` differs from the last recorded state. Returns true if one was recorded. */
    commit(label: string, current: T): boolean {
      if (same(current, baseline)) return false;
      undo.push({ label, snapshot: baseline });
      if (undo.length > MAX_STEPS) undo.shift();
      redo = [];
      baseline = copy(current);
      return true;
    },
    /** Returns the state to restore, or null when there is nothing to undo. */
    undo(current: T): T | null {
      const step = undo.pop();
      if (!step) return null;
      redo.push({ label: step.label, snapshot: copy(current) });
      baseline = copy(step.snapshot);
      return copy(step.snapshot);
    },
    redo(current: T): T | null {
      const step = redo.pop();
      if (!step) return null;
      undo.push({ label: step.label, snapshot: copy(current) });
      baseline = copy(step.snapshot);
      return copy(step.snapshot);
    },
    /**
     * Apply a non-undoable correction to every recorded state (e.g. a detected Key
     * arriving after the user already made edits), so undo never brings back stale data.
     */
    rewrite(fix: (snapshot: T) => T) {
      baseline = fix(copy(baseline));
      undo = undo.map((s) => ({ ...s, snapshot: fix(copy(s.snapshot)) }));
      redo = redo.map((s) => ({ ...s, snapshot: fix(copy(s.snapshot)) }));
    },
    /** Forget all steps and start again from `current`. */
    reset(current: T) {
      undo = [];
      redo = [];
      baseline = copy(current);
    },
    labels(): HistoryLabels {
      return { undo: undo.map((s) => s.label), redo: redo.map((s) => s.label) };
    },
  };
}
