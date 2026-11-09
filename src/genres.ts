/**
 * Genre profiles: everything the generator weighs differently from one reference song to another.
 * A genre is a discrete choice; blending happens only between its own references.
 *
 * Today the blend is the scalar `style` (0 = the first reference … 1 = the second), turned into one
 * weight per reference by `referenceWeights`. Every style-dependent number is a `Blend`: a base plus
 * what each reference adds in proportion to its weight. That is the form the original expressions
 * had (`0.1 + 0.7 * (1 - style)` is a base of 0.1 plus 0.7 from True Faith), so the profile
 * reproduces them bit for bit, and it extends to any number of references once the weights come
 * from a point inside a polygon instead of a slider.
 */
import type { BassStyle, KitName } from "./composer";
import type { DrumVoice } from "./arranger";
import type { BankEntry, ProgressionKind } from "./progressions";
import type { ReferenceId } from "./references";

export type GenreId = "synthpop";

/** A number that varies with the references' weights: `base + Σ by[ref] × weight(ref)`. */
export interface Blend {
  base?: number;
  by?: Partial<Record<ReferenceId, number>>;
}

/** Drum details a reference has that the genre doesn't by default. They apply while that
 * reference outweighs every other one. */
export interface DrumTraits {
  /** A low tom on 4& of every other intro bar (TF's MIDI bars 1–15). */
  introLowTom: boolean;
  /** An open hat on beat 3 of every other bar (TF, intro to outro). */
  openHatBeat3: boolean;
  /** Big sections may add a soft kick on the last 16th's 8th (DS). */
  bigKick14: boolean;
  /** Big sections' extra percussion: a tambourine on the 8th offbeats (DS) or 16th cabasa (TF). */
  bigPercussion: Extract<DrumVoice, "tamb" | "cabasa">;
}

/** The bass's tone controls (instruments.ts `setBassTone`). */
export interface BassTone {
  /** The tone shelf's corner, Hz. */
  frequency: number;
  /** The presence boost, dB. */
  presence: number;
  /** The saw bass's own filter cutoff, Hz. */
  sawCutoff: number;
}

/** When a progression substitution may fire: chords one reference uses where the other uses
 * another (`mutate`). Tried in order; the first whose chance comes up wins. */
export interface Substitution {
  from: string;
  to: string;
  chance: Blend;
  /** Only in a progression's last bar. */
  lastBar?: boolean;
  /** Only in these progressions. */
  kinds?: readonly ProgressionKind[];
}

export interface Genre {
  id: GenreId;
  name: string;
  /** The references the blend runs between, in slider order: `style` 0 is the first, 1 the last. */
  references: readonly [ReferenceId, ReferenceId];
  tempo: { range: readonly [number, number]; center: number };
  /** Key tonic (pitch class) → weight; the keys are minor. */
  keyWeights: readonly (readonly [number, number])[];
  /** The progression bank; each entry's `style` places it on the same axis as the slider. */
  bank: Record<ProgressionKind, readonly BankEntry[]>;
  substitutions: readonly Substitution[];
  kits: readonly (readonly [KitName, Blend])[];
  bassFigures: readonly (readonly [BassStyle, Blend])[];
  /** Chance of ending on a lift to IV rather than a chorus to fade. */
  liftEnding: Blend;
  /** Chance a generated song gets the chorus counter-line. */
  counter: Blend;
  /** The section planner's odds (composer.ts `planSections`). */
  form: {
    /** The high 16th sequencer after the first chorus. */
    seq: Blend;
    /** The rhythm guitar in choruses, instrumentals and the outro. */
    guitar: Blend;
    /** Stabs in a chorus (drawn per chorus). */
    stabs: Blend;
    /** The opening intro's drums: the groove, else kick only, else full. */
    introGroove: Blend;
    introKick: Blend;
    /** The melodic bass in the opening intro and in the riff intro. */
    introHook: Blend;
    riffIntroHook: Blend;
    riffIntroArp: Blend;
    /** After a chorus: the DS block (interlude, turnaround, break) instead of TF's instrumental. */
    dsBlock: Blend;
    /** The melodic bass over the DS interlude and the TF instrumentals. */
    interludeHook: Blend;
    instrumentalHook: Blend;
    /** TF's two-bar VI–VII turn into a verse. */
    turn: Blend;
    /** A third verse and chorus block (standard form). */
    thirdVerse: Blend;
    /** A third final chorus (standard form). */
    extraChorus: Blend;
  };
  /** Drum details when no reference outweighs the others. */
  drums: DrumTraits;
  /** Per reference, the drum details it brings while it outweighs the others. */
  drumTraits: Partial<Record<ReferenceId, DrumTraits>>;
  bassTone: { frequency: Blend; presence: Blend; sawCutoff: Blend };
}

/** Measured from the recordings (docs/analysis.md §3). */
const SYNTHPOP_BANK: Record<ProgressionKind, readonly BankEntry[]> = {
  verse: [
    // TF's verse from the MIDI transcription's sequence bass: the second line moves differently.
    {
      name: "TF verse (MIDI)",
      bars: [
        ["i"],
        ["VI", "VII"],
        ["v"],
        ["v"],
        ["i"],
        ["VI", "VII"],
        ["v"],
        ["VII"],
        ["i"],
        ["VII"],
        ["VI"],
        ["v"],
        ["VII"],
        ["VI"],
        ["v"],
        ["v", "V"],
      ],
      style: 0,
    },
    { name: "TF verse line 1", bars: [["i"], ["VI", "VII"], ["v"], ["v"]], style: 0.1 },
    { name: "TF verse (Hooktheory)", bars: [["i"], ["VI"], ["VII"], ["v", "VII"]], style: 0.15 },
    {
      name: "DS verse (measured)",
      bars: [["i"], ["VI"], ["VII"], ["v"], ["i"], ["VI"], ["iv"], ["V"]],
      style: 1,
    },
    { name: "DS verse line 2", bars: [["i"], ["VI"], ["iv"], ["V"]], style: 0.85 },
    {
      name: "v then V",
      bars: [["i"], ["VI", "VII"], ["v"], ["v"], ["i"], ["VI", "VII"], ["v"], ["V"]],
      style: 0.5,
    },
    { name: "aeolian climb", bars: [["i"], ["VI"], ["VII"], ["v"]], style: 0.5 },
  ],
  chorus: [
    // TF's chorus (MIDI): one note away from DS's, the major IV against the minor iv.
    { name: "TF chorus (MIDI)", bars: [["i"], ["III"], ["VII"], ["IV"]], style: 0 },
    { name: "TF chorus (plain)", bars: [["i"], ["VII"], ["VII"], ["IV"]], style: 0.1 },
    { name: "DS chorus (measured)", bars: [["i"], ["III"], ["VII"], ["iv"]], style: 1 },
    { name: "DS chorus (C turn)", bars: [["i"], ["III"], ["VII"], ["iv", "VI"]], style: 0.9 },
    { name: "TF chorus (F–C split)", bars: [["i"], ["III", "VII"], ["VII"], ["IV"]], style: 0.3 },
    { name: "chorus → V", bars: [["i"], ["III"], ["VII"], ["V"]], style: 0.7 },
  ],
  interlude: [
    { name: "DS interlude (measured)", bars: [["III"], ["VII"], ["iv"], ["i", "VII"]], style: 1 },
    { name: "relative lift", bars: [["III"], ["VII"], ["iv"], ["i"]], style: 0.75 },
    { name: "TF instrumental", bars: [["i"], ["III"], ["VII"], ["IV"]], style: 0 },
  ],
  turnaround: [
    { name: "DS Dorian turnaround (measured)", bars: [["ii"], ["ii"], ["IV"], ["IV"]], style: 1 },
    { name: "TF turnaround on VI (measured)", bars: [["VI"], ["VI"]], style: 0 },
    { name: "TF turnaround VI–VII (MIDI)", bars: [["VI"], ["VII"]], style: 0.1 },
    { name: "VI–VII–VI–VII", bars: [["VI"], ["VII"], ["VI"], ["VII"]], style: 0.5 },
  ],
  bridge: [
    { name: "TF i–IV vamp (measured)", bars: [["i", "IV"], ["IV"], ["i", "IV"], ["IV"]], style: 0 },
    { name: "DS long-version bridge", bars: [["ii"], ["ii"], ["IV"], ["V"]], style: 1 },
    { name: "subdominant", bars: [["iv"], ["VI"], ["VII"], ["i"]], style: 0.5 },
  ],
  // TF's outro: the chorus's IV becomes the new tonic (major), vamping with the odd V.
  lift: [
    { name: "TF outro vamp (measured)", bars: [["I"], ["I"], ["I"], ["I", "V"]], style: 0 },
    { name: "lift I–IV", bars: [["I"], ["I", "IV"], ["I"], ["V"]], style: 0.3 },
    { name: "lift I–IV–V", bars: [["I"], ["IV"], ["I"], ["V"]], style: 0.6 },
  ],
};

const TF = "true-faith";
const DS = "different-story";

export const GENRES: Record<GenreId, Genre> = {
  synthpop: {
    id: "synthpop",
    name: "Synthpop",
    references: [TF, DS],
    // True Faith measures 117.0 BPM, The Different Story 119.8: centred between them.
    tempo: { range: [116, 121], center: 118.5 },
    // Weighted toward the originals' keys: D minor (True Faith) and E minor (The Different Story).
    keyWeights: [
      [2, 3],
      [4, 3],
      [9, 2],
      [0, 1.5],
      [7, 1.5],
      [11, 1],
      [5, 1],
      [6, 1],
      [1, 0.5],
    ],
    bank: SYNTHPOP_BANK,
    // IV ↔ iv is the one-note difference between the choruses; DS cadences on V, TF on v.
    substitutions: [
      { from: "IV", to: "iv", chance: { by: { [DS]: 1 } } },
      { from: "iv", to: "IV", chance: { by: { [TF]: 1 } } },
      { from: "v", to: "V", chance: { by: { [DS]: 1 } }, lastBar: true },
      { from: "V", to: "v", chance: { by: { [TF]: 1 } } },
      { from: "iv", to: "VI", chance: { base: 0.3 }, lastBar: true, kinds: ["chorus"] },
    ],
    kits: [
      ["sp12", { base: 1.5, by: { [DS]: -1 } }],
      ["linndrum", { base: 0.5, by: { [DS]: 1 } }],
      ["dmx", { base: 0.4, by: { [DS]: 0.4 } }],
    ],
    bassFigures: [
      ["ds", { base: 0.3, by: { [DS]: 2 } }],
      ["tf", { base: 0.3, by: { [TF]: 2 } }],
    ],
    liftEnding: { base: 0.1, by: { [TF]: 0.7 } },
    // Four TF-style songs out of five, one DS-style song in five.
    counter: { base: 0.2, by: { [TF]: 0.6 } },
    form: {
      seq: { base: 0.15, by: { [TF]: 0.7 } },
      guitar: { base: 0.1, by: { [TF]: 0.7 } },
      stabs: { base: 0.1, by: { [DS]: 0.5 } },
      introGroove: { by: { [TF]: 0.6 } },
      introKick: { base: 0.5, by: { [TF]: 0.3 } },
      introHook: { by: { [TF]: 0.5 } },
      riffIntroHook: { base: 0.1, by: { [TF]: 0.6 } },
      riffIntroArp: { by: { [DS]: 0.3 } },
      dsBlock: { by: { [DS]: 1 } },
      interludeHook: { by: { [TF]: 0.3 } },
      instrumentalHook: { base: 0.2, by: { [TF]: 0.5 } },
      turn: { base: 0.2, by: { [TF]: 0.7 } },
      thirdVerse: { base: 0.2, by: { [TF]: 0.6 } },
      extraChorus: { by: { [DS]: 0.6 } },
    },
    drums: { introLowTom: false, openHatBeat3: false, bigKick14: false, bigPercussion: "cabasa" },
    drumTraits: {
      [TF]: { introLowTom: true, openHatBeat3: true, bigKick14: false, bigPercussion: "cabasa" },
      [DS]: { introLowTom: false, openHatBeat3: false, bigKick14: true, bigPercussion: "tamb" },
    },
    // TF's bass is brighter than DS's: spectral centroid 559 Hz vs 425 Hz, and DS's falls off
    // faster above 220 Hz (about 12 dB per octave).
    bassTone: {
      frequency: { base: 240, by: { [DS]: -80 } },
      presence: { base: 7, by: { [DS]: -6 } },
      sawCutoff: { base: 2500, by: { [DS]: -2200 } },
    },
  },
};

/** One weight per reference, in `genre.references` order, from the slider's `style`. */
export function referenceWeights(genre: Genre, style: number): readonly number[] {
  // The slider runs from the first reference to the last.
  return genre.references.map((_, i) => (i === 0 ? 1 - style : style));
}

/** Evaluates a blend. Terms are added in reference order and zero ones skipped, which keeps the
 * results identical to the expressions they replaced. */
export function blend(genre: Genre, b: Blend, weights: readonly number[]): number {
  let v = b.base ?? 0;
  genre.references.forEach((ref, i) => {
    const c = b.by?.[ref];
    if (c) v += c * (weights[i] ?? 0);
  });
  return v;
}

/** The profile read at one style: blends evaluated, drum traits resolved. */
export interface GenreAt {
  genre: Genre;
  weights: readonly number[];
  at: (b: Blend) => number;
  drums: DrumTraits;
}

export function genreAt(genre: Genre, style: number): GenreAt {
  const weights = referenceWeights(genre, style);
  return {
    genre,
    weights,
    at: (b) => blend(genre, b, weights),
    drums: dominantDrums(genre, weights),
  };
}

/** A reference's drum traits apply while it outweighs every other reference; on a tie, the
 * genre's own. (With two references: style < 0.5 is the first's, > 0.5 the second's.) */
function dominantDrums(genre: Genre, weights: readonly number[]): DrumTraits {
  const i = weights.findIndex((w, i) => weights.every((o, j) => j === i || w > o));
  const ref = i >= 0 ? genre.references[i] : undefined;
  return (ref && genre.drumTraits[ref]) ?? genre.drums;
}

export function bassTone(genre: Genre, style: number): BassTone {
  const g = genreAt(genre, style);
  return {
    frequency: g.at(genre.bassTone.frequency),
    presence: g.at(genre.bassTone.presence),
    sawCutoff: g.at(genre.bassTone.sawCutoff),
  };
}
