/**
 * Turns a seed (plus a few settings) into a Song: the section plan, the progressions, and the
 * per-song motifs and melodies. Pure and deterministic; no audio here. See docs/analysis.md.
 */
import type { DrumHit, MelodicTrack } from "./arranger";
import { mutate, pickProgression, type Progression, type ProgressionKind } from "./progressions";
import { REFERENCES, type ReferenceId, type ReferenceSong } from "./references";
import { createRng, type Rng } from "./rng";
import {
  chord,
  chordPitchClasses,
  mod12,
  notesInRange,
  scaleForChord,
  type Chord,
  type Key,
} from "./theory";

export type SectionKind =
  "intro" | "verse" | "chorus" | "interlude" | "turnaround" | "break" | "bridge" | "outro";
/** "groove": TF's busy intro pattern (kick runs, ghost snares, toms). */
export type DrumMode = "off" | "kick" | "half" | "full" | "big" | "groove";
export type KitName = "sp12" | "linndrum" | "dmx" | "synth";
/** Both play the songs' signature bass figure (arranger.ts `figure`), in DS's articulation (16th
 * pickups, approach notes) or TF's (dotted 8ths). */
export type BassStyle = "ds" | "tf";
export type MelodyKind = "verse" | "chorus";

export interface Layers {
  drums: DrumMode;
  bass: boolean;
  hook: boolean;
  pad: boolean;
  riff: boolean;
  arp: boolean;
  stabs: boolean;
  /** TF's high 16th sequencer on the key's 5th (see SequencePattern). */
  seq: boolean;
  /** Plays the bass figure staccato (TF's turnarounds and outro). */
  bassShort: boolean;
  /** TF's rhythm guitar: 16th strums of sus-coloured triads. */
  guitar: boolean;
  lead: MelodyKind | null;
  /** Doubles the lead an octave up (True Faith's two-voice final chorus). */
  leadDouble: boolean;
}

export interface Section {
  kind: SectionKind;
  label: string;
  startBar: number;
  bars: number;
  progression: Progression;
  key: Key;
  layers: Layers;
  /** Drum fill in the last bar. */
  fill: boolean;
  /** Fade out over the last 8 bars (both songs end on a fade). */
  fade: boolean;
}

/**
 * TF's high sequencer (MIDI "Sequence", bar 46 to the end): a 16th pedal on the key's 5th, with the
 * tonic a 4th above (5) or the 5th an octave above (12) added on some steps. The original's exact
 * steps are part of the composition, so each song generates its own.
 */
export interface SequencePattern {
  tops: readonly (0 | 5 | 12)[];
}

/** Parts read from a MIDI file at runtime (midi.ts), by song bar. A part present here replaces the
 * generated one, even where the section wouldn't play it; an empty list of bars silences it. */
export interface ImportedTracks {
  notes?: Partial<Record<MelodicTrack, Note[][]>>;
  drums?: DrumHit[][];
}

/** A realised note. `step` and `dur` are in 16ths from the start of the bar. */
export interface Note {
  step: number;
  dur: number;
  midi: number;
  vel: number;
}

/** A motif note whose pitch is an index into a per-chord ladder, so it follows the harmony. */
export interface MotifNote {
  /** 16ths from the start of the motif. */
  step: number;
  dur: number;
  idx: number;
  vel: number;
}
export interface Motif {
  bars: number;
  notes: MotifNote[];
}

/** An 8-bar sung line: bars 0–3 state it, bars 4–7 answer it with a new cadence. */
export interface Melody {
  bars: Note[][];
}

export interface Song {
  seed: number;
  /** Set when this is one of the two originals (references.ts) rather than a generated song. */
  reference: ReferenceId | null;
  title: string;
  bpm: number;
  key: Key;
  style: number;
  kit: KitName;
  bassStyle: BassStyle;
  progressions: Record<ProgressionKind, Progression>;
  sections: Section[];
  totalBars: number;
  riff: Motif;
  hook: Motif;
  arp: Motif;
  sequence: SequencePattern;
  melodies: Record<MelodyKind, Melody>;
  /** Tracks supplied at runtime from a MIDI file (midi.ts), by song bar; they replace the
   * generated part. */
  imported?: ImportedTracks;
}

export interface ComposeOptions {
  seed: number;
  /** 0 = True Faith … 1 = The Different Story. */
  style: number;
  key?: Key | null;
  bpm?: number | null;
  kit?: KitName | "auto";
  /** Play an original's measured form, chords, key, tempo and kit instead of generating them. */
  reference?: ReferenceId | null;
}

/** Both recordings measure 117.45 BPM. */
export const BPM_RANGE = [115, 120] as const;
export const BPM_CENTER = 117.5;
export const LEAD_RANGES: Record<MelodyKind, readonly [number, number]> = {
  verse: [57, 70],
  chorus: [62, 74],
};

/** Weighted toward the originals' keys: D minor (True Faith) and E minor (The Different Story). */
const KEY_WEIGHTS: readonly (readonly [number, number])[] = [
  [2, 3],
  [4, 3],
  [9, 2],
  [0, 1.5],
  [7, 1.5],
  [11, 1],
  [5, 1],
  [6, 1],
  [1, 0.5],
];

export function compose(opts: ComposeOptions): Song {
  const ref = opts.reference ? REFERENCES[opts.reference] : undefined;
  const style = ref ? ref.style : Math.min(1, Math.max(0, opts.style));
  const root = createRng(opts.seed);
  const rngSetup = root.fork("setup");

  const key: Key = ref?.key ?? opts.key ?? { tonic: rngSetup.weighted(KEY_WEIGHTS), mode: "minor" };
  const autoBpm = rngSetup.weighted(
    Array.from({ length: (BPM_RANGE[1] - BPM_RANGE[0]) * 2 + 1 }, (_, i) => {
      const bpm = BPM_RANGE[0] + i / 2;
      return [bpm, Math.exp(-((bpm - BPM_CENTER) ** 2) / 3)] as const;
    }),
  );
  const bpm = ref?.bpm ?? opts.bpm ?? autoBpm;
  const autoKit = rngSetup.weighted<KitName>([
    ["sp12", 1.5 - style],
    ["linndrum", 0.5 + style],
    ["dmx", 0.4 + style * 0.4],
  ]);
  const kit = ref?.kit ?? (!opts.kit || opts.kit === "auto" ? autoKit : opts.kit);
  const bassStyle =
    ref?.bassStyle ??
    rngSetup.weighted<BassStyle>([
      ["ds", 0.3 + style * 2],
      ["tf", 0.3 + (1 - style) * 2],
    ]);

  const rngProg = root.fork("progressions");
  const prog = (kind: ProgressionKind) =>
    mutate(pickProgression(kind, style, rngProg), kind, style, rngProg);
  const progressions: Record<ProgressionKind, Progression> = {
    verse: prog("verse"),
    chorus: prog("chorus"),
    interlude: prog("interlude"),
    turnaround: prog("turnaround"),
    bridge: prog("bridge"),
    lift: prog("lift"),
  };
  if (ref) {
    progressions.verse = ref.verse;
    progressions.chorus = ref.chorus;
  }

  const rngForm = root.fork("form");
  const liftKey: Key = { tonic: mod12(key.tonic + 5), mode: "major" };
  const useLift = rngForm.chance(0.1 + 0.7 * (1 - style));
  const sections = ref
    ? referenceSections(ref)
    : planSections(rngForm, key, liftKey, useLift, progressions, style);
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);

  const rngMotif = root.fork("motifs");
  const melodies: Record<MelodyKind, Melody> = {
    verse: generateMelody(root.fork("melody-verse"), key, progressions.verse, LEAD_RANGES.verse),
    chorus: generateMelody(
      root.fork("melody-chorus"),
      key,
      progressions.chorus,
      LEAD_RANGES.chorus,
    ),
  };

  return {
    seed: opts.seed,
    reference: opts.reference ?? null,
    title: ref?.title ?? generateTitle(root.fork("title")),
    bpm,
    key,
    style,
    kit,
    bassStyle,
    progressions,
    sections,
    totalBars,
    riff: generateRiff(rngMotif),
    hook: generateHook(rngMotif),
    arp: generateArp(rngMotif),
    sequence: generateSequence(root.fork("sequence")),
    melodies,
  };
}

// ── Form ──────────────────────────────────────────────────────────────────────────────────────

const LAYERS_OFF: Layers = {
  drums: "off",
  bass: false,
  hook: false,
  pad: false,
  riff: false,
  arp: false,
  stabs: false,
  seq: false,
  bassShort: false,
  guitar: false,
  lead: null,
  leadDouble: false,
};

function planSections(
  rng: Rng,
  key: Key,
  liftKey: Key,
  useLift: boolean,
  p: Record<ProgressionKind, Progression>,
  style: number,
): Section[] {
  const plan: Omit<Section, "startBar" | "fill" | "fade">[] = [];
  const add = (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
    sectionKey = key,
  ) =>
    plan.push({
      kind,
      label,
      bars,
      progression,
      key: sectionKey,
      layers: { ...LAYERS_OFF, ...layers },
    });

  const tf = 1 - style;
  const stabs = () => rng.chance(0.1 + style * 0.5);
  // TF's sequenced chord synth plays the figure from the intro to the end of the song.
  // TF's high sequencer comes in after the first chorus and plays to the end (MIDI: bar 46 on).
  const useSeq = rng.chance(0.15 + 0.7 * tf);
  // TF's rhythm guitar: choruses, instrumentals and the outro (MIDI: never in the verses).
  const guitar = rng.chance(0.1 + 0.7 * tf);
  let seq = false;
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, 8, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: rng.chance(0.5),
      stabs: stabs(),
      seq,
      guitar,
      ...extra,
    });
  const verse = (label: string, bars: number, extra: Partial<Layers> = {}) =>
    add("verse", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      seq,
      ...extra,
    });
  // DS: interlude, the Dorian ii–IV turnaround, then a 2-bar break on the tonic.
  const dsBlock = () => {
    add("interlude", "Interlude", 8, p.interlude, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
      hook: rng.chance(0.3),
      arp: rng.chance(0.5),
    });
    add("turnaround", "Turnaround", p.turnaround.length > 2 ? 4 : 2, p.turnaround, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
      arp: true,
    });
    if (rng.chance(0.7)) {
      add("break", "Break", 2, [["i"]], { drums: "kick", riff: true, pad: true });
    }
  };
  // TF: the band plays the chorus chords instrumentally, riff and melodic bass on top.
  // TF's way into a verse (MIDI bars 45–46): two staccato bars on VI–VII, the second resting until
  // the bass's pickup run (see bassLine).
  const tfTurn = () => {
    if (!rng.chance(0.2 + 0.7 * tf)) return;
    add("turnaround", "Turn · VI–VII", 2, [["VI"], ["VII"]], {
      drums: "full",
      bass: true,
      bassShort: true,
      pad: true,
      seq,
      guitar,
    });
  };
  const tfInstrumental = (label: string, bars: number) =>
    add("interlude", label, bars, p.chorus, {
      drums: "full",
      bass: true,
      seq,
      guitar,
      pad: true,
      riff: true,
      hook: true,
    });

  // Both songs open with drums + bass, then an instrumental over the chorus chords.
  add("intro", "Intro", 4, p.chorus, {
    drums: rng.chance(0.6 * tf) ? "groove" : rng.chance(0.5 + 0.3 * tf) ? "kick" : "full",
    bass: true,
    hook: rng.chance(0.2 + 0.5 * tf),
  });
  add("intro", "Intro · riff", rng.pick([8, 8, 12]), p.chorus, {
    drums: "full",
    bass: true,
    pad: true,
    riff: true,
    hook: rng.chance(0.3 + 0.4 * tf),
    arp: rng.chance(0.3 * style),
  });
  const verseBars = rng.chance(0.8) ? 16 : 8;
  verse("Verse 1", verseBars, { hook: rng.chance(0.3 * tf) });
  chorus("Chorus");
  seq = useSeq;
  if (rng.chance(style)) dsBlock();
  else {
    tfInstrumental("Instrumental", 8);
    tfTurn();
  }
  verse("Verse 2", verseBars === 16 && rng.chance(0.5) ? 16 : 8, { hook: rng.chance(0.5) });
  chorus("Chorus", { arp: true });
  if (rng.chance(style)) {
    dsBlock();
  } else {
    // TF: a turnaround on VI, the i–IV vamp with the melodic-bass solo, an instrumental chorus.
    add("turnaround", "Turnaround", p.turnaround.length > 2 ? 4 : 2, p.turnaround, {
      drums: "full",
      bass: true,
      pad: true,
    });
    add("bridge", "Bridge · bass solo", 8, p.bridge, {
      drums: "full",
      bass: true,
      pad: true,
      hook: true,
    });
    tfInstrumental("Instrumental chorus", 8);
  }
  if (rng.chance(0.2 + 0.6 * tf)) {
    tfTurn();
    verse("Verse 3", rng.chance(0.5) ? 16 : 8, { hook: true });
  }
  chorus("Chorus");
  chorus("Chorus · double", { leadDouble: true, arp: true });
  if (rng.chance(style * 0.6)) chorus("Chorus", { leadDouble: true });
  if (useLift) {
    // TF: the chorus's IV becomes the new tonic.
    add(
      "outro",
      "Outro · lift to IV",
      16,
      p.lift,
      {
        drums: "full",
        bass: true,
        bassShort: guitar,
        pad: true,
        riff: true,
        hook: true,
        guitar,
        seq,
      },
      liftKey,
    );
  } else {
    add("outro", "Outro · chorus to fade", 16, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      guitar,
      lead: "chorus",
      riff: rng.chance(0.5),
      arp: true,
    });
  }

  let startBar = 0;
  return plan.map((s, i) => {
    const next = plan[i + 1];
    const fill =
      !!next &&
      s.layers.drums !== "off" &&
      (next.kind === "chorus" || next.kind === "verse" || rng.chance(0.5));
    const section: Section = { ...s, startBar, fill, fade: !next };
    startBar += s.bars;
    return section;
  });
}

/** An original's measured form, laid out like a generated one: fills into verses and choruses,
 * a fade at the end. */
function referenceSections(ref: ReferenceSong): Section[] {
  let startBar = 0;
  return ref.sections.map((s, i) => {
    const next = ref.sections[i + 1];
    const layers = { ...LAYERS_OFF, ...s.layers };
    const section: Section = {
      kind: s.kind,
      label: s.label,
      bars: s.bars,
      progression: s.progression,
      key: s.key ?? ref.key,
      layers,
      startBar,
      fill: !!next && layers.drums !== "off" && (next.kind === "chorus" || next.kind === "verse"),
      fade: !next,
    };
    startBar += s.bars;
    return section;
  });
}

// ── Motifs ────────────────────────────────────────────────────────────────────────────────────

/** About half the steps carry a top note, mostly the tonic; never the downbeat, so the pedal
 * marks the bar. */
function generateSequence(rng: Rng): SequencePattern {
  const tops = Array.from({ length: 16 }, (_, step): 0 | 5 | 12 =>
    step === 0 || !rng.chance(0.5) ? 0 : rng.chance(0.3) ? 12 : 5,
  );
  return { tops };
}

/** One-beat rhythm cells ("x" = onset on that 16th). */
type Cell = string;

function cellsToOnsets(cells: readonly Cell[]): number[] {
  const onsets: number[] = [];
  cells.forEach((cell, beat) => {
    for (let i = 0; i < 4; i++) if (cell[i] === "x") onsets.push(beat * 4 + i);
  });
  return onsets;
}

function onsetsToNotes(
  onsets: readonly number[],
  length: number,
  maxDur: number,
  pitch: (i: number) => number,
): MotifNote[] {
  return onsets.map((step, i) => {
    const next = onsets[i + 1] ?? length;
    return {
      step,
      dur: Math.min(maxDur, next - step),
      idx: pitch(i),
      vel: step % 4 === 0 ? 1 : step % 2 === 0 ? 0.82 : 0.7,
    };
  });
}

function walk(
  rng: Rng,
  count: number,
  start: number,
  lo: number,
  hi: number,
  moves: readonly (readonly [number, number])[],
): number[] {
  const out: number[] = [];
  let cur = start;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    let next = cur + rng.weighted(moves);
    if (next < lo || next > hi) next = cur - (next - cur);
    cur = Math.min(hi, Math.max(lo, next));
  }
  return out;
}

/** The synth riff: 2 bars, call-and-response; pitches index the current chord's tones. */
function generateRiff(rng: Rng): Motif {
  const cells: [Cell, number][] = [
    ["x.x.", 2],
    ["x..x", 2],
    ["..x.", 1],
    ["x.xx", 1],
    ["xx.x", 1],
    [".x.x", 1],
    ["x...", 1],
  ];
  const bar1 = [rng.weighted(cells), rng.weighted(cells), rng.weighted(cells), rng.weighted(cells)];
  const bar2 = [bar1[0], bar1[1], bar1[2], rng.weighted(cells)] as Cell[];
  const onsets = cellsToOnsets([...bar1, ...bar2]);
  const contour = walk(rng, onsets.length, rng.int(2, 4), 1, 6, [
    [1, 3],
    [-1, 3],
    [2, 1],
    [-2, 1],
    [0, 1],
  ]);
  return { bars: 2, notes: onsetsToNotes(onsets, 32, 3, (i) => contour[i] ?? 3) };
}

/** Melodic high bass (Peter Hook style): 2 bars; pitches are scale steps above the chord root. */
function generateHook(rng: Rng): Motif {
  const cells: [Cell, number][] = [
    ["x.x.", 3],
    ["x.xx", 2],
    ["xx.x", 1],
    ["x...", 1],
    ["x..x", 1],
    ["..x.", 0.5],
  ];
  const bar1 = [rng.weighted(cells), rng.weighted(cells), rng.weighted(cells), rng.weighted(cells)];
  const bar2 = [bar1[0], bar1[1], rng.weighted(cells), rng.weighted(cells)] as Cell[];
  const onsets = cellsToOnsets([...bar1, ...bar2]);
  const contour = walk(rng, onsets.length, rng.pick([4, 7, 7, 9]), 0, 11, [
    [-1, 3],
    [1, 2],
    [-2, 1],
    [2, 1],
    [0, 1],
    [3, 0.5],
    [-3, 0.5],
  ]);
  return { bars: 2, notes: onsetsToNotes(onsets, 32, 4, (i) => contour[i] ?? 7) };
}

const ARP_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5],
  [0, 1, 2, 1, 3, 2, 4, 3],
  [4, 3, 2, 1, 2, 3, 4, 5],
  [0, 2, 4, 2, 1, 3, 5, 3],
];

function generateArp(rng: Rng): Motif {
  const pattern = rng.pick(ARP_PATTERNS);
  const notes: MotifNote[] = Array.from({ length: 16 }, (_, step) => ({
    step,
    dur: 1,
    idx: pattern[step % pattern.length] ?? 0,
    vel: step % 4 === 0 ? 0.9 : 0.6,
  }));
  return { bars: 1, notes };
}

// ── Lead melody ───────────────────────────────────────────────────────────────────────────────

/** The chord sounding at (bar, step) of a progression. */
export function chordAt(progression: Progression, bar: number, step: number): Chord {
  const chords = progression[bar % progression.length] ?? ["i"];
  const slot = chords.length > 1 && step >= 8 ? 1 : 0;
  return chord(chords[slot] ?? chords[0] ?? "i");
}

interface RhythmNote {
  /** 16ths from the start of the 4-bar phrase. */
  step: number;
  dur: number;
}

/** A sung 2-bar line: optional pickup rest, ~one note per beat, ends on a long note. */
function phraseRhythm(rng: Rng, offset: number): RhythmNote[] {
  const out: RhythmNote[] = [];
  let cursor = rng.pick([0, 0, 2, 4]);
  while (cursor < 22) {
    const dur = rng.weighted<number>([
      [2, 4],
      [3, 2],
      [4, 3],
      [6, 1],
      [1, 0.6],
    ]);
    out.push({ step: offset + cursor, dur });
    cursor += dur;
  }
  out.push({ step: offset + cursor, dur: Math.max(4, 30 - cursor) });
  return out;
}

/**
 * Diatonic, mostly stepwise, chord tones on strong beats, an arch per 2-bar phrase, phrase ends on a
 * long chord tone (docs/analysis.md §4). Bars 4–7 replay bars 0–3's rhythm and random choices over
 * their own chords, so the line repeats where the harmony repeats and adapts where it changes
 * (the DS verse's second line), then cadences on the root.
 */
export function generateMelody(
  rng: Rng,
  key: Key,
  progression: Progression,
  range: readonly [number, number],
): Melody {
  const call = phraseRhythm(rng, 0);
  // The answer reuses the call's first bar so the line has a recognisable shape.
  const answer = [
    ...call.filter((n) => n.step < 16).map((n) => ({ ...n, step: n.step + 32 })),
    ...phraseRhythm(rng, 32).filter((n) => n.step >= 48),
  ];
  const rhythm = [...call, ...answer].filter((n) => n.step < 64);
  const cadence = [
    ...rhythm.filter((n) => n.step < 48),
    ...phraseRhythm(rng.fork("cadence"), 32).filter((n) => n.step >= 48),
  ];

  const first = realise(rng.fork("walk"), key, progression, rhythm, range, 0, false);
  const second = realise(rng.fork("walk"), key, progression, cadence, range, 4, true);
  return { bars: [...splitBars(first), ...splitBars(second)] };
}

function realise(
  rng: Rng,
  key: Key,
  progression: Progression,
  rhythm: readonly RhythmNote[],
  [lo, hi]: readonly [number, number],
  barOffset: number,
  endOnRoot: boolean,
): (RhythmNote & { midi: number })[] {
  const out: (RhythmNote & { midi: number })[] = [];
  let prev: number | null = null;
  rhythm.forEach((n, i) => {
    const bar = barOffset + Math.floor(n.step / 16);
    const c = chordAt(progression, bar, n.step % 16);
    const tones = notesInRange(chordPitchClasses(key, c), lo, hi);
    const scale = notesInRange(scaleForChord(key, c), lo, hi);
    const phrasePos = (n.step % 32) / 32;
    const target = lo + (hi - lo) * (0.3 + 0.45 * Math.sin(Math.PI * phrasePos));
    const nextStep = rhythm[i + 1]?.step;
    const phraseEnd =
      nextStep === undefined || Math.floor(nextStep / 32) !== Math.floor(n.step / 32);
    const strong = n.step % 8 === 0 || n.dur >= 4;

    let midi: number;
    if (prev === null) {
      midi = closest(tones, target);
    } else if (phraseEnd) {
      const pool =
        endOnRoot && i === rhythm.length - 1
          ? tones.filter((t) => mod12(t - key.tonic - c.root) === 0)
          : tones;
      midi = closest(pool.length ? pool : tones, prev);
    } else if (strong) {
      const from = prev;
      const near = tones.filter((t) => Math.abs(t - from) <= 5);
      midi = near.length
        ? rng.weighted(near.map((t) => [t, 1 / (1 + Math.abs(t - target) / 3)] as const))
        : closest(tones, prev);
    } else {
      const idx = scale.indexOf(closest(scale, prev));
      const dir = rng.chance(0.7)
        ? Math.sign(target - prev) || 1
        : -(Math.sign(target - prev) || 1);
      const size = rng.weighted([
        [1, 0.72],
        [2, 0.22],
        [3, 0.06],
      ]);
      let j = idx + dir * size;
      if (j < 0 || j >= scale.length) j = idx - dir * size;
      midi = scale[Math.min(scale.length - 1, Math.max(0, j))] ?? prev;
    }
    out.push({ ...n, midi });
    prev = midi;
  });
  return out;
}

function closest(notes: readonly number[], target: number): number {
  let best = notes[0] ?? target;
  for (const n of notes) if (Math.abs(n - target) < Math.abs(best - target)) best = n;
  return best;
}

function splitBars(notes: readonly (RhythmNote & { midi: number })[]): Note[][] {
  const bars: Note[][] = [[], [], [], []];
  for (const n of notes) {
    const bar = bars[Math.floor(n.step / 16)];
    if (!bar) continue;
    bar.push({ step: n.step % 16, dur: n.dur, midi: n.midi, vel: n.step % 8 === 0 ? 0.9 : 0.78 });
  }
  return bars;
}

// ── Titles ────────────────────────────────────────────────────────────────────────────────────

const ADJECTIVES = [
  "Electric",
  "Silent",
  "Blue",
  "Cold",
  "Broken",
  "Neon",
  "Distant",
  "Restless",
  "Endless",
  "Paper",
  "Velvet",
  "Crystal",
  "Hollow",
  "Northern",
  "Midnight",
  "Secret",
  "Fragile",
  "Burning",
  "Perfect",
];
const NOUNS = [
  "Machine",
  "Promise",
  "Signal",
  "Confession",
  "Weather",
  "Station",
  "Kingdom",
  "Mirror",
  "Fever",
  "Shadow",
  "Summer",
  "Distance",
  "Heaven",
  "Motion",
  "Language",
  "Ritual",
  "Harbour",
  "Empire",
];
const ELEMENTS = [
  "Glass",
  "Rain",
  "Steel",
  "Smoke",
  "Gold",
  "Ice",
  "Fire",
  "Light",
  "Dust",
  "Silence",
  "Thunder",
  "Wire",
  "Static",
  "Chrome",
];
const PLACES = ["World", "City", "Age", "Land", "Night", "House", "Sea"];

function generateTitle(rng: Rng): string {
  const pattern = rng.int(0, 3);
  let title: string;
  if (pattern === 0) title = `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
  else if (pattern === 1) title = `The ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
  else if (pattern === 2) {
    const a = rng.pick(ELEMENTS);
    let b = rng.pick(ELEMENTS);
    if (b === a) b = rng.pick(ELEMENTS);
    title = `${rng.pick(NOUNS)} (${rng.pick(PLACES)} of ${a} and ${b})`;
  } else title = `${rng.pick(NOUNS)} ${rng.pick(["Of", "In", "For"])} ${rng.pick(NOUNS)}`;
  if (rng.chance(0.2)) title += rng.pick([" (12″ Mix)", " (Extended)", " (Dub)"]);
  return title;
}
