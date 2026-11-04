/** Pitch classes, keys, Roman-numeral chords and voicing. Pitches are MIDI numbers. */

export type Mode = "minor" | "major";
export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: Mode;
}

export type Quality = "maj" | "min" | "dim";
export interface Chord {
  numeral: string;
  /** Semitones above the key's tonic. */
  root: number;
  quality: Quality;
}

const SHARP_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** Minor keys whose signatures use flats (D, G, C, F, B♭, E♭ minor), plus their relative majors. */
const FLAT_MINOR_TONICS = new Set([2, 7, 0, 5, 10, 3]);
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1, 6]);

// Semitones above the tonic. Uppercase = major, lowercase = minor; ♭VI / ♭VII are written VI / VII
// as in the analysis (they are the natural-minor degrees).
const NUMERALS: Record<string, { root: number; quality: Quality }> = {
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
};

const QUALITY_INTERVALS: Record<Quality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
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
  const suffix = c.quality === "min" ? "m" : c.quality === "dim" ? "°" : "";
  return noteName(key.tonic + c.root, key) + suffix;
}

/**
 * The scale melodies draw from over a chord. In minor, a major V borrows the harmonic-minor
 * leading tone; IV and ii borrow Dorian's raised 6th.
 */
export function scaleForChord(key: Key, c: Chord): number[] {
  const steps = [...SCALES[key.mode]];
  if (key.mode === "minor" && c.numeral === "V") steps[6] = 11;
  // Dorian colour: the major IV and minor ii both carry the raised 6th (TF's G, DS's F♯m–A).
  if (key.mode === "minor" && (c.numeral === "IV" || c.numeral === "ii")) steps[5] = 9;
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
