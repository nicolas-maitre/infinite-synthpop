import { describe, expect, it } from "vitest";
import { keepFrom, seekTarget, type Mark } from "./seek";

/** Bars `from`..`to` - 1 of `song`, 2 s each, the first at `at`. */
function bars(song: string, from: number, to: number, at: number): Mark<string>[] {
  return Array.from({ length: to - from }, (_, i) => ({ at: at + i * 2, song, bar: from + i }));
}

describe("seekTarget", () => {
  // Song A bars 0–19 from t = 0, then B from t = 40.
  const marks = [...bars("A", 0, 20, 0), ...bars("B", 0, 10, 40)];

  it("finds a bar rendered ahead, and one kept behind", () => {
    expect(seekTarget(marks, "A", 15, 21, -Infinity, 34)).toBe(30);
    expect(seekTarget(marks, "A", 3, 21, -Infinity, 34)).toBe(6);
    // The bar playing now: back to its start.
    expect(seekTarget(marks, "A", 10, 21, -Infinity, 34)).toBe(20);
  });

  it("not past the render, nor before the audio kept", () => {
    expect(seekTarget(marks, "A", 17, 21, -Infinity, 34)).toBeNull();
    expect(seekTarget(marks, "A", 3, 21, 8, 34)).toBeNull();
    expect(seekTarget(marks, "A", 4, 21, 8, 34)).toBe(8);
  });

  it("not before a cut, heard or pending", () => {
    // A jump at t = 30 from bar 15 back to bar 5: what was before plays no more.
    const jumped = [...bars("A", 0, 15, 0), ...bars("A", 5, 20, 30)];
    expect(seekTarget(jumped, "A", 8, 35, 30, 50)).toBe(36);
    expect(seekTarget(jumped, "A", 12, 35, 30, 50)).toBe(44);
    expect(seekTarget(jumped, "A", 12, 25, 30, 50)).toBe(44);
    expect(seekTarget(jumped, "A", 2, 35, 30, 50)).toBeNull();
  });

  it("stays within the playing song", () => {
    // In B: A's bars are behind the song change, and B's own are found.
    expect(seekTarget(marks, "A", 18, 45, -Infinity, 60)).toBeNull();
    expect(seekTarget(marks, "B", 1, 45, -Infinity, 60)).toBe(42);
    // A song isn't found before it plays, only ahead.
    expect(seekTarget(marks, "B", 2, 21, -Infinity, 60)).toBe(44);
  });

  it("on repeat, the bar of this playing, else the next one", () => {
    const again = [...bars("A", 0, 10, 0), ...bars("A", 0, 10, 20)];
    expect(seekTarget(again, "A", 2, 25, -Infinity, 40)).toBe(24);
    expect(seekTarget(again, "A", 8, 25, -Infinity, 40)).toBe(36);
    expect(seekTarget(again, "A", 8, 25, -Infinity, 30)).toBeNull();
    expect(seekTarget(again, "A", 8, 15, -Infinity, 40)).toBe(16);
  });

  it("before anything is heard, only ahead", () => {
    expect(seekTarget(marks, "A", 2, -1, -Infinity, 10)).toBe(4);
    expect(seekTarget([], "A", 2, 0, -Infinity, 10)).toBeNull();
  });
});

describe("keepFrom", () => {
  const marks = [...bars("A", 0, 50, 0), ...bars("B", 0, 50, 100)];

  it("keeps the last seconds", () => {
    expect(keepFrom(marks, 90, 60, -Infinity, 0.1)).toBe(30);
  });

  it("no further back than the song's start", () => {
    expect(keepFrom(marks, 120, 60, -Infinity, 0.1)).toBeCloseTo(99.9);
    expect(keepFrom(marks, 20, 60, -Infinity, 0.1)).toBeCloseTo(-0.1);
  });

  it("nor the last cut, and nothing at all while a cut is pending", () => {
    expect(keepFrom(marks, 90, 60, 70, 0.1)).toBeCloseTo(69.9);
    expect(keepFrom(marks, 90, 60, 90.1, 0.1)).toBe(90);
  });
});
