/** Pitch classes, keys, Roman-numeral chords and voicing. Pitches are MIDI numbers. */

export type Mode = "minor" | "major";
export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: Mode;
}

/** Triads, plus the colours You Came uses: sus4, dominant 7th, major 7th and added 9th. */
export type Quality =
  "maj" | "min" | "dim" | "sus4" | "dom7" | "maj7" | "add9" | "min7" | "dom7sus4";
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

// Semitones above the tonic. Uppercase = major, lowercase = minor; ♭VI / ♭VII are written VI / VII
// as in the analysis (they are the natural-minor degrees).
// You Came (docs/analysis.md §6.2) adds inversions ("I/3" is E/G♯ in E major), secondary
// dominants named by their target ("V/ii" is C♯ in E major, "V7/vi" G♯7) and coloured chords.
const NUMERALS: Record<string, { root: number; quality: Quality; bass?: number }> = {
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
};

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
};

const SCALES: Record<Mode, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function chord(numeral: string): Chord {
  const def = NUMERALS[numeral];
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
