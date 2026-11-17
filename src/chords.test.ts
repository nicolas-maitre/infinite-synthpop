import { describe, expect, it } from "vitest";
import {
  chord,
  chordName,
  chordPitchClasses,
  scaleForChord,
  type Key,
  type Quality,
} from "./theory";

/*
 * The fixed numeral table chord() used before it became a parser, frozen as it was. Every entry
 * must keep parsing to the same chord, so classic songs, creations and links don't move.
 */
// Semitones above the tonic. Uppercase = major, lowercase = minor; ♭VI / ♭VII are written VI / VII
// as in the analysis (they are the natural-minor degrees).
// You Came (docs/analysis.md §6.2) adds inversions ("I/3" is E/G♯ in E major), secondary
// dominants named by their target ("V/ii" is C♯ in E major, "V7/vi" G♯7) and coloured chords.
const OLD_NUMERALS: Readonly<Record<string, { root: number; quality: Quality; bass?: number }>> = {
  i: { root: 0, quality: "min" },
  I: { root: 0, quality: "maj" },
  ii: { root: 2, quality: "min" },
  "ii°": { root: 2, quality: "dim" },
  III: { root: 3, quality: "maj" },
  iii: { root: 4, quality: "min" },
  iv: { root: 5, quality: "min" },
  IV: { root: 5, quality: "maj" },
  v: { root: 7, quality: "min" },
  V: { root: 7, quality: "maj" },
  VI: { root: 8, quality: "maj" },
  vi: { root: 9, quality: "min" },
  VII: { root: 10, quality: "maj" },
  "I/3": { root: 0, quality: "maj", bass: 4 },
  "IV/3": { root: 5, quality: "maj", bass: 9 },
  IVmaj7: { root: 5, quality: "maj7" },
  IVadd9: { root: 5, quality: "add9" },
  V7: { root: 7, quality: "dom7" },
  Vsus4: { root: 7, quality: "sus4" },
  Vadd9: { root: 7, quality: "add9" },
  "V/ii": { root: 9, quality: "maj" },
  "V/vi": { root: 4, quality: "maj" },
  "V7/vi": { root: 4, quality: "dom7" },
  "Vsus4/vi": { root: 4, quality: "sus4" },
  // The Italo references (docs/italo/). A slash names the bass under the chord: a degree of the
  // key ("VII/i" is E♭ over F in F minor, "VI/VII" C over D in E minor), or "/3" the chord's own
  // 3rd as above ("VI/3" is D♭ over F in F minor).
  "VII/i": { root: 10, quality: "maj", bass: 0 },
  "VI/VII": { root: 8, quality: "maj", bass: 10 },
  "IV/V": { root: 5, quality: "maj", bass: 7 },
  "VI/3": { root: 8, quality: "maj", bass: 0 },
  i7: { root: 0, quality: "min7" },
  v7: { root: 7, quality: "min7" },
  vi7: { root: 9, quality: "min7" },
  II: { root: 1, quality: "maj" },
  IIIadd9: { root: 3, quality: "add9" },
  VImaj7: { root: 8, quality: "maj7" },
  VIIsus4: { root: 10, quality: "sus4" },
  VII7: { root: 10, quality: "dom7" },
  VII7sus4: { root: 10, quality: "dom7sus4" },
  V7sus4: { root: 7, quality: "dom7sus4" },
  // The Euro-disco references (docs/references/sandra-*.md). Heaven Can Wait's Dorian IV⁷ vamp and
  // its pre-chorus over the IV pedal (G♭/A♭, D♭/A♭ in E♭ minor); Innocent Love's verse over the v
  // pedal (Fm7/B♭, E♭/B♭), its half-diminished vi, its sus4 → major IV and its ♭VII with no third
  // (D♭9sus4: D♭ G♭ C♭ E♭); Crazy Juliet's ii⁷, IV⁷sus4 → IV⁷, and the sus chords on its tonic as
  // read from the minor v (G♯sus4 in G♯ minor).
  IV7: { root: 5, quality: "dom7" },
  IVsus4: { root: 5, quality: "sus4" },
  IV7sus4: { root: 5, quality: "dom7sus4" },
  "III/IV": { root: 3, quality: "maj", bass: 5 },
  "VII/IV": { root: 10, quality: "maj", bass: 5 },
  "ii7/v": { root: 2, quality: "min7", bass: 7 },
  "I/v": { root: 0, quality: "maj", bass: 7 },
  viø7: { root: 9, quality: "hdim7" },
  VII9sus4: { root: 10, quality: "9sus4" },
  ii7: { root: 2, quality: "min7" },
  vii: { root: 10, quality: "min" },
  VIadd9: { root: 8, quality: "add9" },
  Isus4: { root: 0, quality: "sus4" },
};

const KEYS: Key[] = [
  { tonic: 4, mode: "minor" },
  { tonic: 5, mode: "minor" },
  { tonic: 4, mode: "major" },
  { tonic: 1, mode: "major" },
];

describe("chord()", () => {
  it("parses every numeral of the old table to the same chord", () => {
    for (const [numeral, def] of Object.entries(OLD_NUMERALS)) {
      const c = chord(numeral);
      expect(c, numeral).toStrictEqual({ numeral, ...def });
    }
  });

  it("names, voices and scales the old numerals as the table did", () => {
    for (const [numeral, def] of Object.entries(OLD_NUMERALS)) {
      for (const key of KEYS) {
        const old = { numeral, ...def };
        const c = chord(numeral);
        expect(chordName(key, c), numeral).toBe(chordName(key, old));
        expect(chordPitchClasses(key, c), numeral).toEqual(chordPitchClasses(key, old));
        expect(scaleForChord(key, c), numeral).toEqual(scaleForChord(key, old));
      }
    }
  });

  it("composes chords the old table didn't list", () => {
    const cases: [string, { root: number; quality: Quality; bass?: number }][] = [
      ["bVII7", { root: 10, quality: "dom7" }],
      ["♭VII", { root: 10, quality: "maj" }],
      ["iv7", { root: 5, quality: "min7" }],
      ["VIadd9/3", { root: 8, quality: "add9", bass: 0 }],
      ["IIImaj7", { root: 3, quality: "maj7" }],
      ["V7/IV", { root: 0, quality: "dom7" }],
      ["V/V", { root: 2, quality: "maj" }],
      ["V7/bVII", { root: 5, quality: "dom7" }],
      ["vi/v", { root: 9, quality: "min", bass: 7 }],
      ["ii7/3", { root: 2, quality: "min7", bass: 5 }],
      ["vii°", { root: 10, quality: "dim" }],
      ["#iv°", { root: 6, quality: "dim" }],
      ["♯ivø7", { root: 6, quality: "hdim7" }],
      ["♮VI", { root: 9, quality: "maj" }],
      ["♮VII7", { root: 11, quality: "dom7" }],
      ["bvi", { root: 8, quality: "min" }],
      ["bII", { root: 1, quality: "maj" }],
      ["IImaj7", { root: 1, quality: "maj7" }],
      ["visus4", { root: 9, quality: "sus4" }],
      ["VI9sus4", { root: 8, quality: "9sus4" }],
      ["iii7", { root: 4, quality: "min7" }],
      ["Imaj7/3", { root: 0, quality: "maj7", bass: 4 }],
      ["VII/VI", { root: 10, quality: "maj", bass: 8 }],
      ["IV/bVII", { root: 5, quality: "maj", bass: 10 }],
    ];
    for (const [numeral, def] of cases)
      expect(chord(numeral), numeral).toStrictEqual({ numeral, ...def });
  });

  it("reads a slash after an unaltered V as its applied target, except the tonic", () => {
    // Applied: the dominant of the target.
    expect(chord("V/ii").root).toBe(9);
    expect(chord("Vsus4/vi")).toStrictEqual({ numeral: "Vsus4/vi", root: 4, quality: "sus4" });
    // V of the tonic is V itself, so the tonic is a pedal under it.
    expect(chord("V/i")).toStrictEqual({ numeral: "V/i", root: 7, quality: "maj", bass: 0 });
    expect(chord("V7/I").bass).toBe(0);
    // "3" is the dominant's own 3rd; a target then a bass puts an applied chord over a bass.
    expect(chord("V/3")).toStrictEqual({ numeral: "V/3", root: 7, quality: "maj", bass: 11 });
    expect(chord("V/I/IV")).toStrictEqual({ numeral: "V/I/IV", root: 7, quality: "maj", bass: 5 });
    expect(chord("V7/vi/3")).toStrictEqual({
      numeral: "V7/vi/3",
      root: 4,
      quality: "dom7",
      bass: 8,
    });
    // Anything else over a slash is a bass: the minor v, an altered V, other degrees.
    expect(chord("v/IV")).toStrictEqual({ numeral: "v/IV", root: 7, quality: "min", bass: 5 });
    expect(chord("♮V/ii")).toStrictEqual({ numeral: "♮V/ii", root: 7, quality: "maj", bass: 2 });
    expect(chord("IV/V").bass).toBe(7);
  });

  it("names the new chords", () => {
    const cMajor: Key = { tonic: 0, mode: "major" };
    const fMinor: Key = { tonic: 5, mode: "minor" };
    expect(chordName(cMajor, chord("V7/IV"))).toBe("C7");
    expect(chordName(cMajor, chord("bVII7"))).toBe("B♭7");
    expect(chordName(cMajor, chord("V/I/IV"))).toBe("G/F");
    expect(chordName(fMinor, chord("VIadd9/3"))).toBe("D♭add9/F");
    expect(chordName(fMinor, chord("iv7"))).toBe("B♭m7");
  });

  it("still throws on what it can't read", () => {
    for (const bad of [
      "",
      "X",
      "Vi",
      "iI",
      "IVm",
      "I°",
      "Iø7",
      "iimaj7",
      "iadd9",
      "VIImin",
      "bbVII",
      " I",
      "I ",
      "I/",
      "/I",
      "I/3/5",
      "Isus4/3",
      "IV/V/i",
      "V/ii7",
      "V/ii/3/i",
      "V/3/i",
      "I/i",
      "I/x",
      "IV/5",
      "constructor",
      "toString",
    ])
      expect(() => chord(bad), JSON.stringify(bad)).toThrow(/Unknown numeral/);
  });
});
