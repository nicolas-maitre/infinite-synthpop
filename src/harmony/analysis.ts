/**
 * The shape of a genre's harmonic analysis (docs/plans/theory-chords.md §4): the reasons its
 * progressions work, as traits whose weights blend over the references like every other trait
 * (`Blend` with `by`). The data is written by hand from the docs, each trait with a `source` line;
 * the bank entries stay the record of what was measured, and the tests check that each reference's
 * analysis, at its weight alone, reaches its own measured loops.
 */
import type { Blend } from "../genres";
import type { Bar, Progression } from "../progressions";
import type { ReferenceId } from "../references";
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
  /** The bars: a 4-bar line, or a whole loop of another length (a 2-bar vamp, Self Control's 8
   * bars), which plays as it is with no second line. With `cell`, the bars to repeat. */
  bars: readonly (readonly BarOption[] | "cadence")[];
  /** The line's bass stays on this degree under every chord (Innocent Love's verse over v,
   * Heaven Can Wait's pre-chorus over IV); a chord on that root plays plainly. */
  pedal?: string;
  /** A long loop: `bars` played `repeats` times, then the `tag`, whose slots may copy a bar of the
   * cell by its index (Innocent Love's 3½ times round). The Euro choruses' 10 and 14 bars, Faces'
   * 8-bar chorus. */
  cell?: {
    repeats: readonly Option<number>[];
    tag: readonly (readonly BarOption[] | "cadence" | number)[];
  };
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
  /** Endings written out instead of the approach above (Innocent Love's ♭VI │ V turn, Crazy
   * Juliet's IV⁷sus4 │ IV⁷ stop, Heaven Can Wait's IV │ IV handing the chorus a IV), taken with
   * the chance `endingWeight`. */
  endings?: readonly Option<Bar[]>[];
  endingWeight?: Blend;
  source: string;
}

/** The sections written after the verse and chorus, against them (plan §4.2). */
export type SectionKind = "interlude" | "turnaround" | "bridge" | "lift";

/** One shape for a secondary section: each bar a weighted choice, filled in order and weighed by
 * the root motion into it like a schema's bars. A turnaround's last bar is weighed by how it
 * leads into the verse's first chord too (`approach`). */
export interface SectionShape {
  name: string;
  source: string;
  weight: Blend;
  bars: readonly (readonly BarOption[])[];
}

/** How a chord leads into the next section's first chord: the interval from its root up to the
 * target's (5: a dominant, 7: plagal or the Dorian lift, 2: the climb's ♭VII → i, …). */
export interface Approach {
  interval: number;
  weight: Blend;
  source?: string;
}

/** The interlude, turnaround and bridge of one key mode (plan §4.2). */
export interface SectionTraits {
  interlude: readonly SectionShape[];
  turnaround: readonly SectionShape[];
  bridge: readonly SectionShape[];
  /** How a turnaround's last chord leads into the verse's first. Intervals not listed don't. */
  approach: readonly Approach[];
  /** The chords a turnaround may end on when its shape has none that leads into the verse. */
  palette: readonly string[];
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
  sections: SectionTraits;
  /** How the bass moves under a loop besides its chords' roots (plan §4.1 "Bass treatment"). */
  bass?: BassTraits;
  /** How many coloured bars a line takes before the score marks it down (default 1). Italo's
   * colour is its 7ths and sus chords on every other bar (Faces' v7–IVmaj7). */
  colourPerLine?: number;
  /** The longest a chord may sit, in bars, per kind (default 2); 4 or more lets a line hold one
   * chord (Crazy Juliet's I │ I │ I │ I, Heaven Can Wait's IV⁷ vamp). */
  maxHold?: { verse: number; chorus: number };
  /** How much a verse gains for changing chords more slowly than its chorus (a static verse into a
   * busier chorus: Innocent Love, Heaven Can Wait). */
  rhythmContrast?: Blend;
}

/** The bass besides the chords' roots: a held tonic and a step up into the loop's restart. */
export interface BassTraits {
  /** A loop's chance to hold the tonic in the bass under the chord after a tonic bar, where it
   * doesn't clash (The Night's ♭VII/i, Get Closer's D/E and C/E). */
  hold: Blend;
  /** A loop's chance to put the step below the tonic under its last chord when it starts on the
   * tonic (Get Closer's C/D: the bass climbs D–E into the loop). */
  approach: Blend;
  source: string;
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
  /** Progressions the genre's form plays on its own, whatever the chords (TF's VI–VII turn into a
   * verse): a section that is one of them would only repeat it. */
  formPlays: readonly Progression[];
  /** The lift: an outro in the major key a fourth up, its shapes written in that key. */
  lift: readonly SectionShape[];
  /** A song quoting a reference's chorus also plays each of these measured sections with this
   * chance, when it fits the song (a turnaround that leads into its verse, an interlude or bridge
   * that isn't its chorus). */
  quoteSections: {
    chance: number;
    loops: Partial<Record<ReferenceId, Partial<Record<Exclude<SectionKind, "lift">, Progression>>>>;
  };
  /** The form's verse-on-the-chorus's-loop draw (Self Control's one loop, the louder parts
   * setting the chorus apart) holds only for a chorus that opens on the tonic: a relative- or
   * parallel-major chorus would leave the song without its minor verse. Unset: always (You
   * Came's loop opens on IV). */
  sameLoopOnTonic?: boolean;
}
