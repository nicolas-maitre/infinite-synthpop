/** Pitch classes, keys, Roman-numeral chords and voicing. Pitches are MIDI numbers. */

export type Mode = "minor" | "major";
export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: Mode;
}

/** Triads, plus the colours You Came uses: sus4, dominant 7th, major 7th and added 9th. */
export type Quality =
  | "maj"
  | "min"
  | "dim"
  | "sus4"
  | "dom7"
  | "maj7"
  | "add9"
  | "min7"
  | "dom7sus4"
  | "hdim7"
  | "9sus4";
export interface Chord {
  numeral: string;
  /** Semitones above the key's tonic. */
  root: number;
  quality: Quality;
  /** The bass note, in semitones above the tonic, when it isn't the root (an inversion). */
  bass?: number;
}

const SHARP_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** Minor keys whose signatures use flats (D, G, C, F, B♭, E♭ minor), plus their relative majors. */
const FLAT_MINOR_TONICS = new Set([2, 7, 0, 5, 10, 3]);
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1, 6]);

/*
 * Roman numerals. A numeral is `degree[quality][/target][/bass]`:
 *
 * - **Degree:** I–VII. Uppercase is a major-family chord, lowercase a minor-family one. With no
 *   accidental, the root is the one the analysis uses (docs/analysis.md): uppercase II, III, VI and
 *   VII are ♭II, ♭III, ♭VI and ♭VII (the natural-minor degrees, plus the Phrygian ♭II), lowercase
 *   ii, iii and vi are the major-scale ones, and vii is ♭vii. An explicit accidental (`b`/`♭`,
 *   `#`/`♯`, or `♮`) counts from the major scale instead, for chords that mapping can't name:
 *   `♮VI` is A major in C, `#iv°` F♯°, `bvi` A♭m. Plain `bVII` equals `VII`.
 * - **Quality:** uppercase takes `7` (dominant), `maj7`, `add9`; lowercase takes `7` (minor 7th),
 *   `°` and `ø7`; both take `sus4`, `7sus4` and `9sus4` (no 3rd, so case only picks the root).
 * - **Applied target or slash bass.** A slash after an uppercase, unaltered V of any quality (`V`,
 *   `V7`, `Vsus4`…) names an applied target: `V/ii` is the dominant of ii (C♯ in E major), `V7/vi`
 *   G♯7. The one exception is the tonic: V of I is V itself, so `V/i` and `V/I` are V over a tonic
 *   pedal. A slash after any other chord names the bass: a degree of the key (`VII/i` is E♭ over F
 *   in F minor, `IV/V`, `ii7/v`) or `3`, the chord's own 3rd (`I/3` is E/G♯ in E major, `VI/3` D♭/F
 *   in F minor). To put a dominant over another bass, give it a target and then the bass:
 *   `V/I/IV` is G/F in C.
 *
 * `numeral` keeps the input string, and scaleForChord still keys some colours on exact spellings
 * (`V`, `V7`, `IV`, `ii`, `V/ii`, `V/vi`, `V7/vi`), so a respelling like `♮V` doesn't get them.
 *
 * The references these come from: You Came (docs/analysis.md §6.2), the Italo songs
 * (docs/italo/) and the Euro-disco ones (docs/references/sandra-*.md).
 */

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
const IMPLIED_UPPER = [0, 1, 3, 5, 7, 8, 10] as const;
const IMPLIED_LOWER = [0, 2, 4, 5, 7, 9, 10] as const;
const ACCIDENTALS = new Map([
  ["b", -1],
  ["♭", -1],
  ["#", 1],
  ["♯", 1],
  ["♮", 0],
]);
const DEGREE = /^([b♭#♯♮]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)/u;
const SUS_SUFFIXES: [string, Quality][] = [
  ["sus4", "sus4"],
  ["7sus4", "dom7sus4"],
  ["9sus4", "9sus4"],
];
const UPPER_SUFFIXES = new Map<string, Quality>([
  ["", "maj"],
  ["7", "dom7"],
  ["maj7", "maj7"],
  ["add9", "add9"],
  ...SUS_SUFFIXES,
]);
const LOWER_SUFFIXES = new Map<string, Quality>([
  ["", "min"],
  ["7", "min7"],
  ["°", "dim"],
  ["ø7", "hdim7"],
  ...SUS_SUFFIXES,
]);

interface Degree {
  /** 0 for I, 6 for VII. */
  index: number;
  upper: boolean;
  altered: boolean;
  /** Semitones above the tonic. */
  root: number;
  /** What follows the numeral. */
  rest: string;
}

function parseDegree(text: string): Degree | null {
  const m = DEGREE.exec(text);
  if (!m) return null;
  const [all, accidental = "", roman = ""] = m;
  const upper = roman === roman.toUpperCase();
  const index = ROMAN.indexOf(roman.toUpperCase() as (typeof ROMAN)[number]);
  const shift = ACCIDENTALS.get(accidental);
  const root =
    shift === undefined
      ? (upper ? IMPLIED_UPPER : IMPLIED_LOWER)[index]
      : mod12((MAJOR_STEPS[index] ?? 0) + shift);
  if (root === undefined) return null;
  return { index, upper, altered: accidental !== "", root, rest: text.slice(all.length) };
}

/** A bare degree (no quality), as a target or a bass. */
function parseBareDegree(text: string): Degree | null {
  const d = parseDegree(text);
  return d && d.rest === "" ? d : null;
}

function parseNumeral(numeral: string): Omit<Chord, "numeral"> | null {
  const [head = "", ...slashes] = numeral.split("/");
  const d = parseDegree(head);
  if (!d) return null;
  const quality = (d.upper ? UPPER_SUFFIXES : LOWER_SUFFIXES).get(d.rest);
  if (!quality) return null;
  let root = d.root;

  const dominant = d.upper && !d.altered && d.index === 4;
  const [first, second] = slashes;
  if (slashes.length > 2 || (slashes.length === 2 && !dominant)) return null;
  if (first !== undefined && dominant) {
    const target = parseBareDegree(first);
    const tonic = target !== null && target.index === 0 && !target.altered;
    if (target && (!tonic || second !== undefined)) {
      root = mod12(target.root + 7);
      slashes.shift();
    } else if (second !== undefined) return null;
  }

  const bassText = slashes[0];
  if (bassText === undefined) return { root, quality };
  let bass: number;
  if (bassText === "3") {
    const third = QUALITY_INTERVALS[quality][1];
    if (third !== 3 && third !== 4) return null;
    bass = mod12(root + third);
  } else {
    const b = parseBareDegree(bassText);
    if (!b) return null;
    bass = b.root;
  }
  return bass === root ? null : { root, quality, bass };
}

const QUALITY_INTERVALS: Record<Quality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  add9: [0, 4, 7, 2],
  min7: [0, 3, 7, 10],
  dom7sus4: [0, 5, 7, 10],
  hdim7: [0, 3, 6, 10],
  "9sus4": [0, 5, 10, 2],
};

const QUALITY_SUFFIXES: Record<Quality, string> = {
  maj: "",
  min: "m",
  dim: "°",
  sus4: "sus4",
  dom7: "7",
  maj7: "maj7",
  add9: "add9",
  min7: "m7",
  dom7sus4: "7sus4",
  hdim7: "m7♭5",
  "9sus4": "9sus4",
};

const SCALES: Record<Mode, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Parses a Roman numeral (see the grammar above); `numeral` keeps the input string. */
export function chord(numeral: string): Chord {
  const def = parseNumeral(numeral);
  if (!def) throw new Error(`Unknown numeral ${numeral}`);
  return { numeral, ...def };
}

export function noteName(pc: number, key?: Key): string {
  const flats = key
    ? (key.mode === "minor" ? FLAT_MINOR_TONICS : FLAT_MAJOR_TONICS).has(mod12(key.tonic))
    : false;
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)] ?? "?";
}

export function keyName(key: Key): string {
  return `${noteName(key.tonic, key)} ${key.mode}`;
}

/** Absolute pitch classes of a chord in a key, root first. */
export function chordPitchClasses(key: Key, c: Chord): number[] {
  return QUALITY_INTERVALS[c.quality].map((i) => mod12(key.tonic + c.root + i));
}

export function chordName(key: Key, c: Chord): string {
  const name = noteName(key.tonic + c.root, key) + QUALITY_SUFFIXES[c.quality];
  return c.bass === undefined ? name : `${name}/${noteName(key.tonic + c.bass, key)}`;
}

/**
 * The scale melodies draw from over a chord. In minor, a major V borrows the harmonic-minor
 * leading tone; IV and ii borrow Dorian's raised 6th; any other chord tone outside the scale
 * replaces its neighbour (see below). In major, a secondary dominant raises the
 * note under its target (V/ii's E♯, V/vi's B♯ in E major), and any other borrowed tone (the minor
 * v's D♮, a ♭VI or ♭VII) takes the place of the scale step a semitone above it.
 */
export function scaleForChord(key: Key, c: Chord): number[] {
  const steps = [...SCALES[key.mode]];
  if (key.mode === "minor") {
    if (c.numeral === "V" || c.numeral === "V7") steps[6] = 11;
    // Dorian colour: the major IV and minor ii both carry the raised 6th (TF's G, DS's F♯m–A).
    if (c.numeral === "IV" || c.numeral === "ii") steps[5] = 9;
    // Any other borrowed tone (the Italo chords: Faces' A major and F♯m7 in A minor, The Night's
    // ♭II) is a raised step and takes the place of the scale step a semitone below, or, for a
    // ♭II, of the 2nd above it: the tonic stays.
    for (const i of QUALITY_INTERVALS[c.quality]) {
      const t = mod12(c.root + i);
      if (steps.includes(t)) continue;
      const below = steps.indexOf(mod12(t - 1));
      const at = below > 0 ? below : steps.indexOf(mod12(t + 1));
      if (at >= 0) steps[at] = t;
    }
  } else {
    if (c.numeral === "V/ii") steps[0] = 1;
    if (c.numeral === "V/vi" || c.numeral === "V7/vi") steps[4] = 8;
    for (const i of QUALITY_INTERVALS[c.quality]) {
      const t = mod12(c.root + i);
      if (steps.includes(t)) continue;
      const above = steps.indexOf(mod12(t + 1));
      const at = above >= 0 ? above : steps.indexOf(mod12(t - 1));
      if (at >= 0) steps[at] = t;
    }
  }
  return steps.map((s) => mod12(key.tonic + s));
}

/** All MIDI notes in [lo, hi] whose pitch class is in pcs, ascending. */
export function notesInRange(pcs: readonly number[], lo: number, hi: number): number[] {
  const set = new Set(pcs.map(mod12));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (set.has(mod12(m))) out.push(m);
  return out;
}

/** The MIDI note with pitch class pc closest to target (ties go down). */
export function nearestWithPc(pc: number, target: number): number {
  const below = target - mod12(target - pc);
  return target - below <= below + 12 - target ? below : below + 12;
}

/**
 * Close-position triad voicing nearest a centre pitch. Every chord is voiced around the same centre,
 * so consecutive chords move by small steps: voice leading without carrying any state.
 */
export function voiceChord(pcs: readonly number[], center: number): number[] {
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = center - 12; base <= center; base++) {
      if (mod12(base) !== mod12(order[0] ?? 0)) continue;
      const notes = [base];
      for (const pc of order.slice(1)) {
        const prev = notes[notes.length - 1] ?? base;
        notes.push(prev + mod12(pc - prev) || prev + 12);
      }
      const mid = notes.reduce((a, b) => a + b, 0) / notes.length;
      const cost = Math.abs(mid - center);
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  return best;
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
