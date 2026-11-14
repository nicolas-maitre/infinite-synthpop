import { describe, expect, it } from "vitest";
import { TempoMap } from "./tempo";

describe("TempoMap", () => {
  it("runs at one tempo without a glide", () => {
    const m = new TempoMap(10, { bpm: 120 });
    expect(m.time(0)).toBe(10);
    expect(m.time(4)).toBeCloseTo(18);
    expect(m.time(-2)).toBeCloseTo(6);
    expect(m.barAt(19)).toBeCloseTo(4.5);
    expect(m.barAt(7)).toBeCloseTo(-1.5);
    expect(m.bpmAt(100)).toBe(120);
  });

  it("glides one bar at a time, then holds the new tempo", () => {
    const m = new TempoMap(0, { bpm: 120, glide: { to: 124, start: 8, bars: 4 } });
    expect(m.bpmAt(7)).toBe(120);
    expect(m.bpmAt(8)).toBeCloseTo(121);
    expect(m.bpmAt(11)).toBeCloseTo(124);
    expect(m.bpmAt(50)).toBe(124);
    const glide = 240 / 121 + 240 / 122 + 240 / 123 + 240 / 124;
    expect(m.time(8)).toBeCloseTo(16);
    expect(m.time(10)).toBeCloseTo(16 + 240 / 121 + 240 / 122);
    expect(m.time(12)).toBeCloseTo(16 + glide);
    expect(m.time(14)).toBeCloseTo(16 + glide + 2 * (240 / 124));
  });

  it("finds the bar at a time, inverse to time()", () => {
    const m = new TempoMap(3, { bpm: 110, glide: { to: 104, start: 2, bars: 96 } });
    for (const bar of [-16, -1, 0, 1, 2, 3, 50, 97, 98, 99, 150]) {
      expect(m.barAt(m.time(bar))).toBeCloseTo(bar, 6);
      expect(m.barAt((m.time(bar) + m.time(bar + 1)) / 2)).toBeCloseTo(bar + 0.5, 6);
    }
  });

  it("anchors a bar at a time", () => {
    const shape = { bpm: 118, glide: { to: 121, start: 0, bars: 48 } };
    const m = TempoMap.anchored(shape, 30, 100);
    expect(m.time(30)).toBeCloseTo(100);
    expect(m.time(31) - m.time(30)).toBeCloseTo(m.barSeconds(30));
  });
});
