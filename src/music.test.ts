import { describe, expect, it } from "vitest";
import { arrangeBar, MELODIC_TRACKS } from "./arranger";
import { BPM_RANGE, compose } from "./composer";
import { BANK, mutate, pickProgression } from "./progressions";
import { createRng } from "./rng";
import { chord, chordName, chordPitchClasses, mod12, scaleForChord, voiceChord } from "./theory";

const D_MINOR = { tonic: 2, mode: "minor" } as const;
const E_MINOR = { tonic: 4, mode: "minor" } as const;

describe("theory", () => {
  it("spells the measured choruses: TF's major IV vs DS's minor iv", () => {
    expect(["i", "III", "VII", "IV"].map((n) => chordName(D_MINOR, chord(n)))).toEqual([
      "Dm",
      "F",
      "C",
      "G",
    ]);
    expect(["i", "III", "VII", "iv"].map((n) => chordName(E_MINOR, chord(n)))).toEqual([
      "Em",
      "G",
      "D",
      "Am",
    ]);
  });

  it("spells DS's Dorian turnaround", () => {
    expect(["ii", "IV"].map((n) => chordName(E_MINOR, chord(n)))).toEqual(["F♯m", "A"]);
  });

  it("spells The Different Story verse in E minor, with the major V", () => {
    expect(["i", "VI", "VII", "V"].map((n) => chordName(E_MINOR, chord(n)))).toEqual([
      "Em",
      "C",
      "D",
      "B",
    ]);
    expect(chordPitchClasses(E_MINOR, chord("V"))).toEqual([11, 3, 6]);
  });

  it("raises the leading tone only over a major V, and the 6th over Dorian IV / ii", () => {
    expect(scaleForChord(D_MINOR, chord("V"))).toContain(1); // C♯
    expect(scaleForChord(D_MINOR, chord("v"))).toContain(0); // C
    expect(scaleForChord(D_MINOR, chord("IV"))).toContain(11); // B♮
    expect(scaleForChord(D_MINOR, chord("iv"))).toContain(10); // B♭
  });

  it("voices chords around the centre", () => {
    const v = voiceChord([2, 5, 9], 62);
    expect(v).toHaveLength(3);
    expect(v.map(mod12).sort()).toEqual([2, 5, 9]);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(12);
  });
});

describe("progressions", () => {
  it("always opens a chorus or verse on the tonic", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed);
      for (const kind of ["chorus", "verse"] as const) {
        const p = mutate(pickProgression(kind, (seed % 5) / 4, rng), kind, (seed % 5) / 4, rng, 1);
        expect(p[0]).toEqual(["i"]);
      }
    }
  });

  it("prefers True Faith entries at style 0 and Different Story entries at style 1", () => {
    const count = (style: number, name: string) => {
      const target = BANK.chorus.find((e) => e.name === name)?.bars;
      const rng = createRng(1);
      let n = 0;
      for (let i = 0; i < 500; i++) if (pickProgression("chorus", style, rng) === target) n++;
      return n;
    };
    expect(count(0, "TF chorus (measured)")).toBeGreaterThan(count(1, "TF chorus (measured)") * 3);
    expect(count(1, "DS chorus (measured)")).toBeGreaterThan(count(0, "DS chorus (measured)") * 3);
  });
});

describe("compose", () => {
  it("is deterministic for a seed", () => {
    expect(compose({ seed: 42, style: 0.5 })).toEqual(compose({ seed: 42, style: 0.5 }));
    expect(compose({ seed: 42, style: 0.5 }).title).not.toEqual(
      compose({ seed: 43, style: 0.5 }).title,
    );
  });

  it("keeps the form stable when only the key changes", () => {
    const a = compose({ seed: 7, style: 0.2 });
    const b = compose({ seed: 7, style: 0.2, key: E_MINOR });
    expect(b.sections.map((s) => [s.label, s.bars])).toEqual(
      a.sections.map((s) => [s.label, s.bars]),
    );
  });

  it("plans a contiguous song in the expected tempo range", () => {
    for (let seed = 0; seed < 50; seed++) {
      const song = compose({ seed, style: seed / 50 });
      expect(song.bpm).toBeGreaterThanOrEqual(BPM_RANGE[0]);
      expect(song.bpm).toBeLessThanOrEqual(BPM_RANGE[1]);
      let bar = 0;
      for (const s of song.sections) {
        expect(s.startBar).toBe(bar);
        bar += s.bars;
      }
      expect(song.totalBars).toBe(bar);
      expect(song.sections.filter((s) => s.kind === "chorus").length).toBeGreaterThanOrEqual(3);
      expect(song.sections[0]?.progression).toBe(song.progressions.chorus);
      expect(song.sections.at(-1)?.fade).toBe(true);
    }
  });

  it("writes diatonic melodies that mostly land on chord tones", () => {
    let total = 0;
    let chordTones = 0;
    for (let seed = 0; seed < 40; seed++) {
      const song = compose({ seed, style: 0.5 });
      for (const kind of ["verse", "chorus"] as const) {
        const prog = song.progressions[kind];
        song.melodies[kind].bars.forEach((bar, b) =>
          bar.forEach((n) => {
            const numerals = prog[b % prog.length] ?? [];
            const c = chord(numerals[numerals.length > 1 && n.step >= 8 ? 1 : 0] ?? "i");
            expect(scaleForChord(song.key, c)).toContain(mod12(n.midi));
            total++;
            if (chordPitchClasses(song.key, c).includes(mod12(n.midi))) chordTones++;
          }),
        );
      }
    }
    // The analysis measured ~64% chord tones in True Faith.
    expect(chordTones / total).toBeGreaterThan(0.45);
    expect(chordTones / total).toBeLessThan(0.9);
  });
});

describe("arrangeBar", () => {
  it("anticipates chord changes by a 16th in the pulse bass", () => {
    let checked = 0;
    for (let seed = 0; seed < 40 && checked < 5; seed++) {
      const song = compose({ seed, style: 1 });
      if (song.bassStyle !== "pulse") continue;
      const verse = song.sections.find((s) => s.kind === "verse");
      if (!verse) continue;
      const bar = arrangeBar(song, verse.startBar);
      const next = arrangeBar(song, verse.startBar + 1);
      const last = bar.notes.bass.at(-1);
      const nextFirst = next.notes.bass[0];
      expect(last?.step).toBe(15);
      expect(last?.midi).toBe(nextFirst?.midi);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("plays the sequenced bass on every 16th of every bar it is in", () => {
    for (let seed = 0; seed < 20; seed++) {
      const song = compose({ seed, style: seed / 19 });
      for (let bar = 0; bar < song.totalBars; bar++) {
        const ev = arrangeBar(song, bar);
        if (!ev.section.layers.bass) continue;
        expect(ev.notes.bass.map((n) => n.step)).toEqual([...Array(16).keys()]);
      }
    }
  });

  it("fades out over the last bars of the song", () => {
    const song = compose({ seed: 3, style: 0.5 });
    const loud = arrangeBar(song, song.totalBars - 9);
    const quiet = arrangeBar(song, song.totalBars - 1);
    const peak = (ev: typeof loud) =>
      Math.max(0, ...ev.drums.map((h) => h.vel), ...ev.notes.pad.map((n) => n.vel));
    expect(peak(quiet)).toBeLessThan(peak(loud) * 0.3);
  });

  it("produces sane events for every bar of many songs", () => {
    for (let seed = 0; seed < 25; seed++) {
      const song = compose({ seed, style: (seed % 5) / 4 });
      for (let bar = 0; bar < song.totalBars; bar++) {
        const ev = arrangeBar(song, bar);
        for (const track of MELODIC_TRACKS) {
          for (const n of ev.notes[track]) {
            expect(n.step).toBeGreaterThanOrEqual(0);
            expect(n.step).toBeLessThan(16);
            expect(n.dur).toBeGreaterThan(0);
            expect(n.midi).toBeGreaterThanOrEqual(24);
            expect(n.midi).toBeLessThanOrEqual(100);
            expect(n.vel).toBeGreaterThan(0);
            expect(n.vel).toBeLessThanOrEqual(1);
          }
        }
        const keys = ev.drums.map((h) => `${h.voice}@${h.step}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const h of ev.drums) {
          expect(h.step).toBeGreaterThanOrEqual(0);
          expect(h.step).toBeLessThan(16);
        }
      }
    }
  });
});
