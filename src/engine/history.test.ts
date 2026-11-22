import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type Studio } from "./studio";
import { sine, wait, warmUp, wavFile } from "../test/audio-fixtures";

let studio: Studio;
afterEach(() => studio?.dispose());

async function loaded(name = "a.wav") {
  studio = createStudio();
  await studio.load(wavFile([sine(220, 3)], 44100, name));
  await warmUp(studio);
  return studio;
}
const labels = (s: Studio) => s.getState().history;

describe("undo and redo", () => {
  it("starts with nothing to undo or redo", async () => {
    const s = await loaded();
    expect(labels(s)).toEqual({ undo: [], redo: [] });
  });

  it("undoes and redoes a committed edit to the Mix", async () => {
    const s = await loaded();
    s.setTrim({ start: 1 });
    s.commit("Trim start");
    expect(labels(s).undo).toEqual(["Trim start"]);
    s.undo();
    expect(s.getState().mix.trim.start).toBe(0);
    expect(labels(s)).toEqual({ undo: [], redo: ["Trim start"] });
    s.redo();
    expect(s.getState().mix.trim.start).toBe(1);
    expect(labels(s)).toEqual({ undo: ["Trim start"], redo: [] });
  });

  it("records a whole gesture (many small changes) as one step", async () => {
    const s = await loaded();
    for (const t of [0.1, 0.2, 0.3, 0.4, 0.5]) s.setTrim({ fadeIn: t });
    s.commit("Fade in");
    expect(labels(s).undo).toEqual(["Fade in"]);
    s.undo();
    expect(s.getState().mix.trim.fadeIn).toBe(0);
  });

  it("records nothing when a gesture changed nothing", async () => {
    const s = await loaded();
    s.commit("Trim start");
    expect(labels(s).undo).toEqual([]);
  });

  it("a new edit after undo clears redo", async () => {
    const s = await loaded();
    s.setTrim({ start: 1 });
    s.commit("Trim start");
    s.undo();
    s.setTrim({ end: 2 });
    s.commit("Trim end");
    expect(labels(s)).toEqual({ undo: ["Trim end"], redo: [] });
  });

  it("listening controls never become undo steps", async () => {
    const s = await loaded();
    s.setLoop(true);
    s.setMasterVolume(0.3);
    s.seek(1);
    s.commit("Loop");
    expect(labels(s).undo).toEqual([]);
  });

  it("loading a Recording clears the history", async () => {
    const s = await loaded();
    s.setTrim({ start: 1 });
    s.commit("Trim start");
    await s.load(wavFile([sine(220, 2)], 44100, "b.wav"));
    expect(labels(s)).toEqual({ undo: [], redo: [] });
  });

  it("keeps at most 100 steps", async () => {
    const s = await loaded();
    for (let i = 1; i <= 105; i++) {
      s.setTrim({ fadeIn: i / 1000 });
      s.commit(`Step ${i}`);
    }
    expect(labels(s).undo).toHaveLength(100);
    expect(labels(s).undo[0]).toBe("Step 6");
  });

  it("does nothing when there is nothing to undo or redo", async () => {
    const s = await loaded();
    s.undo();
    s.redo();
    expect(s.getState().mix.trim.start).toBe(0);
  });

  it("keeps playing after an undo that changes the Trim", async () => {
    const s = await loaded();
    s.setTrim({ end: 2.5 });
    s.commit("Trim end");
    await s.play();
    await wait(150);
    s.undo();
    expect(s.getState().playing).toBe(true);
    expect(s.getState().mix.trim.end).toBeCloseTo(3, 3);
  });
});
