/**
 * The shape of a genre's harmonic analysis (docs/plans/theory-chords.md §4): the reasons its
 * progressions work, as traits whose weights blend over the references like every other trait
 * (`Blend` with `by`). The data is written by hand from the docs, each trait with a `source` line;
 * the bank entries stay the record of what was measured, and the tests check that each reference's
 * analysis, at its weight alone, reaches its own measured loops.
 */
import type { Blend } from "../genres";
import type { Bar } from "../progressions";
import type { Mode } from "../theory";

/** One option of a trait: a value, how much each reference wants it, and where that comes from. */
export interface Option<T> {
  value: T;
  weight: Blend;
  source?: string;
}

/** A bar's choices: one chord, or two that split the bar. */
export type BarOption = Option<Bar>;

/**
 * A slot pattern for one 4-bar line: each bar is a fixed chord or a weighted choice, and the
 * cadence bar is drawn from the cadence trait. The fill also weighs each choice by the root motion
 * from the previous chord (motionWeight), so the same pattern yields the measured loops and their
 * neighbours.
 */
export interface Schema {
  name: string;
  source: string;
  /** How likely it opens a line of each kind; `later` is a verse line after the first two
   * (TF's MIDI verse turns to its descent there). */
  weight: { verse: Blend; chorus: Blend; later?: Blend };
  bars: readonly (readonly BarOption[] | "cadence")[];
}

/** How an 8- or 16-bar progression continues after its first line (plan §4.1 "Second line"). */
export type SecondLine =
  /** The 4-bar line loops as it is. */
  | "repeat"
  /** The same opening, bars 3–4 rewritten toward another cadence (DS's verse, YC's 8-bar loop). */
  | "answer"
  /** A second line from another schema. */
  | "contrast"
  /** Two lines and their answer, then two lines from the `later` schemas (TF's MIDI verse). */
  | "four";

/** A cadence: the bar that ends a line, weighed separately for a first line and an answer. */
export interface Cadence {
  value: Bar;
  /** Ending a line that opens a progression (or the only one). */
  weight: Blend;
  /** Ending an answering line (unset: the same as `weight`). */
  answer?: Blend;
  source?: string;
}

/** A colour applied to one chord in a line: a numeral swapped for its coloured spelling(s). */
export interface Colour {
  from: string;
  to: Bar;
  weight: Blend;
  source?: string;
}

/** A pre-chorus's bars before its approach to the chorus. */
export interface PreShape {
  name: string;
  weight: Blend;
  bars: readonly (readonly BarOption[])[];
}

/** The pre-chorus's material: its lines, and how it leaves into the chorus's first chord. */
export interface PreChorusTraits {
  /** 8-bar shapes: the first six bars; the last two approach the chorus. */
  long: readonly PreShape[];
  /** How often the pre-chorus takes 8 bars rather than 4. */
  longWeight: Blend;
  /** 4-bar shapes: the first two bars. */
  short: readonly PreShape[];
  /** The two approach bars: a sus4 delay then the 7th (YC's G♯sus4 │ G♯7), or a pre-dominant
   * then the dominant. */
  susDelay: Blend;
  /** Leave deceptively (V/vi → IV, V → VI) when the chorus opens on the chord that allows it. */
  deceptive: Blend;
  source: string;
}

/** Everything a genre's analysis says about one key mode. */
export interface ModeTraits {
  schemas: readonly Schema[];
  cadences: { verse: readonly Cadence[]; chorus: readonly Cadence[] };
  colours: readonly Colour[];
  /** How often a line takes one colour (once per line at most). */
  colourChance: Blend;
  /** Chords the "colour used sparingly" score counts (borrowed or mode-colour chords). */
  colourChords: readonly string[];
  /** How often a bar anticipates the next bar's chord in its second half (TF's F–C). */
  anticipate: Blend;
  secondLine: { verse: readonly Option<SecondLine>[]; chorus: readonly Option<SecondLine>[] };
  prechorus: PreChorusTraits;
}

/** How well one chord moving to the next suits the references, by the bass's interval. */
export interface MotionTraits {
  /** Up or down a step (the ♭VI–♭VII–i climb, the descent). */
  step: Blend;
  /** Up a fourth or a fifth (falling fifths, the plagal and Dorian lifts). */
  fourth: Blend;
  /** Up or down a third (the swing into the relative major). */
  third: Blend;
  /** The same chord across a bar line (TF's v │ v, VII │ VII). */
  hold: Blend;
  /** A tritone. */
  tritone: Blend;
  source: string;
}

export interface HarmonyAnalysis {
  /** Per key mode. */
  modes: Record<Mode, ModeTraits>;
  motion: MotionTraits;
  /** How often a song quotes one section on its strongest reference's measured loop. */
  quote: Blend;
  /** Of quotes, how many take the chorus (the rest the verse). */
  quoteChorus: number;
}
